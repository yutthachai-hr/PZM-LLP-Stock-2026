import { useMemo, useState } from 'react'
import { SiteSelect } from '../../components/SiteChip'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { entryUnitsFor, UnitSelect } from '../../components/QtyInput'
import { Badge, Button, Card, Field, Input, PageHeader, SectionHeader, Select, Textarea } from '../../components/ui'
import { useEntryUnits } from '../../services/entryUnits'
import * as S from '../../services/purchaseRequests'
import { useSuppliers } from '../../services/suppliers'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty } from '../../lib/format'
import { liveItems, PR_STATUS_KEYS, prBadgeColor } from '../../lib/purchaseRequestStatus'
import type { PurchaseRequest, PurchaseRequestItem, Role } from '../../types'
import { ProductPicker, type PickedLine } from './ProductPicker'

/**
 * Building a request: the picker on one side, the cart on the other, one screen.
 *
 * Nothing here is "saved" as a separate step — every line added, changed or removed is
 * written to the request as it happens, so closing the tab loses nothing and "บันทึกร่าง"
 * is simply the way out. A brand-new request is created the moment its first line is
 * added (or its header changed), not when the screen opens, so backing out of an empty
 * one leaves no empty document behind.
 */
export function RequestEditor({ initial, onChange }: { initial: PurchaseRequest | null; onChange: (pr: PurchaseRequest) => void }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { products, locations, qtyAt } = useData()
  const suppliers = useSuppliers()
  const plainUnits = useEntryUnits()

  const activeLocations = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  // Opened from a reorder suggestion or a shortage on the calendar:
  // /requests/new?product=…&location=…&qty=… — the location is set and the line offered.
  const [query] = useSearchParams()
  const suggestedProduct = !initial ? products.find((p) => p.id === query.get('product')) : undefined
  const suggestedQty = Number(query.get('qty')) || 0
  const [suggestionDone, setSuggestionDone] = useState(false)
  const [pr, setPr] = useState<PurchaseRequest | null>(initial)
  const [locationId, setLocationId] = useState(
    initial?.locationId ??
      (activeLocations.find((l) => l.id === query.get('location'))?.id ??
        activeLocations.find((l) => l.type === 'warehouse')?.id ??
        activeLocations[0]?.id ??
        ''),
  )
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState('')

  const actor = useMemo(() => (user ? { id: user.id, name: user.name, role: user.role as Role } : null), [user])
  const items = useMemo(() => (pr ? liveItems(pr.items) : []), [pr])
  const inCart = useMemo(() => new Set(items.map((i) => i.productId)), [items])
  const groups = useMemo(() => {
    const by = new Map<string, { name: string; items: PurchaseRequestItem[] }>()
    for (const i of items) {
      const g = by.get(i.supplierId) ?? { name: i.supplierName, items: [] }
      g.items.push(i)
      by.set(i.supplierId, g)
    }
    return [...by.entries()].map(([supplierId, g]) => ({ supplierId, ...g }))
  }, [items])

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label)
    try {
      return await fn()
    } catch (e) {
      toast.error(errText(e, t))
      return undefined
    } finally {
      setBusy('')
    }
  }

  /** The request document, created on first use. */
  async function ensure(): Promise<PurchaseRequest> {
    if (pr) return pr
    if (!actor) throw new Error('no user')
    const created = await S.createRequest({ locationId, note, actor })
    setPr(created)
    onChange(created)
    navigate(`/requests/${created.id}`, { replace: true })
    return created
  }

  async function add(line: PickedLine) {
    if (!actor) return
    await run('add', async () => {
      const cur = await ensure()
      const next = await S.addItem({ id: cur.id, line, products, suppliers, actor })
      setPr(next)
      toast.success(t('เพิ่ม {name} แล้ว', { name: line.productName }))
    })
  }

  async function setQty(item: PurchaseRequestItem, qty: number, entryUnit?: string) {
    if (!pr || !actor) return
    if (!(qty > 0) || (qty === item.requestedQty && (entryUnit ?? '') === (item.entryUnit ?? ''))) return
    await run(`qty-${item.idx}`, async () => setPr(await S.setRequestedQty({ id: pr.id, idx: item.idx, qty, entryUnit, actor })))
  }

  async function remove(item: PurchaseRequestItem) {
    if (!pr || !actor) return
    await run(`rm-${item.idx}`, async () => setPr(await S.removeItem({ id: pr.id, idx: item.idx, actor })))
  }

  async function changeSupplier(item: PurchaseRequestItem, supplierId: string) {
    if (!pr || !actor || !supplierId) return
    await run(`sup-${item.idx}`, async () => setPr(await S.changeSupplier({ id: pr.id, idx: item.idx, supplierId, products, suppliers, actor })))
  }

  async function saveHeader(patch: { locationId?: string; note?: string }) {
    if (!actor) return
    if (!pr) return // written when the request is created
    await run('header', async () => setPr(await S.setRequestHeader({ id: pr.id, ...patch, actor })))
  }

  async function submit() {
    if (!actor) return
    if (!pr || items.length === 0) {
      toast.error(t('ยังไม่มีรายการสินค้า'))
      return
    }
    const ok = await confirm({
      title: t('ส่งให้หัวหน้าตรวจ'),
      message: t('ส่ง {docNo} ({n} รายการ, {s} ผู้ขาย) ให้หัวหน้าตรวจ? หลังส่งแล้วจะแก้ไขเองไม่ได้จนกว่าหัวหน้าจะส่งกลับ', {
        docNo: pr.docNo,
        n: items.length,
        s: groups.length,
      }),
      confirmText: t('ส่งให้หัวหน้าตรวจ'),
    })
    if (!ok) return
    await run('submit', async () => {
      const next = await S.submitRequest({ id: pr.id, ctx: { products, suppliers, locations, qtyAt }, actor })
      setPr(next)
      toast.success(t('ส่งให้หัวหน้าตรวจแล้ว'))
      // The parent decides editor vs review from the status, so tell it.
      onChange(next)
    })
  }

  const supplierOptionsFor = (item: PurchaseRequestItem) => {
    const p = products.find((x) => x.id === item.productId)
    const listed = p ? [p.supplierId, ...(p.alternateSupplierIds ?? [])].filter(Boolean) : []
    return suppliers
      .filter((s) => s.active !== false || s.id === item.supplierId)
      .map((s) => ({ s, listed: listed.includes(s.id), primary: p?.supplierId === s.id }))
      .sort((a, b) => Number(b.listed) - Number(a.listed) || a.s.name.localeCompare(b.s.name))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="note"
        title={pr ? t('รายการขอสั่งซื้อ {docNo}', { docNo: pr.docNo }) : t('สร้างรายการขอสั่งซื้อ')}
        subtitle={t('ค้นหาสินค้า ใส่จำนวน ระบบใส่ผู้ขายให้ — ส่งให้หัวหน้าตรวจเมื่อครบ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {pr && <Badge color={prBadgeColor(pr.status)}>{t(PR_STATUS_KEYS[pr.status])}</Badge>}
            {pr && pr.revision > 1 && <Badge>{t('ครั้งที่ {n}', { n: pr.revision })}</Badge>}
            <Button variant="secondary" onClick={() => navigate('/requests')}>
              {t('บันทึกร่าง')}
            </Button>
          </div>
        }
      />

      {suggestedProduct && !suggestionDone && !inCart.has(suggestedProduct.id) && (
        <Card className="flex flex-wrap items-center gap-3 border-brand/40 bg-brand-soft p-3 text-sm text-ink">
          <Icon name="cart" size={16} className="text-brand" />
          <span className="min-w-0 flex-1">
            {suggestedQty > 0
              ? t('จากคำแนะนำ: {name} {qty} {unit}', { name: suggestedProduct.name, qty: fmtQty(suggestedQty), unit: suggestedProduct.unitType })
              : t('จากปฏิทิน: {name}', { name: suggestedProduct.name })}
          </span>
          {suggestedProduct.supplierId ? (
            <Button
              disabled={!!busy}
              onClick={async () => {
                const sup = suppliers.find((x) => x.id === suggestedProduct.supplierId)
                await add({
                  productId: suggestedProduct.id,
                  productName: suggestedProduct.name,
                  supplierId: suggestedProduct.supplierId!,
                  supplierName: sup?.name ?? '',
                  qty: suggestedQty > 0 ? suggestedQty : Math.max(1, suggestedProduct.minStock),
                })
                setSuggestionDone(true)
              }}
            >
              <Icon name="plus" size={15} />
              {t('เพิ่มลงรายการ')}
            </Button>
          ) : (
            <span className="text-xs text-ink-soft">{t('สินค้านี้ยังไม่มีผู้ขาย — ค้นหาแล้วเลือกผู้ขายด้านล่าง')}</span>
          )}
        </Card>
      )}

      {pr?.status === 'returned' && pr.returnReason && (
        <Card className="border-warn bg-warn-soft p-3 text-sm text-ink">
          <Icon name="warning" size={16} className="mr-1 inline text-warn" />
          {t('หัวหน้าส่งกลับให้แก้ไข: {reason}', { reason: pr.returnReason })}
        </Card>
      )}

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('คลังปลายทาง')} required>
            <SiteSelect
              value={locationId}
              onChange={(id) => {
                setLocationId(id)
                void saveHeader({ locationId: id })
              }}
              locations={activeLocations}
            />
          </Field>
          <Field label={t('หมายเหตุถึงหัวหน้า (ไม่บังคับ)')}>
            <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void saveHeader({ note })} />
          </Field>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-3">
          <SectionHeader icon="search" title={t('เพิ่มสินค้า')} description={t('พิมพ์ชื่อหรือรหัส แล้วกด Enter — หรือเลือกผู้ขายแล้วใส่จำนวนทีละรายการ')} />
          <ProductPicker products={products} suppliers={suppliers} onAdd={add} inCart={inCart} />
        </Card>

        <Card className="p-4 lg:col-span-2">
          <SectionHeader
            icon="package"
            title={t('รายการที่ขอ')}
            badge={
              items.length > 0 ? (
                <Badge color="blue">{t('{n} รายการ · {s} ผู้ขาย', { n: items.length, s: groups.length })}</Badge>
              ) : undefined
            }
          />
          {items.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('ยังไม่มีรายการ — เพิ่มจากช่อง "เพิ่มสินค้า"')}</p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.supplierId} className="rounded-lg border border-line">
                  <div className="border-b border-line bg-sunken px-3 py-1.5 text-sm font-semibold text-ink">{g.name}</div>
                  <ul className="divide-y divide-line">
                    {g.items.map((item) => {
                      const p = products.find((x) => x.id === item.productId)
                      const units = p ? entryUnitsFor(p.unitType, plainUnits, p.unitConversions) : []
                      return (
                        <li key={item.idx} className="px-3 py-2">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-ink">{item.productName}</div>
                              <div className="flex flex-wrap gap-2 text-xs text-ink-faint">
                                <span className="doc-no">{item.sku}</span>
                                {item.supplierChoice === 'custom' && <Badge color="amber">{t('เลือกผู้ขายเอง')}</Badge>}
                                {item.supplierChoice === 'alternate' && <Badge>{t('ผู้ขายสำรอง')}</Badge>}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void remove(item)}
                              disabled={!!busy}
                              className="rounded p-1 text-ink-faint hover:bg-danger-soft hover:text-danger"
                              aria-label={t('ลบ')}
                            >
                              <Icon name="x" size={16} />
                            </button>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              defaultValue={item.requestedQty ?? ''}
                              onBlur={(e) => void setQty(item, Number(e.target.value), item.entryUnit)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              }}
                              aria-label={t('จำนวน')}
                            />
                            {units.length === 0 ? (
                              <Select value="" disabled aria-label={t('หน่วย')}>
                                <option value="">{item.unit}</option>
                              </Select>
                            ) : (
                              <UnitSelect
                                units={units}
                                value={item.entryUnit ?? ''}
                                onChange={(u) => void setQty(item, item.requestedQty ?? 0, u)}
                                product={p}
                              />
                            )}
                            <Select value={item.supplierId} onChange={(e) => void changeSupplier(item, e.target.value)} aria-label={t('ผู้ขาย')}>
                              {supplierOptionsFor(item).map(({ s, listed, primary }) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                  {primary ? ` (${t('ผู้ขายประจำ')})` : listed ? ` (${t('สำรอง')})` : ''}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="mt-1 text-xs text-ink-faint">
                            {t('ขอ {qty} {unit}', { qty: fmtQty(item.requestedQty ?? 0), unit: item.entryUnit ?? item.unit })}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate('/requests')} disabled={!!busy}>
              {t('บันทึกร่าง')}
            </Button>
            <Button onClick={() => void submit()} disabled={!!busy || items.length === 0}>
              <Icon name="arrowRight" size={16} />
              {busy === 'submit' ? t('กำลังส่ง...') : t('ส่งให้หัวหน้าตรวจ')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
