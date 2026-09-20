import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useData } from '../data/DataContext'
import { orderCache } from '../data/orderCache'
import { useToast } from '../components/Toast'
import { DataTable } from '../components/DataTable'
import { SiteChip } from '../components/SiteChip'
import { Icon } from '../components/Icon'
import { ReasonModal } from './requests/ReasonModal'
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
  Textarea,
} from '../components/ui'
import {
  CHASE_AFTER_DAYS,
  amendPurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  daysWaiting,
  expectedDeliveryAt,
  listOrdersInRange,
  needsResend,
  overdueOrders,
  receivePurchaseOrder,
  summariseBySupplier,
} from '../services/purchaseOrders'
import { useSuppliers } from '../services/suppliers'
import { useEntryUnits } from '../services/entryUnits'
import { QtyInput } from '../components/QtyInput'
import { PoSheet, SheetLangToggle } from '../components/PoSheet'
import { renderElementToJpeg, sheetFileName } from '../lib/poImage'
import { shownUnit } from '../lib/ledger'
import { sameUnit } from '../lib/units'
import { fmtQty, formatThaiDate, formatThaiDateTime, msToDateInput, dateInputToMs } from '../lib/format'
import { useI18n, useT, type Lang } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import type { PoRevisionChange, PoRevisionEntry, Product, PurchaseOrder, Supplier } from '../types'
import { looseMatch } from '../lib/search'

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

type Tab = 'open' | 'received' | 'cancelled' | 'summary'

const DAY = 86_400_000

