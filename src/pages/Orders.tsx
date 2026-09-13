import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useData } from '../data/DataContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Icon } from '../components/Icon'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui'
import {
  CHASE_AFTER_DAYS,
  createPurchaseOrder,
  daysWaiting,
  deletePurchaseOrder,
  listOrdersInRange,
  overdueOrders,
  receivePurchaseOrder,
  summariseBySupplier,
} from '../services/purchaseOrders'
import { useSuppliers } from '../services/suppliers'
import { fmtQty, formatThaiDate, msToDateInput, dateInputToMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import type { Product, PurchaseOrder, Supplier } from '../types'

/**
 * Orders out, and goods in.
 *
 * ## Why a window, and not everything
 *
 * Orders are read one date range at a time, like the calendar, because the question is
 * always "this week" and never "everything since we started". Nothing here is subscribed:
 * this screen is opened deliberately, a few times a day, by one person.
 *
 * ## Why the list a new order starts from is free
 *
 * Picking a supplier fills the sheet with everything they sell. That comes from the
 * catalogue already in memory, filtered by the supplier link on each product — no read, no
 * query, however many suppliers there are.
 */

type Tab = 'open' | 'received' | 'summary'

const DAY = 86_400_000

export function OrdersPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { products, locations, locationById } = useData()
  const suppliers = useSuppliers()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('open')
  const [days, setDays] = useState(30)
  const [creating, setCreating] = useState(false)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const to = Date.now()
      setOrders(await listOrdersInRange(to - days * DAY, to + DAY))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [days, toast, t])

  useEffect(() => {
    void load()
  }, [load])

  const late = useMemo(() => overdueOrders(orders), [orders])
  const lateIds = useMemo(() => new Set(late.map((o) => o.id)), [late])
  const open = orders.filter((o) => o.status !== 'received')
  const received = orders.filter((o) => o.status === 'received')
  const summary = useMemo(() => summariseBySupplier(orders), [orders])

  async function remove(order: PurchaseOrder) {
    const ok = await confirm({
      title: t('ยกเลิกใบสั่งซื้อ'),
      message: t('ยกเลิก {docNo} ? ใบที่ยังไม่รับของเท่านั้นที่ยกเลิกได้', { docNo: order.docNo }),
      danger: true,
      confirmText: t('ยกเลิกใบสั่งซื้อ'),
    })
    if (!ok) return
    try {
      await deletePurchaseOrder(order.id)
      toast.success(t('ยกเลิกแล้ว'))
      await load()
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  if (loading) return <Spinner label={t('กำลังโหลดใบสั่งซื้อ...')} />

  const shown = tab === 'open' ? open : tab === 'received' ? received : []

  return (
    <div className="space-y-4">
      <PageHeader
        icon="truck"
        title={t('สั่งซื้อ')}
        subtitle={t('สั่งของกับผู้ขาย ตรวจรับ แล้วเข้าคลังในขั้นตอนเดียว')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            {t('สั่งของใหม่')}
          </Button>
        }
      />

      {/* The thing worth interrupting someone about: goods that never turned up. */}
      {late.length > 0 && (
        <Card className="border-danger/40 bg-danger-soft p-3">
          <div className="flex items-center gap-2 text-sm">
            <Icon name="warning" size={18} className="shrink-0 text-danger" />
            <span className="font-medium text-danger">
              {t('{count} ใบสั่งซื้อเกิน {days} วันแล้วยังไม่ได้รับของ', {
                count: late.length,
                days: CHASE_AFTER_DAYS,
              })}
            </span>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {(['open', 'received', 'summary'] as Tab[]).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`min-h-9 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                tab === k ? 'bg-brand text-white' : 'text-ink-soft hover:bg-sunken'
              }`}
            >
              {k === 'open'
                ? t('รอรับของ ({count})', { count: open.length })
                : k === 'received'
                  ? t('รับของแล้ว ({count})', { count: received.length })
                  : t('สรุปตามผู้ขาย')}
            </button>
          ))}
          <div className="ml-auto">
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              <option value="7">{t('7 วันล่าสุด')}</option>
              <option value="30">{t('30 วันล่าสุด')}</option>
              <option value="90">{t('90 วันล่าสุด')}</option>
            </Select>
          </div>
        </div>

        {tab === 'summary' ? (
          <SupplierSummary rows={summary} />
        ) : shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-soft">{t('ไม่มีใบสั่งซื้อในช่วงนี้')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                late={lateIds.has(o.id)}
                locationName={locationById(o.locationId)?.name ?? ''}
                onOpen={() => setViewing(o)}
                onReceive={() => setReceiving(o)}
                onRemove={() => void remove(o)}
              />
            ))}
          </ul>
        )}
      </Card>

      {creating && user && (
        <NewOrderModal
          suppliers={suppliers}
          products={products}
          locations={locations}
          actor={{ id: user.id, name: user.name }}
          onClose={() => setCreating(false)}
          onDone={() => void load()}
        />
      )}
      {receiving && user && (
        <ReceiveModal
          order={receiving}
          actor={{ id: user.id, name: user.name }}
          onClose={() => setReceiving(null)}
          onDone={() => void load()}
        />
      )}
      {viewing && <OrderSheet order={viewing} locationName={locationById(viewing.locationId)?.name ?? ''} onClose={() => setViewing(null)} />}
    </div>
  )
}

