import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { Badge, Button, Field, Input, Modal, Select } from '../../components/ui'
import { entryUnitsFor, UnitSelect } from '../../components/QtyInput'
import { useEntryUnits } from '../../services/entryUnits'
import { useT } from '../../i18n/I18nContext'
import { buildMatchIndex, matchProduct, normaliseName, similarity, type ProductAlias } from '../../lib/productMatch'
import { canonicalUnit } from '../../services/purchaseBatch'
import { sameUnit } from '../../lib/units'
import type { BatchRow, Product, Supplier } from '../../types'
import { issueText, openIssues } from './issues'

/**
 * Settling one row a person has to decide about.
 *
 * Everything the app would not decide on its own is decided here: which product a
 * spelling means, which of the product's suppliers this goes to, a quantity the workbook
 * wrote as a word, a unit the product has never been keyed in, and the warnings that want
 * a tick. Or "not this one", which keeps the row visible and out of every order.
 *
 * What is offered is bounded by what the master data allows. Staff choose among the
 * suppliers the product lists (its usual one and its alternates); only an admin may send a
 * product to a supplier it has never been linked to, and may make that its usual supplier
 * from here. A spelling confirmed here is remembered, so it is not asked again.
 */
export interface ResolveResult {
  row: BatchRow
  /** Save the workbook spelling as an alias for the chosen product. */
  saveAlias: boolean
  /** Admin only: make the chosen supplier the product's usual one. */
  setPrimary: boolean
  /** The history action this amounts to. */
  action: string
  detail?: string
}