export function OrdersPage() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { products, locations, locationById } = useData()
  const navigate = useNavigate()
  const suppliers = useSuppliers()
  const [params, setParams] = useSearchParams()
  const [busyExport, setBusyExport] = useState<'' | 'excel' | 'pdf'>('')

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('open')
  const [days, setDays] = useState(30)
  const [creating, setCreating] = useState(false)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null)
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null)
  const [amending, setAmending] = useState<PurchaseOrder | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const to = Date.now()
      const rows = await listOrdersInRange(to - days * DAY, to + DAY)
      setOrders(rows)
      // Keep the calendar's copy current without it re-reading the month.
      for (const o of rows) orderCache.patch(o)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [days, toast, t])

  useEffect(() => {
    void load()
  }, [load])

  // Opened from the calendar: ?po=<id> shows the sheet, ?receive=<id> opens the check-in.
  // Consumed once the list is here, and cleared so a refresh does not reopen it.
  useEffect(() => {
    if (loading) return
    const po = params.get('po')
    const receive = params.get('receive')
    if (!po && !receive) return
    const hit = orders.find((o) => o.id === (po ?? receive))
    if (hit) (po ? setViewing : setReceiving)(hit)
    setParams({}, { replace: true })
  }, [loading, orders, params, setParams])

  const leadTimeOf = useCallback(
    (supplierId: string) => suppliers.find((x) => x.id === supplierId)?.leadTimeDays,
    [suppliers],
  )
  const late = useMemo(() => overdueOrders(orders, Date.now(), leadTimeOf), [orders, leadTimeOf])

  const lateIds = useMemo(() => new Set(late.map((o) => o.id)), [late])
  const open = orders.filter((o) => o.status === 'ordered' || o.status === 'draft')
  const received = orders.filter((o) => o.status === 'received')
  // Cancelled orders stay in the list: the number, who called it off and why are the
  // trail an audit follows. Nothing on this screen deletes an order.
  const cancelled = orders.filter((o) => o.status === 'cancelled')
  const summary = useMemo(() => summariseBySupplier(orders), [orders])

  async function cancel(order: PurchaseOrder, reason: string) {
    if (!user) return
    try {
      const next = await cancelPurchaseOrder({ id: order.id, reason, actor: { id: user.id, name: user.name } })
      setOrders((cur) => cur.map((o) => (o.id === order.id ? next : o)))
      setCancelling(null)
      toast.success(t('ยกเลิก {docNo} แล้ว', { docNo: order.docNo }))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  /**
   * The orders in view, one row per line: which day, which supplier, which item, how many.
   *
   * That is the question the owner asked the export to answer, so a line is the row and
   * not the order — an order of twelve items is twelve rows that each carry the date and
   * the supplier, which is what a spreadsheet filter needs. Sorted oldest first so the
   * sheet reads as a diary. Received orders also carry what actually arrived.
   */
  function exportRows() {
    const inView = tab === 'received' ? received : tab === 'open' ? open : tab === 'cancelled' ? cancelled : orders
    return [...inView]
      .sort((a, b) => a.orderedAt - b.orderedAt)
      .flatMap((o) =>
        o.lines.map((l) => ({
          [t('วันที่สั่ง')]: formatThaiDate(o.orderedAt),
          [t('เลขที่')]: o.docNo,
          [t('ผู้ขาย')]: o.supplierName,
          [t('คลังปลายทาง')]: locationById(o.locationId)?.name ?? '',
          [t('สินค้า')]: l.productName,
          [t('จำนวนที่สั่ง')]: l.orderedQty,
          [t('หน่วย')]: shownUnit(l),
          [t('สถานะ')]:
            o.status === 'received'
              ? t('รับของแล้ว')
              : o.status === 'draft'
                ? t('ร่าง')
                : o.status === 'cancelled'
                  ? t('ยกเลิกแล้ว')
                  : t('สั่งแล้ว'),
          [t('กำหนดส่ง')]: o.expectedAt ? formatThaiDate(o.expectedAt) : '',
          [t('แก้ไขครั้งที่')]: o.revision ?? '',
          [t('จำนวนที่รับ')]: o.status === 'received' ? (l.receivedQty ?? '') : '',
          [t('วันที่รับ')]: o.receivedAt ? formatThaiDate(o.receivedAt) : '',
          [t('เลขที่บิล')]: o.invoiceNo ?? '',
          [t('ผู้สั่ง')]: o.createdByName,
          [t('ผู้ยกเลิก')]: o.cancelledByName ?? '',
          [t('เหตุผลที่ยกเลิก')]: o.cancelReason ?? '',
          [t('หมายเหตุ')]: l.note ?? '',
        })),
      )
  }

  async function exportExcelFile() {
    setBusyExport('excel')
    try {
      const { exportExcel } = await import('../lib/export')
      exportExcel(t('ใบสั่งซื้อ_{ts}', { ts: Date.now() }), 'Orders', exportRows())
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusyExport('')
    }
  }

  async function exportPdfFile() {
    setBusyExport('pdf')
    try {
      const { exportReportPdf } = await import('../lib/export')
      const rows = exportRows()
      const head = rows.length ? Object.keys(rows[0]) : []
      exportReportPdf({
        filename: t('ใบสั่งซื้อ_{ts}', { ts: Date.now() }),
        title: t('รายการสั่งซื้อ — {company}', { company: brand ? brandDef(brand).name : '' }),
        meta: [
          t('{days} วันล่าสุด', { days }),
          tab === 'received' ? t('รับของแล้ว') : tab === 'open' ? t('รอรับของ') : tab === 'cancelled' ? t('ยกเลิกแล้ว') : t('ทั้งหมด'),
        ],
        head,
        body: rows.map((r) => head.map((h) => r[h])),
      })
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusyExport('')
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
          // Two ways in, same orders underneath: the list from Excel, or one supplier by
          // hand. The manual screen stays exactly as it was for the days it is the right tool.
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/purchase')}>
              <Icon name="upload" size={16} />
              {t('นำเข้า Excel (ทางเลือก)')}
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              {t('สั่งของใหม่ (สั่งเอง)')}
            </Button>
          </div>
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
          {(['open', 'received', 'cancelled', 'summary'] as Tab[]).map((k) => (
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
                  : k === 'cancelled'
                    ? t('ยกเลิกแล้ว ({count})', { count: cancelled.length })
                    : t('สรุปตามผู้ขาย')}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              <option value="7">{t('7 วันล่าสุด')}</option>
              <option value="30">{t('30 วันล่าสุด')}</option>
              <option value="90">{t('90 วันล่าสุด')}</option>
            </Select>
            {/* What was ordered on which day, as a sheet — the summary the owner asked for
                in a form that leaves the app. Exports what the tab shows. */}
            <Button
              variant="secondary"
              onClick={() => void exportExcelFile()}
              disabled={!!busyExport || orders.length === 0}
            >
              <Icon name="download" size={16} />
              {busyExport === 'excel' ? t('กำลังสร้างไฟล์...') : 'Excel'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void exportPdfFile()}
              disabled={!!busyExport || orders.length === 0}
            >
              <Icon name="download" size={16} />
              {busyExport === 'pdf' ? t('กำลังสร้างไฟล์...') : 'PDF'}
            </Button>
          </div>
        </div>

        {tab === 'summary' ? (
          <SupplierSummary rows={summary} />
        ) : tab === 'cancelled' ? (
          <CancelledTable rows={cancelled} onOpen={setViewing} />
        ) : shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-soft">{t('ไม่มีใบสั่งซื้อในช่วงนี้')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                late={lateIds.has(o.id)}
                expectedAt={expectedDeliveryAt(o, leadTimeOf(o.supplierId))}
                onOpen={() => setViewing(o)}
                onReceive={() => setReceiving(o)}
                onAmend={() => setAmending(o)}
                onCancel={() => setCancelling(o)}
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
      {amending && user && (
        <AmendOrderModal
          order={amending}
          products={products}
          actor={{ id: user.id, name: user.name }}
          onClose={() => setAmending(null)}
          onDone={(next) => setOrders((cur) => cur.map((o) => (o.id === next.id ? next : o)))}
        />
      )}
      {cancelling && (
        <ReasonModal
          title={t('ยกเลิกใบสั่งซื้อ {docNo}', { docNo: cancelling.docNo })}
          message={t('ใบนี้จะยังอยู่ในรายการ "ยกเลิกแล้ว" พร้อมชื่อผู้ยกเลิกและเหตุผล เลขที่จะไม่ถูกนำกลับมาใช้')}
          confirmText={t('ยกเลิกใบสั่งซื้อ')}
          danger
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => cancel(cancelling, reason)}
        />
      )}
    </div>
  )
}

/** The orders called off, as a table: the trail an audit reads. */
function CancelledTable({ rows, onOpen }: { rows: PurchaseOrder[]; onOpen: (o: PurchaseOrder) => void }) {
  const t = useT()
  const sorted = [...rows].sort((a, b) => (b.cancelledAt ?? 0) - (a.cancelledAt ?? 0))
  return (
    <div className="p-3">
      <DataTable
        rows={sorted}
        rowKey={(o) => o.id}
        onRowClick={onOpen}
        empty={<p className="p-8 text-center text-sm text-ink-soft">{t('ไม่มีใบสั่งซื้อที่ยกเลิกในช่วงนี้')}</p>}
        columns={[
          { key: 'docNo', header: t('เลขที่'), primary: true, cell: (o) => <span className="doc-no">{o.docNo}</span> },
          { key: 'supplier', header: t('ผู้ขาย'), cell: (o) => o.supplierName },
          { key: 'ordered', header: t('วันที่สั่ง'), cell: (o) => formatThaiDate(o.orderedAt) },
          { key: 'location', header: t('คลังปลายทาง'), cell: (o) => <SiteChip locationId={o.locationId} /> },
          { key: 'lines', header: t('รายการ'), align: 'right', cell: (o) => o.lines.length },
          { key: 'by', header: t('ผู้ยกเลิก'), cell: (o) => o.cancelledByName ?? '' },
          { key: 'at', header: t('ยกเลิกเมื่อ'), cell: (o) => (o.cancelledAt ? formatThaiDateTime(o.cancelledAt) : '') },
          { key: 'reason', header: t('เหตุผล'), cell: (o) => <span className="whitespace-pre-line">{o.cancelReason ?? ''}</span> },
        ]}
      />
    </div>
  )
}

function OrderRow({
  order,
  late,
  expectedAt,
  onOpen,
  onReceive,
  onAmend,
  onCancel,
}: {
  order: PurchaseOrder
  late: boolean
  /** The day the goods are due — written on the order, or counted from the lead time. */
  expectedAt?: number
  onOpen: () => void
  onReceive: () => void
  onAmend: () => void
  onCancel: () => void
}) {
  const t = useT()
  const done = order.status === 'received'
  // A draft is a proposal from an imported list that nobody has approved yet. It is
  // shown so the person knows it exists, but it is not waiting for goods and cannot be
  // received — approving happens on the batch screen it came from.
  const draft = order.status === 'draft'
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{order.supplierName}</span>
          <span className="doc-no text-xs text-ink-faint">{order.docNo}</span>
          {done ? (
            <Badge color="green">{t('รับของแล้ว')}</Badge>
          ) : draft ? (
            <Badge color="slate">{t('ร่าง — รออนุมัติ')}</Badge>
          ) : (
            <Badge color={late ? 'red' : 'blue'}>{t('สั่งแล้ว')}</Badge>
          )}
          {order.revision ? <Badge color="amber">Rev.{order.revision}</Badge> : null}
          {needsResend(order) ? (
            <Badge color="red">{t('แก้ไขแล้ว — ยังไม่ส่งใหม่')}</Badge>
          ) : (
            order.shareStatus === 'sent' && <Badge color="green">{t('ส่งเข้า LINE แล้ว')}</Badge>
          )}
          {order.requestId && (
            <Link to={`/requests/${order.requestId}`} className="text-xs text-brand hover:underline">
              {t('จากรายการขอสั่งซื้อ')}
            </Link>
          )}
          {late && (
            <Badge color="red">
              {t('รอมา {days} วัน', { days: daysWaiting(order) })}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
          {formatThaiDate(order.orderedAt)} · <SiteChip locationId={order.locationId} /> ·{' '}
          {t('{count} รายการ', { count: order.lines.length })}
          {order.invoiceNo ? ` · ${t('บิล')} ${order.invoiceNo}` : ''}
          {/* The day the supplier is to deliver — set when the order is placed (by hand or
              from a request) and read-only here; the calendar and the "late" flag follow it. */}
          {!done && !draft && expectedAt !== undefined && (
            <>
              {' · '}
              {t('กำหนดส่ง')} {formatThaiDate(expectedAt)}
              {order.expectedAt === undefined && <span className="text-ink-faint"> ({t('ตามระยะส่งของผู้ขาย')})</span>}
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={onOpen}>
          {t('ดูใบสั่ง')}
        </Button>
        {!done && !draft && (
          <Button variant="ghost" onClick={onAmend}>
            {t('แก้ไข')}
          </Button>
        )}
        {!done && !draft && <Button onClick={onReceive}>{t('ตรวจรับของ')}</Button>}
        {!done && (
          <button
            onClick={onCancel}
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
type LineDraft = Record<string, { qty: number; unit: string }>

/** The supplier's products with a quantity box each — the body of placing and of amending. */
function LineList({
  products,
  lines,
  setLines,
  plainUnits,
}: {
  products: Product[]
  lines: LineDraft
  setLines: (fn: (cur: LineDraft) => LineDraft) => void
  plainUnits: string[]
}) {
  const t = useT()
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      {products.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-soft">{t('ผู้ขายรายนี้ยังไม่มีสินค้าผูกไว้')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {products.map((p) => {
            const line = lines[p.id]
            const mismatch = !!line && line.qty > 0 && !sameUnit(line.unit, p.unitType)
            return (
              <li key={p.id} className="p-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{p.name}</span>
                    <span className="flex gap-2 text-xs text-ink-faint">
                      <span className="doc-no">{p.sku}</span>
                      <span>
                        {t('หน่วยรับเข้า')}: {p.unitType}
                      </span>
                    </span>
                  </span>
                  {/* The same box the receiving screen uses, so the units on offer
                      here are the units the delivery can be keyed in. */}
                  <div className="w-full shrink-0 sm:w-56">
                    <QtyInput
                      unitType={p.unitType}
                      plainUnits={plainUnits}
                      conversions={p.unitConversions}
                      value={line?.qty ?? 0}
                      onChange={(qty, unit) => setLines((cur) => ({ ...cur, [p.id]: { qty, unit } }))}
                      invalid={mismatch}
                    />
                  </div>
                </div>
                {mismatch && (
                  <p role="alert" className="mt-1 text-xs font-medium text-danger">
                    {t('หน่วยที่คุณเลือกกับหน่วยรับเข้าสินค้าไม่ตรงกัน กรุณาตรวจสอบอีกครั้งก่อนกดยืนยัน')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Change a placed order: the PO revision. Starts from the order as it stands, with the
 * supplier's other products below at zero for adding; a quantity set to zero drops the
 * line. Asks why, because the supplier will get the sheet again and the audit will ask.
 */
function AmendOrderModal({
  order,
  products,
  actor,
  onClose,
  onDone,
}: {
  order: PurchaseOrder
  products: Product[]
  actor: { id: string; name: string }
  onClose: () => void
  onDone: (next: PurchaseOrder) => void
}) {
  const t = useT()
  const toast = useToast()
  const plainUnits = useEntryUnits()
  const [lines, setLines] = useState<LineDraft>(() =>
    Object.fromEntries(order.lines.map((l) => [l.productId, { qty: l.orderedQty, unit: shownUnit(l) }])),
  )
  const [expected, setExpected] = useState(order.expectedAt !== undefined ? msToDateInput(order.expectedAt) : '')
  const [note, setNote] = useState(order.note ?? '')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  // The order's own lines first, whatever state their product is in now, then the rest of
  // what the supplier sells.
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const onOrder = new Set(order.lines.map((l) => l.productId))
    const own = products.filter((p) => onOrder.has(p.id))
    const others = products
      .filter((p) => !onOrder.has(p.id) && p.supplierId === order.supplierId && p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...own, ...others].filter((p) => looseMatch([p.name, p.sku], q))
  }, [products, order, search])

  const chosen = Object.entries(lines).filter(([, l]) => l.qty > 0)

  async function save() {
    setBusy(true)
    try {
      const next = await amendPurchaseOrder({
        id: order.id,
        lines: chosen.map(([productId, l]) => ({ productId, qty: l.qty, entryUnit: l.unit })),
        ...(expected ? { expectedAt: dateInputToMs(expected) } : {}),
        note,
        reason,
        products,
        actor,
      })
      onDone(next)
      toast.success(t('แก้ไขใบสั่งซื้อแล้ว (Rev.{n}) — อย่าลืมส่งใบใหม่ให้ผู้ขาย', { n: next.revision ?? 1 }))
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('แก้ไขใบสั่งซื้อ {docNo}', { docNo: order.docNo })} wide>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          {t('เลขที่เดิมคงไว้ ใบจะขึ้นเป็น Rev.{n} และต้องส่งให้ผู้ขายอีกครั้ง การแก้ทุกครั้งถูกบันทึกในใบ', { n: (order.revision ?? 0) + 1 })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ผู้ขาย')}>
            <Input value={order.supplierName} readOnly />
          </Field>
          <Field label={t('วันที่ให้ส่งของ')}>
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('ค้นหาในรายการของผู้ขายรายนี้')} />
        <LineList products={list} lines={lines} setLines={setLines} plainUnits={plainUnits} />
        <Field label={t('หมายเหตุในใบ')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={t('เหตุผลที่แก้ไข')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('เช่น ผู้ขายแจ้งว่าของไม่พอ / สาขาขอเพิ่ม')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || chosen.length === 0 || !reason.trim()}>
            {busy ? t('กำลังบันทึก...') : t('บันทึกการแก้ไข ({count} รายการ)', { count: chosen.length })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** One revision's line in the history under the sheet: what moved, said in the reader's language. */
function describeChange(c: PoRevisionChange, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (c.kind) {
    case 'qty':
      return t('{name}: {from} → {to} {unit}', { name: c.productName, from: fmtQty(c.from), to: fmtQty(c.to), unit: c.unit })
    case 'add':
      return t('เพิ่ม {name} {qty} {unit}', { name: c.productName, qty: fmtQty(c.to), unit: c.unit })
    case 'remove':
      return t('ตัด {name} ({qty} {unit})', { name: c.productName, qty: fmtQty(c.from), unit: c.unit })
    case 'expectedAt':
      return t('กำหนดส่ง: {from} → {to}', { from: c.from !== undefined ? formatThaiDate(c.from) : '—', to: c.to !== undefined ? formatThaiDate(c.to) : '—' })
    case 'note':
      return t('หมายเหตุ: {from} → {to}', { from: c.from ?? '—', to: c.to ?? '—' })
  }
}

function RevisionHistory({ revisions }: { revisions: PoRevisionEntry[] }) {
  const t = useT()
  return (
    <div className="rounded-lg border border-line bg-sunken p-3 text-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('ประวัติการแก้ไขใบ')}</h3>
      <ol className="space-y-2">
        {[...revisions].reverse().map((r) => (
          <li key={r.rev}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="amber">Rev.{r.rev}</Badge>
              <span className="text-xs text-ink-soft">
                {formatThaiDateTime(r.at)} · {r.byName}
              </span>
            </div>
            <div className="text-ink">{r.reason}</div>
            <ul className="mt-0.5 list-inside list-disc text-xs text-ink-soft">
              {r.changes.map((c, i) => (
                <li key={i}>{describeChange(c, t)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}

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
  // Quantity and the unit it was keyed in, per product. The unit is offered from the same
  // list the receiving screen offers — the product's own first, then the owner's — because
  // the owner's rule is that an order is placed in the unit the goods will be received in.
  const [lines, setLines] = useState<LineDraft>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  // The day the supplier is to deliver. Offered from their lead time; the person may say
  // otherwise. Empty means unknown, and the lead time then stands in on the calendar.
  const [expected, setExpected] = useState('')
  // Read once for the whole form, not once per line.
  const plainUnits = useEntryUnits()

  // Free: the catalogue is already in memory, and the link is a field on each product.
  const theirs = useMemo(() => {
    if (!supplierId) return []
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => p.supplierId === supplierId && p.active !== false)
      .filter((p) => looseMatch([p.name, p.sku], q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, supplierId, search])

  const chosen = Object.entries(lines).filter(([, l]) => l.qty > 0)
  // Lines keyed in a unit other than the one the product is counted in. Allowed — one
  // supplier really does sell by the carton — but said out loud before the order goes.
  const offUnit = chosen.filter(([id, l]) => {
    const p = products.find((x) => x.id === id)
    return p && !sameUnit(l.unit, p.unitType)
  })

  async function save() {
    setBusy(true)
    try {
      const supplier = suppliers.find((s) => s.id === supplierId)
      if (!supplier) throw new Error('no supplier')
      await createPurchaseOrder({
        supplier,
        locationId,
        lines: chosen.map(([productId, l]) => ({ productId, qty: l.qty, entryUnit: l.unit })),
        products,
        actor,
        ...(expected ? { expectedAt: dateInputToMs(expected) } : {}),
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
                setLines({})
                const lead = suppliers.find((s) => s.id === e.target.value)?.leadTimeDays
                setExpected(lead === undefined ? '' : msToDateInput(Date.now() + lead * 86_400_000))
              }}
            >
              <option value="">{t('— เลือกผู้ขาย —')}</option>
              {/* A hidden supplier is one we have stopped ordering from. */}
              {suppliers
                .filter((s) => s.active !== false)
                .map((s) => (
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
          <Field label={t('วันที่ให้ส่งของ')} hint={t('ว่างไว้ = ยังไม่ทราบ ปฏิทินจะใช้ระยะส่งของผู้ขายแทน')}>
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>

        {supplierId && (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('ค้นหาในรายการของผู้ขายรายนี้')}
            />
            <LineList products={theirs} lines={lines} setLines={setLines} plainUnits={plainUnits} />
          </>
        )}

        {offUnit.length > 0 && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {t('มี {n} รายการที่หน่วยไม่ตรงกับหน่วยรับเข้าสินค้า — ตรวจสอบอีกครั้งก่อนกดยืนยัน', { n: offUnit.length })}
          </p>
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
                    {t('สั่ง')} {fmtQty(l.orderedQty)} {shownUnit(l)}
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
  const { lang } = useI18n()
  const toast = useToast()
  const { brand } = useBrand()
  const sheet = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)
  // The sheet's language, chosen here: a foreign supplier gets English, whatever the
  // person sending reads the app in.
  const [sheetLang, setSheetLang] = useState<Lang>(lang)
  // The company placing the order goes on the sheet itself, not on the buttons around it:
  // it is the one thing a supplier reading a photo of this needs that the order does not
  // otherwise carry, and one install serves two companies.
  const company = brand ? brandDef(brand).name : ''

  /**
   * The sheet as a picture, handed to whatever the phone shares with.
   *
   * The owner sends these into a LINE group, and the print dialog is the wrong tool for
   * that. The card is rasterised as drawn — company, number, lines, nothing else — at
   * twice the screen density so it reads on a phone, and offered to the share sheet as a
   * JPG. Where there is no share sheet (a desktop browser, mostly) it downloads instead,
   * which is the same file one step further from the chat.
   */
  async function shareImage() {
    if (!sheet.current) return
    setSharing(true)
    try {
      const blob = await renderElementToJpeg(sheet.current)
      const file = new File([blob], sheetFileName(order.docNo), { type: 'image/jpeg' })
      const title = t('ใบสั่งซื้อ {docNo} — {company}', { docNo: order.docNo, company })
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title })
          return
        } catch (e) {
          // Closing the share sheet without choosing is not an error worth a toast.
          if ((e as { name?: string }).name === 'AbortError') return
          throw e
        }
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success(t('บันทึกรูปแล้ว — เครื่องนี้ไม่มีเมนูแชร์ จึงดาวน์โหลดให้แทน'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setSharing(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('ใบสั่งซื้อ {docNo}', { docNo: order.docNo })}>
      <div className="space-y-3">
        <SheetLangToggle value={sheetLang} onChange={setSheetLang} />
        <PoSheet order={order} locationName={locationName} company={company} ref={sheet} lang={sheetLang} />
        {order.revisions && order.revisions.length > 0 && <RevisionHistory revisions={order.revisions} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ปิด')}
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Icon name="download" size={16} />
            {t('พิมพ์ / บันทึก PDF (A5)')}
          </Button>
          <Button onClick={() => void shareImage()} disabled={sharing}>
            <Icon name="share" size={16} />
            {sharing ? t('กำลังสร้างรูป...') : t('แชร์เป็นรูป (JPG)')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