function OrderRow({
  order,
  late,
  locationName,
  onOpen,
  onReceive,
  onRemove,
}: {
  order: PurchaseOrder
  late: boolean
  locationName: string
  onOpen: () => void
  onReceive: () => void
  onRemove: () => void
}) {
  const t = useT()
  const done = order.status === 'received'
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{order.supplierName}</span>
          <span className="doc-no text-xs text-ink-faint">{order.docNo}</span>
          {done ? (
            <Badge color="green">{t('รับของแล้ว')}</Badge>
          ) : (
            <Badge color={late ? 'red' : 'blue'}>{t('สั่งแล้ว')}</Badge>
          )}
          {late && (
            <Badge color="red">
              {t('รอมา {days} วัน', { days: daysWaiting(order) })}
            </Badge>
          )}
        </div>
        <div className="text-xs text-ink-soft">
          {formatThaiDate(order.orderedAt)} · {locationName} ·{' '}
          {t('{count} รายการ', { count: order.lines.length })}
          {order.invoiceNo ? ` · ${t('บิล')} ${order.invoiceNo}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={onOpen}>
          {t('ดูใบสั่ง')}
        </Button>
        {!done && <Button onClick={onReceive}>{t('ตรวจรับของ')}</Button>}
        {!done && (
          <button
            onClick={onRemove}
            className="rounded px-2 text-xs font-medium text-danger hover:bg-danger-soft"
          >
            {t('ยกเลิก')}
          </button>
        )}
      </div>
    </li>
  )
}

function SupplierSummary({
  rows,
}: {
  rows: { supplierName: string; orders: number; lines: number; items: number }[]
}) {
  const t = useT()
  if (rows.length === 0) {
    return <p className="p-8 text-center text-sm text-ink-soft">{t('ไม่มีใบสั่งซื้อในช่วงนี้')}</p>
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-sunken text-xs text-ink-soft">
        <tr>
          <th className="p-2 text-left font-medium">{t('ผู้ขาย')}</th>
          <th className="p-2 text-right font-medium">{t('ใบสั่ง')}</th>
          <th className="p-2 text-right font-medium">{t('รายการ')}</th>
          <th className="p-2 text-right font-medium">{t('จำนวนรวม')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.supplierName}>
            <td className="p-2 font-medium text-ink">{r.supplierName}</td>
            <td className="num p-2 text-right">{r.orders}</td>
            <td className="num p-2 text-right">{r.lines}</td>
            <td className="num p-2 text-right">{fmtQty(r.items)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Start an order: pick a supplier, and everything they sell is already on the sheet.
 *
 * The staff member types quantities against the few they want rather than hunting for each
 * product, which is the whole reason the supplier link exists.
 */
function NewOrderModal({
  suppliers,
  products,
  locations,
  actor,
  onClose,
  onDone,
}: {
  suppliers: Supplier[]
  products: Product[]
  locations: { id: string; name: string; active?: boolean }[]
  actor: { id: string; name: string }
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const toast = useToast()
  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState(active[0]?.id ?? '')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  // Free: the catalogue is already in memory, and the link is a field on each product.
  const theirs = useMemo(() => {
    if (!supplierId) return []
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => p.supplierId === supplierId && p.active !== false)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, supplierId, search])

  const chosen = Object.entries(qty).filter(([, n]) => n > 0)

  async function save() {
    setBusy(true)
    try {
      const supplier = suppliers.find((s) => s.id === supplierId)
      if (!supplier) throw new Error('no supplier')
      await createPurchaseOrder({
        supplier,
        locationId,
        lines: chosen.map(([productId, n]) => ({ productId, qty: n })),
        products,
        actor,
      })
      toast.success(t('สั่งของแล้ว'))
      onDone()
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('สั่งของใหม่')} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ผู้ขาย')} required>
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value)
                setQty({})
              }}
            >
              <option value="">{t('— เลือกผู้ขาย —')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('คลังปลายทาง')} required>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {supplierId && (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('ค้นหาในรายการของผู้ขายรายนี้')}
            />
            <div className="max-h-80 overflow-auto rounded-lg border border-line">
              {theirs.length === 0 ? (
                <p className="p-6 text-center text-sm text-ink-soft">
                  {t('ผู้ขายรายนี้ยังไม่มีสินค้าผูกไว้')}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {theirs.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 p-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{p.name}</span>
                        <span className="doc-no block text-xs text-ink-faint">{p.sku}</span>
                      </span>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        className="w-24 text-right"
                        value={qty[p.id] ?? ''}
                        onChange={(e) =>
                          setQty((cur) => ({ ...cur, [p.id]: Number(e.target.value) }))
                        }
                      />
                      <span className="w-10 text-xs text-ink-soft">{p.unitType}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || chosen.length === 0 || !locationId}>
            {busy ? t('กำลังบันทึก...') : t('สั่งของ ({count} รายการ)', { count: chosen.length })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Check a delivery in, line by line.
 *
 * Every line has to be answered: ticked as correct, or given the quantity that actually
 * arrived and a reason why it differs. The invoice number is required before any of it can
 * reach the books — the same thing the receiving screen asks for when a delivery is keyed by
 * hand, and for the same reason.
 */
function ReceiveModal({
  order,
  actor,
  onClose,
  onDone,
}: {
  order: PurchaseOrder
  actor: { id: string; name: string }
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [invoiceNo, setInvoiceNo] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(Date.now()))
  const [state, setState] = useState<Record<string, { checked: boolean; qty: number; note: string }>>(
    () =>
      Object.fromEntries(
        order.lines.map((l) => [l.productId, { checked: true, qty: l.orderedQty, note: '' }]),
      ),
  )
  const [busy, setBusy] = useState(false)

  function set(productId: string, patch: Partial<{ checked: boolean; qty: number; note: string }>) {
    setState((cur) => ({ ...cur, [productId]: { ...cur[productId], ...patch } }))
  }

  const needsReason = order.lines.filter((l) => {
    const s = state[l.productId]
    return !s.checked && s.qty !== l.orderedQty && !s.note.trim()
  })

  async function save() {
    setBusy(true)
    try {
      const result = await receivePurchaseOrder({
        orderId: order.id,
        invoiceNo,
        date: dateInputToMs(dateStr),
        lines: order.lines.map((l) => ({
          productId: l.productId,
          receivedQty: state[l.productId].qty,
          checked: state[l.productId].checked,
          note: state[l.productId].note,
        })),
        actor,
      })
      toast.success(
        t('รับของเข้าคลังแล้ว (เลขที่ {docNo}) {count} รายการ', {
          docNo: result.docNo,
          count: result.receivedLines,
        }),
      )
      onDone()
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('ตรวจรับของ {docNo}', { docNo: order.docNo })} wide>
      <div className="space-y-4">
        <div className="rounded-lg bg-sunken px-3 py-2 text-sm">
          <span className="font-medium text-ink">{order.supplierName}</span>
          <span className="text-ink-soft"> · {formatThaiDate(order.orderedAt)}</span>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto">
          {order.lines.map((l) => {
            const s = state[l.productId]
            const differs = !s.checked && s.qty !== l.orderedQty
            return (
              <div key={l.productId} className="rounded-lg border border-line p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{l.productName}</span>
                  <span className="text-xs text-ink-soft">
                    {t('สั่ง')} {fmtQty(l.orderedQty)} {l.unit}
                  </span>
                  {/* One tap for the common case: it arrived exactly as ordered. */}
                  <button
                    onClick={() => set(l.productId, { checked: !s.checked, qty: l.orderedQty })}
                    className={`inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                      s.checked
                        ? 'bg-in-soft text-in'
                        : 'border border-line-strong text-ink-soft hover:bg-sunken'
                    }`}
                  >
                    <Icon name="check" size={15} />
                    {t('ถูกต้อง')}
                  </button>
                </div>
                {!s.checked && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      className="text-right"
                      value={s.qty}
                      onChange={(e) => set(l.productId, { qty: Number(e.target.value) })}
                    />
                    <Input
                      value={s.note}
                      onChange={(e) => set(l.productId, { note: e.target.value })}
                      placeholder={t('เหตุผลที่จำนวนไม่ตรง (บังคับ)')}
                      className={differs && !s.note.trim() ? 'border-danger bg-danger-soft' : ''}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('เลขที่บิล / ใบส่งของ')} required>
            <Input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder={t('เช่น IV2616876')}
            />
          </Field>
          <Field label={t('วันที่รับ')}>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
        </div>

        {needsReason.length > 0 && (
          <p className="text-xs text-danger">
            {t('ยังไม่ได้ระบุเหตุผล {count} รายการ', { count: needsReason.length })}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ยกเลิก')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !invoiceNo.trim() || needsReason.length > 0}
          >
            {busy ? t('กำลังบันทึก...') : t('ยืนยันรับเข้าคลัง')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The order as a sheet: small enough to photograph and send, and it prints to A5.
 *
 * Built as a page rather than a generated PDF because that is what it is for — someone
 * screenshots it into the LINE group, or prints it. The print rules live in index.css so the
 * browser's own print dialog produces the A5 without another library in the bundle.
 */
function OrderSheet({
  order,
  locationName,
  onClose,
}: {
  order: PurchaseOrder
  locationName: string
  onClose: () => void
}) {
  const t = useT()
  return (
    <Modal open onClose={onClose} title={t('ใบสั่งซื้อ {docNo}', { docNo: order.docNo })}>
      <div className="space-y-3">
        <div id="order-sheet" className="rounded-lg border border-line-strong bg-surface p-4">
          <div className="flex items-start justify-between gap-3 border-b border-line pb-2">
            <div>
              <div className="text-base font-bold text-ink">{t('ใบสั่งซื้อ')}</div>
              <div className="doc-no text-xs text-ink-faint">{order.docNo}</div>
            </div>
            <div className="text-right text-xs text-ink-soft">
              <div>{formatThaiDate(order.orderedAt)}</div>
              <div>{locationName}</div>
            </div>
          </div>
          <div className="py-2 text-sm">
            <span className="text-ink-soft">{t('ผู้ขาย')}: </span>
            <span className="font-semibold text-ink">{order.supplierName}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="border-y border-line text-xs text-ink-soft">
              <tr>
                <th className="py-1 text-left font-medium">{t('รายการ')}</th>
                <th className="py-1 text-right font-medium">{t('จำนวน')}</th>
                <th className="py-1 text-left font-medium">{t('หน่วย')}</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.productId} className="border-b border-line/60">
                  <td className="py-1 pr-2 text-ink">{l.productName}</td>
                  <td className="num py-1 text-right font-semibold text-ink">
                    {fmtQty(l.orderedQty)}
                  </td>
                  <td className="py-1 pl-2 text-ink-soft">{l.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pt-2 text-xs text-ink-faint">
            {t('ผู้สั่ง')}: {order.createdByName}
            {order.invoiceNo ? ` · ${t('บิล')} ${order.invoiceNo}` : ''}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ปิด')}
          </Button>
          <Button onClick={() => window.print()}>
            <Icon name="download" size={16} />
            {t('พิมพ์ / บันทึก PDF (A5)')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
