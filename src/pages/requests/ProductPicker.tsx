import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Input, SegTab, Select } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { entryUnitsFor } from '../../components/QtyInput'
import { useEntryUnits } from '../../services/entryUnits'
import { supplierChoiceFor, type LineInput } from '../../services/purchaseRequests'
import { useT } from '../../i18n/I18nContext'
import { normaliseName, similarity } from '../../lib/productMatch'
import { sameUnit } from '../../lib/units'
import type { Product, Supplier } from '../../types'

/**
 * Finding the thing to ask for, and how many.
 *
 * Two ways in, on the same panel, so the person keeps adding without leaving it:
 *
 *   [สินค้า]  type a name or a code → pick → the supplier is already filled in from the
 *             catalogue (or offered, when the product lists more than one) → quantity →
 *             Enter adds it and the search box is back in focus.
 *   [ผู้ขาย]  pick a supplier → every product they sell, each with its own quantity box;
 *             typing in any of them and pressing Enter adds that line.
 *
 * Nobody has to remember who sells what: the product carries its supplier. A person may
 * still choose a different one — the owner's rule — and the line is flagged for the
 * manager when they do. No modal opens from here; the cart beside it updates in place.
 */

const MAX_RESULTS = 12
const DEBOUNCE_MS = 120

export type PickerMode = 'product' | 'supplier'

/** A product line as the cart wants it, plus the words the cart shows about the choice. */
export interface PickedLine extends LineInput {
  productName: string
  supplierName: string
}

export function ProductPicker({
  products,
  suppliers,
  onAdd,
  inCart,
  compact = false,
}: {
  products: readonly Product[]
  suppliers: readonly Supplier[]
  onAdd: (line: PickedLine) => Promise<void> | void
  /** Product ids already on the request, so the list can say so. */
  inCart: ReadonlySet<string>
  /** Manager's add-a-line strip: smaller, no mode switch. */
  compact?: boolean
}) {
  const t = useT()
  const [mode, setMode] = useState<PickerMode>('product')
  const active = useMemo(() => products.filter((p) => p.active !== false), [products])
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active !== false), [suppliers])

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex gap-1 rounded-lg bg-sunken p-1">
          <SegTab label={t('สินค้า')} active={mode === 'product'} onClick={() => setMode('product')} />
          <SegTab label={t('ผู้ขาย')} active={mode === 'supplier'} onClick={() => setMode('supplier')} />
        </div>
      )}
      {mode === 'product' ? (
        <ByProduct products={active} suppliers={activeSuppliers} onAdd={onAdd} inCart={inCart} />
      ) : (
        <BySupplier products={active} suppliers={activeSuppliers} onAdd={onAdd} inCart={inCart} />
      )}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Name or code, the way the person types it: a code prefix wins, then closest name. */
function searchProducts(q: string, products: readonly Product[]): Product[] {
  const raw = q.trim()
  if (!raw) return []
  const key = normaliseName(raw)
  const upper = raw.toUpperCase()
  return products
    .map((p) => {
      const sku = p.sku.toUpperCase()
      const name = normaliseName(p.name)
      let score = 0
      if (sku === upper) score = 3
      else if (sku.startsWith(upper)) score = 2.5
      else if (name.includes(key)) score = 2 + similarity(key, name) / 10
      else score = similarity(key, name)
      return { p, score }
    })
    .filter((x) => x.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, MAX_RESULTS)
    .map((x) => x.p)
}

/** The suppliers a product may go to: its usual one first, alternates, then everyone else. */
function supplierOptions(p: Product, suppliers: readonly Supplier[]): { s: Supplier; choice: 'primary' | 'alternate' | 'custom' }[] {
  const listed = [p.supplierId, ...(p.alternateSupplierIds ?? [])].filter((id): id is string => !!id)
  const byId = new Map(suppliers.map((s) => [s.id, s]))
  const first = listed.map((id) => byId.get(id)).filter((s): s is Supplier => !!s)
  const rest = suppliers.filter((s) => !listed.includes(s.id))
  return [...first, ...rest].map((s) => ({ s, choice: supplierChoiceFor(p, s.id) }))
}