export function ResolveRowModal({
  row,
  suppliers,
  aliases,
  onClose,
  onSave,
}: {
  row: BatchRow
  suppliers: readonly Supplier[]
  aliases: readonly ProductAlias[]
  onClose: () => void
  onSave: (r: ResolveResult) => Promise<void>
}) {
  const t = useT()
  const { user } = useAuth()
  const { products } = useData()
  const plainUnits = useEntryUnits()
  const isAdmin = user?.role === 'admin'

  const [productId, setProductId] = useState(row.productId ?? '')
  const [supplierId, setSupplierId] = useState(row.supplierId ?? '')
  const [qty, setQty] = useState(row.qty !== undefined ? String(row.qty) : '')
  const [entryUnit, setEntryUnit] = useState(row.entryUnit ?? '')
  const [search, setSearch] = useState('')
  const [saveAlias, setSaveAlias] = useState(true)
  const [setPrimary, setSetPrimary] = useState(false)
  const [confirmed, setConfirmed] = useState(!!row.confirmed)
  const [busy, setBusy] = useState(false)

  const product = products.find((p) => p.id === productId)

  /** The products worth offering: the matcher's candidates first, then a search. */
  const choices = useMemo<Product[]>(() => {
    const index = buildMatchIndex(products, aliases)
    const m = matchProduct(row.rawName, index)
    const top = m.candidates.map((c) => c.product)
    const q = normaliseName(search)
    if (!q) return top
    return products
      .filter((p) => p.active !== false || p.id === productId)
      .map((p) => ({ p, s: similarity(q, normaliseName(p.name)) + (normaliseName(p.name).includes(q) ? 1 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.p)
  }, [products, aliases, row.rawName, search, productId])

  /** Suppliers this row may go to, by who is asking. */
  const supplierChoices = useMemo<{ s: Supplier; usual: boolean }[]>(() => {
    if (!product) return []
    const byId = new Map(suppliers.map((s) => [s.id, s]))
    const listed = [product.supplierId, ...(product.alternateSupplierIds ?? [])]
      .filter((id): id is string => !!id)
      .map((id) => byId.get(id))
      .filter((s): s is Supplier => !!s)
    if (isAdmin) {
      const rest = suppliers.filter((s) => s.active !== false && !listed.includes(s))
      return [...listed.map((s) => ({ s, usual: s.id === product.supplierId })), ...rest.map((s) => ({ s, usual: false }))]
    }
    return listed.map((s) => ({ s, usual: s.id === product.supplierId }))
  }, [product, suppliers, isAdmin])

  const units = useMemo(
    () => (product ? entryUnitsFor(product.unitType, plainUnits, product.unitConversions) : []),
    [product, plainUnits],
  )

  const issues = openIssues(row)
  const warnings = row.issues.filter((i) => i.severity === 'warn')
  const qtyNum = Number(qty)
  const qtyOk = Number.isFinite(qtyNum) && qtyNum > 0
  const canSave = !!productId && !!supplierId && qtyOk

  function pickProduct(id: string) {
    setProductId(id)
    const p = products.find((x) => x.id === id)
    setSupplierId(p?.supplierId ?? '')
    setSetPrimary(false)
    // Carry the workbook's unit across when the new product knows it; otherwise its own.
    if (p) {
      const wanted = canonicalUnit(row.rawUnit)
      // Only a unit with a rate for this product can be filed; the rest stay a question.
      const hit = entryUnitsFor(p.unitType, plainUnits, p.unitConversions).find(
        (u) => u.factor !== null && (sameUnit(u.label, wanted) || sameUnit(u.records, wanted)),
      )
      setEntryUnit(hit && !sameUnit(hit.records, p.unitType) ? hit.records : '')
    }
  }

  async function save() {
    if (!product || !canSave) return
    setBusy(true)
    try {
      const changedProduct = product.id !== row.productId
      const changedSupplier = supplierId !== row.supplierId
      const changedQty = qtyNum !== row.qty
      // Rebuilt rather than spread, so a unit cleared here does not linger from before.
      const { entryUnit: _old, ...rest } = row
      void _old
      const next: BatchRow = {
        ...rest,
        matchKind: 'manual',
        productId: product.id,
        productName: product.name,
        unit: product.unitType,
        ...(entryUnit && !sameUnit(entryUnit, product.unitType) ? { entryUnit } : {}),
        supplierId,
        supplierName: suppliers.find((s) => s.id === supplierId)?.name ?? '',
        qty: qtyNum,
        confirmed,
        skipped: false,
      }
      const action = changedProduct
        ? 'productMapped'
        : changedSupplier
          ? 'supplierChanged'
          : changedQty
            ? 'qtyChanged'
            : confirmed && !row.confirmed
              ? 'warningsConfirmed'
              : 'unitChanged'
      await onSave({
        row: next,
        saveAlias: changedProduct && saveAlias && row.matchKind !== 'exact',
        setPrimary: isAdmin && setPrimary && supplierId !== product.supplierId,
        action,
        detail: `${row.rawName} → ${product.name}`,
      })
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try {
      await onSave({ row: { ...row, skipped: true }, saveAlias: false, setPrimary: false, action: 'rowSkipped', detail: row.rawName })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('แถว {row}: {name}', { row: row.excelRow, name: row.rawName })}>
      <div className="space-y-4">
        {issues.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-warn-soft p-3 text-sm text-warn">
            {issues.map((i) => (
              <li key={i.code}>• {issueText(i, t)}</li>
            ))}
          </ul>
        )}
        <div className="text-xs text-ink-soft">
          {t('ในไฟล์')}: {row.rawName} · {row.rawQty} {row.rawUnit}
          {row.note ? ` · ${row.note}` : ''}
        </div>

        {/* ---- the product ---- */}
        <Field label={t('สินค้าในระบบ')} required>
          {product ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm">
              <span className="font-medium text-ink">{product.name}</span>
              <span className="doc-no text-xs text-ink-faint">{product.sku}</span>
              <Badge>{product.unitType}</Badge>
              <button type="button" className="ml-auto text-xs text-brand" onClick={() => setProductId('')}>
                {t('เปลี่ยน')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('ค้นหาชื่อสินค้าหรือรหัส…')}
                autoFocus
              />
              <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {choices.length === 0 && (
                  <li className="p-2 text-sm text-ink-faint">{t('ไม่พบ — ลองพิมพ์คำอื่น หรือข้ามรายการนี้')}</li>
                )}
                {choices.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pickProduct(p.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sunken"
                    >
                      <span className="flex-1 text-ink">{p.name}</span>
                      <span className="doc-no text-xs text-ink-faint">{p.sku}</span>
                      {p.active === false && <Badge color="red">{t('ซ่อนไว้')}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Field>
        {/* Offered whenever the app had to ask — including the same-name-two-suppliers case,
            where the spelling equals the product's and the alias is exactly what settles it. */}
        {product && row.productId !== product.id && row.matchKind !== 'exact' && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={saveAlias} onChange={(e) => setSaveAlias(e.target.checked)} />
            {t('จำไว้ว่า "{raw}" คือสินค้านี้ — ครั้งหน้าไม่ต้องถามอีก', { raw: row.rawName })}
          </label>
        )}

        {/* ---- the supplier ---- */}
        {product && (
          <Field label={t('ผู้ขาย')} required>
            {supplierChoices.length === 0 ? (
              <p className="text-sm text-warn">
                {isAdmin
                  ? t('ยังไม่มีผู้ขายในระบบ — เพิ่มที่หน้าผู้ขายก่อน')
                  : t('สินค้านี้ยังไม่มีผู้ขาย — ต้องให้ผู้ดูแลระบบกำหนดผู้ขายในหน้าสินค้าคงคลังก่อน')}
              </p>
            ) : (
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t('— เลือกผู้ขาย —')}</option>
                {supplierChoices.map(({ s, usual }) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {usual ? ` (${t('ผู้ขายประจำ')})` : ''}
                    {s.active === false ? ` (${t('ซ่อนไว้')})` : ''}
                  </option>
                ))}
              </Select>
            )}
            {isAdmin && supplierId && supplierId !== product.supplierId && (
              <label className="mt-2 flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={setPrimary} onChange={(e) => setSetPrimary(e.target.checked)} />
                {t('ตั้งเป็นผู้ขายประจำของสินค้านี้')}
              </label>
            )}
          </Field>
        )}

        {/* ---- quantity and unit ---- */}
        {product && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('จำนวน')} required>
              <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label={t('หน่วย')}>
              <UnitSelect units={units} value={entryUnit} onChange={setEntryUnit} product={product} />
            </Field>
          </div>
        )}

        {/* ---- warnings that want a tick ---- */}
        {warnings.length > 0 && (
          <label className="flex items-start gap-2 rounded-lg border border-warn bg-warn-soft p-3 text-sm text-ink">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>
              {t('ตรวจสอบแล้ว ยืนยันตามนี้')}
              <ul className="mt-1 text-xs text-ink-soft">
                {warnings.map((i) => (
                  <li key={i.code}>• {issueText(i, t)}</li>
                ))}
              </ul>
            </span>
          </label>
        )}
      </div>

      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={() => void skip()} disabled={busy}>
          {t('ข้ามรายการนี้')}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !canSave}>
            {busy ? t('กำลังบันทึก...') : t('บันทึก')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