function ByProduct({
  products,
  suppliers,
  onAdd,
  inCart,
}: {
  products: readonly Product[]
  suppliers: readonly Supplier[]
  onAdd: (line: PickedLine) => Promise<void> | void
  inCart: ReadonlySet<string>
}) {
  const t = useT()
  const plainUnits = useEntryUnits()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, DEBOUNCE_MS)
  const results = useMemo(() => searchProducts(dq, products), [dq, products])
  const [cursor, setCursor] = useState(0)
  const [picked, setPicked] = useState<Product | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [entryUnit, setEntryUnit] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  useEffect(() => setCursor(0), [dq])

  const options = useMemo(() => (picked ? supplierOptions(picked, suppliers) : []), [picked, suppliers])
  const units = useMemo(() => (picked ? entryUnitsFor(picked.unitType, plainUnits, picked.unitConversions) : []), [picked, plainUnits])

  function pick(p: Product) {
    setPicked(p)
    setSupplierId(p.supplierId && suppliers.some((s) => s.id === p.supplierId) ? p.supplierId : '')
    setEntryUnit('')
    setQty('')
    setTimeout(() => qtyRef.current?.focus(), 0)
  }

  function reset() {
    setPicked(null)
    setQ('')
    setQty('')
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  async function add() {
    if (!picked || !supplierId) return
    const n = Number(qty)
    if (!(n > 0)) return
    const s = suppliers.find((x) => x.id === supplierId)!
    setBusy(true)
    try {
      await onAdd({
        productId: picked.id,
        productName: picked.name,
        supplierId,
        supplierName: s.name,
        qty: n,
        ...(entryUnit && !sameUnit(entryUnit, picked.unitType) ? { entryUnit } : {}),
      })
      reset()
    } finally {
      setBusy(false)
    }
  }

  const listed = options.filter((o) => o.choice !== 'custom')
  const others = options.filter((o) => o.choice === 'custom')
  const chosen = options.find((o) => o.s.id === supplierId)

  return (
    <div className="space-y-3">
      {!picked ? (
        <>
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('ค้นหาชื่อสินค้า / รหัสสินค้า')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter' && results[cursor]) {
                e.preventDefault()
                pick(results[cursor])
              }
            }}
          />
          {dq.trim() && (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line" role="listbox">
              {results.length === 0 && <li className="p-3 text-sm text-ink-faint">{t('ไม่พบสินค้าที่ตรงกัน')}</li>}
              {results.map((p, i) => {
                const supplierName = suppliers.find((s) => s.id === p.supplierId)?.name
                return (
                  <li key={p.id} role="option" aria-selected={i === cursor}>
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      onMouseEnter={() => setCursor(i)}
                      className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left ${i === cursor ? 'bg-brand-soft' : 'hover:bg-sunken'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{p.name}</div>
                        <div className="flex flex-wrap gap-2 text-xs text-ink-faint">
                          <span className="doc-no">{p.sku}</span>
                          <span>{p.unitType}</span>
                          {supplierName ? <span>{supplierName}</span> : <span className="text-warn">{t('ยังไม่มีผู้ขาย')}</span>}
                        </div>
                      </div>
                      {inCart.has(p.id) && <Badge color="blue">{t('อยู่ในรายการแล้ว')}</Badge>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-line-strong bg-surface p-3">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-ink">{picked.name}</div>
              <div className="flex flex-wrap gap-2 text-xs text-ink-faint">
                <span className="doc-no">{picked.sku}</span>
                <span>{t('หน่วย')}: {picked.unitType}</span>
              </div>
            </div>
            <button type="button" onClick={reset} className="text-xs text-brand">
              {t('เปลี่ยน')}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-ink">{t('ผู้ขาย')}</label>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t('— เลือกผู้ขาย —')}</option>
                {listed.length > 0 && (
                  <optgroup label={t('ผู้ขายของสินค้านี้')}>
                    {listed.map(({ s, choice }) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {choice === 'primary' ? ` (${t('ผู้ขายประจำ')})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t('ผู้ขายรายอื่น — หัวหน้าจะเห็นว่าเลือกเอง')}>
                  {others.map(({ s }) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
              {chosen?.choice === 'custom' && (
                <p className="mt-1 text-xs text-warn">{t('ไม่ใช่ผู้ขายประจำของสินค้านี้ — จะติดธงให้หัวหน้าตรวจ')}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">{t('จำนวน')}</label>
              <Input
                ref={qtyRef}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void add()
                  }
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">{t('หน่วย')}</label>
              <Select value={entryUnit} onChange={(e) => setEntryUnit(e.target.value)}>
                {units.map((u) => (
                  <option key={u.key} value={sameUnit(u.records, picked.unitType) ? '' : u.records}>
                    {u.translate ? t(u.label) : u.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => void add()} disabled={busy || !supplierId || !(Number(qty) > 0)}>
              <Icon name="plus" size={16} />
              {t('เพิ่มรายการ')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function BySupplier({
  products,
  suppliers,
  onAdd,
  inCart,
}: {
  products: readonly Product[]
  suppliers: readonly Supplier[]
  onAdd: (line: PickedLine) => Promise<void> | void
  inCart: ReadonlySet<string>
}) {
  const t = useT()
  const [supplierId, setSupplierId] = useState('')
  const [filter, setFilter] = useState('')
  const df = useDebounced(filter, DEBOUNCE_MS)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

  const supplier = suppliers.find((s) => s.id === supplierId)
  const mine = useMemo(() => {
    if (!supplierId) return []
    const key = normaliseName(df)
    return products
      .filter((p) => p.supplierId === supplierId || (p.alternateSupplierIds ?? []).includes(supplierId))
      .filter((p) => !key || normaliseName(p.name).includes(key) || p.sku.toUpperCase().includes(df.trim().toUpperCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, supplierId, df])

  async function add(p: Product) {
    const n = Number(qtys[p.id])
    if (!(n > 0) || !supplier) return
    setBusy(p.id)
    try {
      await onAdd({ productId: p.id, productName: p.name, supplierId: supplier.id, supplierName: supplier.name, qty: n })
      setQtys((q) => ({ ...q, [p.id]: '' }))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} autoFocus>
          <option value="">{t('— เลือกผู้ขาย —')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('ค้นหาในสินค้าของผู้ขายนี้')}
          disabled={!supplierId}
        />
      </div>
      {supplierId && (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {mine.length === 0 && <li className="p-3 text-sm text-ink-faint">{t('ผู้ขายรายนี้ยังไม่มีสินค้าในระบบ')}</li>}
          {mine.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{p.name}</div>
                <div className="flex gap-2 text-xs text-ink-faint">
                  <span className="doc-no">{p.sku}</span>
                  {inCart.has(p.id) && <Badge color="blue">{t('อยู่ในรายการแล้ว')}</Badge>}
                </div>
              </div>
              <div className="w-24">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={qtys[p.id] ?? ''}
                  onChange={(e) => setQtys((q) => ({ ...q, [p.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void add(p)
                    }
                  }}
                  aria-label={t('จำนวน')}
                />
              </div>
              <span className="w-10 text-xs text-ink-soft">{p.unitType}</span>
              <Button variant="secondary" onClick={() => void add(p)} disabled={busy === p.id || !(Number(qtys[p.id]) > 0)}>
                <Icon name="plus" size={14} />
                {t('เพิ่ม')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
