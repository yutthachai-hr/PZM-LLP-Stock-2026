import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef, getBrand, type BrandId } from '../brand/brand'
import { useData } from '../data/DataContext'
import { orderCache } from '../data/orderCache'
import { bkkDayEnd, bkkDayStart } from '../lib/inventoryRules/time'
import { ORDER_UPDATED } from '../data/useSupplierRefresh'
import { useToast } from '../components/Toast'
import { DataTable } from '../components/DataTable'
import { SiteChip, SiteSelect } from '../components/SiteChip'
import { Icon, type IconName } from '../components/Icon'
import { ReasonModal } from './requests/ReasonModal'
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  Textarea,
  bannerAction,
  type StatusTabItem,
} from '../components/ui'
import { ChipRow, FramePage, ItemCell, PageHero, frameCard, type Tone } from '../components/frame'
import type { Column } from '../components/DataTable'
import { usePaged } from '../lib/usePaged'
import {
  CHASE_AFTER_DAYS,
  amendPurchaseOrder,
  cancelPurchaseOrder,
  closeOrderRemainder,
  createPurchaseOrder,
  expectedDeliveryAt,
  getPurchaseOrder,
  overdueOrders,
  summariseBySupplier,
} from '../services/purchaseOrders'
import { useSuppliers } from '../services/suppliers'
import { partialLabel } from './receive/receipt'
import { useEntryUnits } from '../services/entryUnits'
import { QtyInput } from '../components/QtyInput'
import { PoSheet, SheetLangToggle } from '../components/PoSheet'
import { SendWizard } from './purchase/SendWizard'
import { LineImportModal } from '../components/import/LineImportModal'
import { DeliveryRiskCard, SupplierConfirmationPanel } from './purchase/SupplierConfirmationPanel'
import { requestedOf } from '../lib/supplierConfirmation'
import { QUICK_FILTERS, matchesStateFilter, presentOrderStatus, stateFilterCounts, type OrderStateFilter, type QuickFilter } from './orders/presentation'
import { LineBadge } from './orders/LineBadge'
import { RowMenu, type RowMenuItem } from '../components/frame/RowMenu'
import { RESUME_PARAM } from '../share/liffResume'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'
import { renderElementToJpeg, sheetFileName } from '../lib/poImage'
import { shownUnit } from '../lib/ledger'
import { sameUnit } from '../lib/units'
import { fmtQty, formatThaiDate, formatThaiDateTime, msToDateInput, dateInputToMs } from '../lib/format'
import { useI18n, useT, type Lang } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import type { PoRevisionChange, PoRevisionEntry, Product, PurchaseOrder, Supplier } from '../types'
import { looseMatch } from '../lib/search'
import { printElement } from '../lib/printSheet'

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

export async function resolvePoDeepLink({
  id,
  brand,
  isAlive,
  open,
  toast,
  t,
  fetchOrder = getPurchaseOrder,
}: {
  id: string
  brand: BrandId | null
  isAlive: () => boolean
  open: (order: PurchaseOrder) => void
  toast: { error: (msg: string) => void }
  t: (thai: string, vars?: Record<string, string | number>) => string
  fetchOrder?: (id: string) => Promise<PurchaseOrder | null>
}): Promise<void> {
  const requestBrand = brand ?? getBrand()
  try {
    const o = await fetchOrder(id)
    if (!isAlive() || getBrand() !== requestBrand || (brand && brand !== requestBrand)) return
    if (o) {
      open(o)
    } else {
      toast.error(t('ไม่พบใบสั่งซื้อ'))
    }
  } catch (e) {
    if (!isAlive() || getBrand() !== requestBrand || (brand && brand !== requestBrand)) return
    toast.error(errText(e, t) || t('โหลดใบสั่งซื้อไม่สำเร็จ'))
  }
}

export async function exportOrdersExcel(
  exportRows: () => Record<string, string | number>[],
  t: (key: string, params?: Record<string, string | number>) => string,
  toast: { success: (m: string) => void; error: (m: string) => void },
  setBusyExport: (kind: '' | 'excel') => void,
) {
  setBusyExport('excel')
  try {
    const { exportExcel } = await import('../lib/export')
    await exportExcel(t('ใบสั่งซื้อ_{ts}', { ts: Date.now() }), 'Orders', exportRows())
    toast.success(t('ดาวน์โหลดไฟล์ Excel แล้ว'))
  } catch (e) {
    toast.error(errText(e, t))
  } finally {
    setBusyExport('')
  }
}

export async function exportOrdersPdf(
  opts: {
    rows: Record<string, string | number>[]
    title: string
    meta: string[]
    filename: string
  },
  t: (key: string, params?: Record<string, string | number>) => string,
  toast: { success: (m: string) => void; error: (m: string) => void },
  setBusyExport: (kind: '' | 'pdf') => void,
) {
  setBusyExport('pdf')
  try {
    const { exportReportPdf } = await import('../lib/export')
    const head = opts.rows.length ? Object.keys(opts.rows[0]) : []
    await exportReportPdf({
      filename: opts.filename,
      title: opts.title,
      meta: opts.meta,
      head,
      body: opts.rows.map((r) => head.map((h) => r[h])),
    })
    toast.success(t('ดาวน์โหลดไฟล์ PDF แล้ว'))
  } catch (e) {
    toast.error(errText(e, t))
  } finally {
    setBusyExport('')
  }
}

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
  const [search, setSearch] = useState('')
  // Set from the late-deliveries banner: the open tab narrowed to the orders it counted.
  const [lateOnly, setLateOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  // Closing what is left of a partly delivered order: the rest is not coming.
  const [closing, setClosing] = useState<PurchaseOrder | null>(null)
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null)
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null)
  const [amending, setAmending] = useState<PurchaseOrder | null>(null)
  // One order sent to LINE from this list — the same wizard the batch and request
  // screens use, so what is recorded on the order is the same (owner, 21 Sep 2026).
  const [sending, setSending] = useState<PurchaseOrder | null>(null)
  // Several orders to LINE in one go — ticked in the list (owner's mock-up 09); the wizard
  // walks them one supplier at a time, as it does for a request's orders.
  const [sendingMany, setSendingMany] = useState<PurchaseOrder[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [supplierFilter, setSupplierFilter] = useState('')
  const [stateFilter, setStateFilter] = useState<OrderStateFilter>('')

  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      // Through the session cache, on whole Bangkok days (perf/firestore-read-budget): a
      // second visit reads only what changed since, instead of every order in the window
      // again — 130 orders a visit in the 6 Oct measurement.
      const now = Date.now()
      const rows = await orderCache.fetchRange(bkkDayStart(now) - days * DAY, bkkDayEnd(now) + DAY, { force })
      setOrders([...rows].sort((a, b) => b.orderedAt - a.orderedAt))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [days, toast, t])

  useEffect(() => {
    void load()
  }, [load])

  // A supplier answered while this page is open (5 Oct 2026): the row and an open sheet
  // show the new date at once, without a reload or a re-read of the list.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const next = (e as CustomEvent<PurchaseOrder>).detail
      setOrders((cur) => (cur.some((o) => o.id === next.id) ? cur.map((o) => (o.id === next.id ? next : o)) : cur))
      setViewing((cur) => (cur && cur.id === next.id ? next : cur))
    }
    window.addEventListener(ORDER_UPDATED, onUpdate)
    return () => window.removeEventListener(ORDER_UPDATED, onUpdate)
  }, [])

  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Opened from the calendar: ?po=<id> shows the sheet, ?receive=<id> goes to the receiving
  // screen with that order picked (24 Sep 2026 — the check-in modal is retired).
  // Back from LINE Login (or opened inside LINE): ?send=<id> reopens the send wizard on
  // that order (share/liffResume.ts). Consumed once the list is here, and cleared so a
  // refresh does not reopen it.
  useEffect(() => {
    if (loading) return
    const po = params.get('po')
    const receive = params.get('receive')
    const send = params.get(RESUME_PARAM)
    if (!po && !receive && !send) return
    if (receive && !po) {
      navigate(`/receive?po=${encodeURIComponent(receive)}`, { replace: true })
      return
    }
    const id = (po ?? send)!
    const open = po ? setViewing : setSending
    const hit = orders.find((o) => o.id === id)
    if (hit) open(hit)
    // Older than the list's window (a search result from last month): read that one order.
    else {
      void resolvePoDeepLink({
        id,
        brand,
        isAlive: () => mounted.current,
        open,
        toast,
        t,
      })
    }
    setParams({}, { replace: true })
  }, [loading, orders, params, setParams, navigate, brand, toast, t])

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
  // Newest cancellation first — sorted before paging, so page 1 is the latest.
  const cancelled = orders
    .filter((o) => o.status === 'cancelled')
    .sort((a, b) => (b.cancelledAt ?? 0) - (a.cancelledAt ?? 0))
  const summary = useMemo(() => summariseBySupplier(orders), [orders])

  // The tab's rows, narrowed by the search box: supplier, document number or any product on
  // the order — the three things someone holding a delivery note would type.
  const filtered = useMemo(() => {
    const base = tab === 'open' ? open : tab === 'received' ? received : tab === 'cancelled' ? cancelled : []
    const q = search.trim().toLowerCase()
    return base
      .filter((o) => !(lateOnly && tab === 'open') || lateIds.has(o.id))
      .filter((o) => !supplierFilter || o.supplierId === supplierFilter)
      .filter((o) => matchesStateFilter(o, stateFilter, lateIds.has(o.id)))
      .filter((o) => !q || looseMatch([o.supplierName, o.docNo, ...o.lines.map((l) => l.productName)], q))
  }, [tab, open, received, cancelled, search, lateOnly, lateIds, supplierFilter, stateFilter])
  // The quick filters' counts: the open orders already loaded for this window, narrowed by
  // the search and supplier as the list is — so a count is what a tap will show, and never
  // an all-time total. No read of its own.
  const quickCounts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = open
      .filter((o) => !supplierFilter || o.supplierId === supplierFilter)
      .filter((o) => !q || looseMatch([o.supplierName, o.docNo, ...o.lines.map((l) => l.productName)], q))
    return stateFilterCounts(base, (o) => lateIds.has(o.id))
  }, [open, search, supplierFilter, lateIds])
  const paged = usePaged(filtered, 20, `${tab}|${search}|${lateOnly}|${days}|${supplierFilter}|${stateFilter}`)
  const supplierOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) m.set(o.supplierId, o.supplierName)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [orders])
  const toSend = useMemo(() => orders.filter((o) => selected.has(o.id) && o.status === 'ordered'), [orders, selected])
  const filtersOn = !!(search.trim() || supplierFilter || stateFilter || lateOnly)

  async function closeShort(order: PurchaseOrder, reason: string) {
    if (!user) return
    try {
      const next = await closeOrderRemainder({ orderId: order.id, reason, actor: { id: user.id, name: user.name } })
      setOrders((cur) => cur.map((o) => (o.id === order.id ? next : o)))
      setClosing(null)
      toast.success(t('ปิดยอดค้างของ {docNo} แล้ว', { docNo: order.docNo }))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

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
          [t('จำนวนที่รับ')]: o.status === 'received' || o.receipts?.length ? (l.receivedQty ?? '') : '',
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
    await exportOrdersExcel(exportRows, t, toast, setBusyExport)
  }

  async function exportPdfFile() {
    await exportOrdersPdf(
      {
        rows: exportRows(),
        title: t('รายการสั่งซื้อ — {company}', { company: brand ? brandDef(brand).name : '' }),
        meta: [
          t('{days} วันล่าสุด', { days }),
          tab === 'received' ? t('รับของแล้ว') : tab === 'open' ? t('รอรับของ') : tab === 'cancelled' ? t('ยกเลิกแล้ว') : t('ทั้งหมด'),
        ],
        filename: t('ใบสั่งซื้อ_{ts}', { ts: Date.now() }),
      },
      t,
      toast,
      setBusyExport,
    )
  }

  function actionsFor(o: PurchaseOrder) {
    return {
      onReviewDate: () => setViewing(o),
      onSend: () => setSending(o),
      onReceive: () => navigate(`/receive?po=${encodeURIComponent(o.id)}`),
      onAmend: () => setAmending(o),
      onCancel: () => setCancelling(o),
      onCloseShort: () => setClosing(o),
    }
  }

  const orderColumns: Column<PurchaseOrder>[] = [
    {
      key: 'supplier',
      header: t('ผู้ขาย / เลขที่ PO'),
      primary: true,
      className: 'min-w-0',
      cell: (o) => (
        <div className="flex min-w-0 items-center gap-3">
          {/* No supplier logos exist, so the initials in a tinted circle stand in for one. */}
          <span className="hidden xl:block">
            <ItemCell title="" avatar={o.supplierName} tone={avatarTone(o.supplierName)} />
          </span>
          <div className="min-w-0">
          <div className="break-words font-semibold text-ink">{o.supplierName}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
            <span className="doc-no">{o.docNo}</span>
            {o.revision ? <Badge color="amber">Rev.{o.revision}</Badge> : null}
            {o.requestId && (
              <Link to={`/requests/${o.requestId}`} className="text-brand hover:underline">
                {t('จากรายการขอสั่งซื้อ')}
              </Link>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
            <SiteChip locationId={o.locationId} />
            <span>{t('{count} รายการ', { count: o.lines.length })}</span>
            <span className="num xl:hidden">{formatThaiDate(o.orderedAt)}</span>
          </div>
          </div>
        </div>
      ),
    },
    {
      key: 'ordered',
      card: 'hidden',
      header: t('วันที่สั่ง'),
      headerClassName: 'hidden xl:table-cell',
      className: 'hidden xl:table-cell',
      cell: (o) => (
        <div className="flex items-start gap-2">
          <Icon name="calendar" size={16} className="mt-0.5 text-ink-faint" />
          <span className="num whitespace-nowrap text-ink-soft">{formatThaiDate(o.orderedAt)}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('สถานะ'),
      cell: (o) => <OrderStatus order={o} late={lateIds.has(o.id)} />,
    },
    {
      key: 'due',
      header: tab === 'received' ? t('รับของเมื่อ') : t('กำหนดรับของ'),
      cell: (o) => (
        <DueCell order={o} late={lateIds.has(o.id)} expectedAt={expectedDeliveryAt(o, leadTimeOf(o.supplierId))} />
      ),
    },
    {
      key: 'actions',
      header: t('การดำเนินการ'),
      tableOnly: true,
      headerClassName: 'w-48 text-right',
      className: 'w-48',
      cell: (o) => <OrderActions order={o} late={lateIds.has(o.id)} compact {...actionsFor(o)} />,
    },
  ]

  if (loading) return <Spinner label={t('กำลังโหลดใบสั่งซื้อ...')} />

  const tabItems: StatusTabItem<Tab>[] = [
    { key: 'open', label: t('รอรับของ ({count})', { count: open.length }), icon: 'clock', tone: 'brand' },
    { key: 'received', label: t('รับของแล้ว ({count})', { count: received.length }), icon: 'checkCircle', tone: 'in' },
    { key: 'cancelled', label: t('ยกเลิกแล้ว ({count})', { count: cancelled.length }), icon: 'x', tone: 'plain' },
    { key: 'summary', label: t('สรุปตามผู้ขาย'), icon: 'chart', tone: 'plain' },
  ]

  return (
    <FramePage>
      <PageHero
        icon="cart"
        title={t('สั่งซื้อ')}
        subtitle={t('สั่งของกับผู้ขาย ตรวจรับ แล้วเข้าคลังในขั้นตอนเดียว')}
        actions={
          // Two ways in, same orders underneath: the list from Excel, or one supplier by
          // hand. The manual screen stays exactly as it was for the days it is the right tool.
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/purchase')}>
              <Icon name="upload" size={16} />
              {t('นำเข้า Excel')}
            </Button>
            <Button className="order-first md:order-last" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              {t('สั่งของใหม่')}
            </Button>
          </div>
        }
      />

      {/* The thing worth interrupting someone about: goods that never turned up. */}
      {late.length > 0 && (
        <AlertBanner
          action={
            <button
              className={`${bannerAction} w-full justify-center sm:w-auto`}
              onClick={() => {
                setTab('open')
                setLateOnly(true)
              }}
            >
              {t('ดูรายการที่ค้างนาน')}
              <Icon name="arrowRight" size={16} />
            </button>
          }
        >
          <span className="block">
            {t('{count} ใบสั่งซื้อเกิน {days} วันแล้วยังไม่ได้รับของ', {
              count: late.length,
              days: CHASE_AFTER_DAYS,
            })}
          </span>
          <span className="block text-xs font-normal opacity-80">{t('กรุณาตรวจสอบและดำเนินการรับสินค้าเข้าคลัง')}</span>
        </AlertBanner>
      )}

      <div className={`${frameCard} flex flex-wrap items-center gap-3 p-3 md:p-4`}>
        <div className="min-w-0 flex-1">
          <ChipRow<Tab>
            label={t('สถานะใบสั่งซื้อ')}
            value={tab}
            onChange={(k) => {
              setTab(k)
              setLateOnly(false)
              setSelected(new Set())
            }}
            chips={tabItems.map((x) => ({ key: x.key, label: x.label }))}
          />
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:flex sm:w-auto">
          <div className="relative min-w-0">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
              <Icon name="calendar" size={17} />
            </span>
            <Select
              aria-label={t('ช่วงเวลา')}
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full pl-9 pr-6 sm:w-auto sm:pl-10 sm:pr-8"
            >
              <option value="7">{t('7 วันล่าสุด')}</option>
              <option value="30">{t('30 วันล่าสุด')}</option>
              <option value="90">{t('90 วันล่าสุด')}</option>
            </Select>
          </div>
          {/* What was ordered on which day, as a sheet — the summary the owner asked for
              in a form that leaves the app. Exports what the tab shows. */}
          <Button variant="sheet" onClick={() => void exportExcelFile()} disabled={!!busyExport || orders.length === 0}>
            <Icon name="fileSheet" size={17} />
            {busyExport === 'excel' ? t('กำลังสร้างไฟล์...') : 'Excel'}
          </Button>
          <Button variant="pdf" onClick={() => void exportPdfFile()} disabled={!!busyExport || orders.length === 0}>
            <Icon name="report" size={17} />
            {busyExport === 'pdf' ? t('กำลังสร้างไฟล์...') : 'PDF'}
          </Button>
        </div>
      </div>

      {tab !== 'summary' && (
        <Card className="p-3 md:p-4">
          <div className={`grid grid-cols-2 items-end gap-3 ${tab === 'open' ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]'}`}>
          <div className="col-span-2 min-w-0 md:col-span-1">
            <SearchInput value={search} onChange={setSearch} placeholder={t('ค้นหาเลข PO, ชื่อผู้ขาย, สินค้า...')} />
          </div>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-ink-soft">{t('ผู้ขาย')}</span>
            <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">{t('ผู้ขายทั้งหมด')}</option>
              {supplierOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          {tab === 'open' && (
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-ink-soft">{t('สถานะ')}</span>
              <Select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as OrderStateFilter)}>
                <option value="">{t('สถานะทั้งหมด')}</option>
                <option value="late">{t('ล่าช้า')}</option>
                <option value="sent">{t('ส่งเข้า LINE แล้ว')}</option>
                <option value="unsent">{t('ยังไม่ได้ส่ง LINE')}</option>
                <option value="resend">{t('ต้องส่ง PO ใหม่')}</option>
                <option value="draft">{t('ร่าง — รออนุมัติ')}</option>
                <option value="supplierWaiting">{t('รอผู้ขายยืนยัน')}</option>
                <option value="datePending">{t('รออนุมัติวันส่ง')}</option>
              </Select>
            </label>
          )}
          <Button variant="ghost" className={`col-span-2 justify-self-end md:col-span-1 ${filtersOn ? '' : 'hidden md:inline-flex'}`} disabled={!filtersOn} onClick={() => {
            setSearch('')
            setSupplierFilter('')
            setStateFilter('')
            setLateOnly(false)
          }}>
            <Icon name="rotateCcw" size={16} />
            {t('รีเซ็ต')}
          </Button>
          </div>
          {tab === 'open' && (
            <QuickFilters
              counts={quickCounts}
              days={days}
              value={stateFilter}
              onChange={(f) => {
                setStateFilter(f)
                setLateOnly(false)
              }}
            />
          )}
        </Card>
      )}

      {lateOnly && tab === 'open' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <Badge color="red">{t('แสดงเฉพาะใบที่ค้างนาน')}</Badge>
          <button className="cursor-pointer text-brand hover:underline" onClick={() => setLateOnly(false)}>
            {t('แสดงทั้งหมด')}
          </button>
        </div>
      )}

      {tab === 'summary' ? (
        <Card className="overflow-hidden">
          <SupplierSummary rows={summary} />
        </Card>
      ) : (
        <div>
          <Card className="overflow-hidden">
            {tab === 'cancelled' ? (
              <CancelledTable rows={paged.rows} onOpen={setViewing} />
            ) : (
              <DataTable
                rows={paged.rows}
                rowKey={(o) => o.id}
                minWidth={640}
                onRowClick={setViewing}
                rowLabel={(o) => t('เปิดใบสั่งซื้อ {docNo} ของ {supplier}', { docNo: o.docNo, supplier: o.supplierName })}
                selection={tab === 'open' ? { selected, onChange: setSelected } : undefined}
                empty={
                  <EmptyState
                    icon="truck"
                    title={search.trim() ? t('ไม่พบใบสั่งซื้อที่ตรงกับคำค้น') : t('ไม่มีใบสั่งซื้อในช่วงนี้')}
                  />
                }
                columns={orderColumns}
                cardActions={(o) => <OrderActions order={o} late={lateIds.has(o.id)} {...actionsFor(o)} />}
              />
            )}
          </Card>
          <Pagination {...paged.pager} />
          {tab === 'open' && toSend.length > 0 && (
            <div className="sticky bottom-4 z-20 mt-3 hidden flex-wrap items-center gap-2 rounded-2xl border border-brand/30 bg-surface px-4 py-3 shadow-lg md:flex">
              <span className="mr-auto text-sm font-semibold text-ink">{t('เลือก {n} ใบ', { n: toSend.length })}</span>
              <Button size="sm" variant="success" onClick={() => setSendingMany(toSend)}>
                <Icon name="share" size={16} />
                {t('ส่ง LINE ({n} ใบ)', { n: toSend.length })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('ล้างที่เลือก')}
              </Button>
            </div>
          )}
        </div>
      )}

      {creating && user && (
        <NewOrderModal
          suppliers={suppliers}
          products={products}
          locations={locations}
          actor={{ id: user.id, name: user.name }}
          onClose={() => setCreating(false)}
          onDone={() => void load(true)}
        />
      )}
      {viewing && (
        <OrderSheet
          order={viewing}
          locationName={locationById(viewing.locationId)?.name ?? ''}
          onClose={() => setViewing(null)}
          onSend={viewing.status === 'ordered' ? () => { setViewing(null); setSending(viewing) } : undefined}
          onChanged={(next) => {
            setViewing(next)
            setOrders((cur) => cur.map((o) => (o.id === next.id ? next : o)))
          }}
        />
      )}
      {sendingMany && (
        <SendWizard
          orders={sendingMany}
          resend
          onStatus={async (o) => setOrders((cur) => cur.map((x) => (x.id === o.id ? { ...x, ...o } : x)))}
          onClose={() => {
            setSendingMany(null)
            setSelected(new Set())
          }}
        />
      )}
      {sending && (
        <SendWizard
          orders={[sending]}
          resend
          onStatus={async (o) => setOrders((cur) => cur.map((x) => (x.id === o.id ? { ...x, ...o } : x)))}
          onClose={() => setSending(null)}
        />
      )}
      {amending && user && (
        <AmendOrderModal
          order={amending}
          products={products}
          actor={{ id: user.id, name: user.name }}
          onClose={() => setAmending(null)}
          onDone={(next) => setOrders((cur) => cur.map((o) => (o.id === next.id ? next : o)))}
        />
      )}
      {closing && (
        <ReasonModal
          title={t('ปิดยอดค้าง {docNo}', { docNo: closing.docNo })}
          message={t('ของที่รับแล้วยังอยู่ในสต๊อกตามเดิม ส่วนที่ยังไม่มาจะไม่ค้างรับอีก และใบสั่งซื้อย้ายไป "รับของแล้ว" พร้อมเหตุผล')}
          confirmText={t('ปิดยอดค้าง')}
          onClose={() => setClosing(null)}
          onConfirm={(reason) => closeShort(closing, reason)}
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
    </FramePage>
  )
}

/** A steady colour per supplier, from its name, for the initials circle. */
const AVATAR_TONES: Tone[] = ['red', 'blue', 'green', 'amber', 'purple']
function avatarTone(name: string): Tone {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

/** The orders called off, as a table: the trail an audit reads. */
function CancelledTable({ rows, onOpen }: { rows: PurchaseOrder[]; onOpen: (o: PurchaseOrder) => void }) {
  const t = useT()
  return (
    <div>
      <DataTable
        rows={rows}
        rowKey={(o) => o.id}
        onRowClick={onOpen}
        empty={<EmptyState icon="x" title={t('ไม่มีใบสั่งซื้อที่ยกเลิกในช่วงนี้')} />}
        columns={[
          { key: 'docNo', header: t('เลขที่ (รันแยกตามผู้ขาย)'), primary: true, cell: (o) => <span className="doc-no">{o.docNo}</span> },
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

const QUICK_LABEL: Record<QuickFilter, string> = {
  unsent: 'ยังไม่ส่ง LINE', // i18n-key
  supplierWaiting: 'รอผู้ขายยืนยัน', // i18n-key
  resend: 'ต้องส่ง PO ใหม่', // i18n-key
  late: 'เกินกำหนดรับของ', // i18n-key
}

/**
 * One tap to the four lists someone chases every morning. The counts are the orders loaded
 * for the window on screen, and say so — they are not all-time totals.
 */
function QuickFilters({
  counts,
  days,
  value,
  onChange,
}: {
  counts: Record<QuickFilter, number>
  days: number
  value: OrderStateFilter
  onChange: (f: OrderStateFilter) => void
}) {
  const t = useT()
  return (
    // Two by two on a phone, where four chips in a row do not fit and one per line wastes
    // the screen; a single row from tablets up.
    <div className="mt-3 grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center" role="group" aria-label={t('ตัวกรองด่วน')}>
      {QUICK_FILTERS.map((f) => {
        const on = value === f
        const loud = (f === 'resend' || f === 'late') && counts[f] > 0
        return (
          <button
            key={f}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? '' : f)}
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-center text-sm font-medium leading-tight ring-1 ring-inset outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand md:min-h-9 md:whitespace-nowrap md:px-3 ${
              on ? 'bg-brand-soft text-brand ring-brand/40' : 'bg-surface text-ink-soft ring-line-strong hover:bg-sunken'
            }`}
          >
            {t(QUICK_LABEL[f])}
            <span className={`num ${loud ? 'font-bold text-out' : 'font-semibold text-ink'}`}>({counts[f]})</span>
          </button>
        )
      })}
      <span className="col-span-2 text-xs text-ink-faint">{t('นับเฉพาะใบใน {days} วันล่าสุด', { days })}</span>
    </div>
  )
}

const SUPPLIER_ICON: Record<string, IconName> = {
  waiting: 'clock',
  confirmed: 'checkCircle',
  changed: 'calendar',
  pending_date_approval: 'calendar',
}

function OrderStatus({ order, late }: { order: PurchaseOrder; late: boolean }) {
  const t = useT()
  const status = presentOrderStatus(order, late)
  const supplierState = status.primary.supplier ? order.supplierConfirmationStatus : undefined
  return (
    <div className="space-y-1" data-urgency={status.urgency}>
      {/* Two facts, two badges: what is happening with the goods or the supplier's answer,
          and — separately — whether LINE has the current sheet. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge color={status.primary.color} data-supplier-state={supplierState}>
          {supplierState && <Icon name={SUPPLIER_ICON[supplierState]} size={13} />}
          {t(status.primary.label)}
        </Badge>
        <LineBadge order={order} />
      </div>
      {status.secondary.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-relaxed text-ink-soft">
          {status.secondary.map((label) => <span key={label}>{t(label)}</span>)}
        </div>
      )}
      {order.status === 'ordered' && order.receipts?.length ? (
        <div className="text-xs text-ink-soft">{partialLabel(order, t)}</div>
      ) : null}
    </div>
  )
}

/**
 * When the goods are due, or when they came.
 *
 * The due day is set when the order is placed (by hand or from a request) and read-only
 * here; the calendar and the "late" flag follow it. Without one, the supplier's lead time
 * stands in, and says so.
 */
function DueCell({ order, late, expectedAt }: { order: PurchaseOrder; late: boolean; expectedAt?: number }) {
  const t = useT()
  if (order.status === 'received') {
    return (
      <div className="flex items-start gap-2">
        <Icon name="checkCircle" size={16} className="mt-0.5 text-in" />
        <div>
          <div className="num text-ink">{order.receivedAt ? formatThaiDate(order.receivedAt) : '—'}</div>
          {order.invoiceNo && (
            <div className="text-xs text-ink-faint">
              {t('บิล')} {order.invoiceNo}
            </div>
          )}
        </div>
      </div>
    )
  }
  if (order.status === 'draft' || expectedAt === undefined) return <span className="text-ink-faint">—</span>
  return (
    <div className={`flex items-start gap-2 ${late ? 'text-danger' : 'text-ink-soft'}`}>
      <Icon name="calendar" size={16} className="mt-0.5" />
      <div>
        <div className="num whitespace-nowrap">{formatThaiDate(expectedAt)}</div>
        {order.expectedAt === undefined && <div className="text-xs text-ink-faint">{t('ตามระยะส่งของผู้ขาย')}</div>}
        {(() => {
          // The supplier moved it: the date asked for stays visible, struck through.
          const asked = requestedOf(order)
          return order.confirmedDeliveryDate !== undefined && asked !== undefined && asked !== order.confirmedDeliveryDate ? (
            <div className="num text-xs text-ink-faint">
              {t('ขอไว้')} <s>{formatThaiDate(asked)}</s>
            </div>
          ) : null
        })()}
      </div>
    </div>
  )
}

function OrderActions({
  order,
  late,
  compact,
  onReviewDate,
  onReceive,
  onAmend,
  onCancel,
  onCloseShort,
  onSend,
}: {
  order: PurchaseOrder
  late: boolean
  compact?: boolean
  onReviewDate: () => void
  onReceive: () => void
  onAmend: () => void
  onCancel: () => void
  onCloseShort: () => void
  onSend: () => void
}) {
  const t = useT()
  const live = order.status === 'ordered'
  // Part-delivered: its lines carry what arrived, so it is no longer edited or cancelled —
  // the rest is received, or closed short (owner, 24 Sep 2026).
  const partial = live && !!order.receipts?.length
  const size = compact ? 'sm' : 'md'
  const next = presentOrderStatus(order, late).nextAction
  const sending = next === 'send' || next === 'resend'
  const reviewing = next === 'reviewDate'
  const menu: RowMenuItem[] = []
  if (live && !partial) menu.push({ key: 'edit', label: t('แก้ไข'), icon: 'pencil', onSelect: onAmend })
  if (live && !sending) menu.push({ key: 'send', label: t('ส่ง LINE'), icon: 'share', onSelect: onSend })
  if (partial) menu.push({ key: 'close', label: t('ปิดยอดค้าง'), onSelect: onCloseShort })
  if (order.status === 'draft' || (live && !partial)) menu.push({ key: 'cancel', label: t('ยกเลิก'), danger: true, onSelect: onCancel })
  return (
    <div data-row-action className={`items-center gap-1.5 ${compact ? 'grid grid-cols-[max-content_auto] justify-end' : 'flex flex-wrap'}`}>
      {live && (
        <Button size={size} className="min-h-11" onClick={sending ? onSend : reviewing ? onReviewDate : onReceive}>
          <Icon name={sending ? 'share' : reviewing ? 'calendar' : 'truck'} size={16} />
          {sending ? (next === 'resend' ? t('ส่ง PO ใหม่') : t('ส่ง LINE')) : reviewing ? t('ตรวจวันส่ง') : partial ? t('รับส่วนที่เหลือ') : t('ตรวจรับของ')}
        </Button>
      )}
      <RowMenu items={menu} />
      {live && (sending || reviewing) && (
        <Button size={size} variant="ghost" className={`min-h-11 ${compact ? 'col-span-2 justify-self-end' : ''}`} onClick={onReceive}>
          {partial ? t('รับส่วนที่เหลือ') : t('ตรวจรับของ')}
        </Button>
      )}
    </div>
  )
}

function SupplierSummary({
  rows,
}: {
  rows: { supplierName: string; orders: number; lines: number; items: number }[]
}) {
  const t = useT()
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.supplierName}
      minWidth={480}
      empty={<EmptyState icon="chart" title={t('ไม่มีใบสั่งซื้อในช่วงนี้')} />}
      columns={[
        { key: 'supplier', header: t('ผู้ขาย'), primary: true, cell: (r) => <span className="font-semibold text-ink">{r.supplierName}</span> },
        { key: 'orders', header: t('ใบสั่ง'), align: 'right', cell: (r) => <span className="num">{r.orders}</span> },
        { key: 'lines', header: t('รายการ'), align: 'right', cell: (r) => <span className="num">{r.lines}</span> },
        { key: 'items', header: t('จำนวนรวม'), align: 'right', cell: (r) => <span className="num font-semibold text-ink">{fmtQty(r.items)}</span> },
      ]}
    />
  )
}

/**
 * Start an order: pick a supplier, and everything they sell is already on the sheet.
 *
 * The staff member types quantities against the few they want rather than hunting for each
 * product, which is the whole reason the supplier link exists.
 */
/** One line as keyed for the supplier (qty in `unit`), and the same in the product's own unit. */
type LineDraft = Record<string, { qty: number; unit: string; base: number }>

/** The supplier's products with a quantity box each — the body of placing and of amending. */
function LineList({
  products,
  lines,
  setLines,
  plainUnits,
  onOrder,
}: {
  products: Product[]
  lines: LineDraft
  setLines: (fn: (cur: LineDraft) => LineDraft) => void
  plainUnits: string[]
  onOrder?: ReadonlySet<string>
}) {
  const t = useT()
  if (products.length === 0) {
    return (
      <div className="max-h-80 overflow-auto rounded-lg border border-line">
        <p className="p-6 text-center text-sm text-ink-soft">{t('ผู้ขายรายนี้ยังไม่มีสินค้าผูกไว้')}</p>
      </div>
    )
  }

  const renderItem = (p: Product) => {
    const line = lines[p.id]
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
          <div className="w-full shrink-0 sm:w-64">
            <QtyInput
              unitType={p.unitType}
              plainUnits={plainUnits}
              conversions={p.unitConversions}
              value={line?.base ?? 0}
              onChange={(e) => setLines((cur) => ({ ...cur, [p.id]: { qty: e.entryQty, unit: e.entryUnit ?? p.unitType, base: e.qty } }))}
              product={p}
            />
            {line && line.qty > 0 && !sameUnit(line.unit, p.unitType) && (
              <p className="mt-1 text-right text-xs text-ink-faint">
                {t('ผู้ขายเห็น {qty} {unit}', { qty: fmtQty(line.qty), unit: line.unit })}
              </p>
            )}
          </div>
        </div>
      </li>
    )
  }

  const inOrder = onOrder ? products.filter((p) => onOrder.has(p.id)) : []
  const others = onOrder ? products.filter((p) => !onOrder.has(p.id)) : products

  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      {onOrder && inOrder.length > 0 ? (
        <div>
          <div className="bg-sunken px-3 py-1.5 text-xs font-semibold text-ink-soft">
            {t('รายการในใบสั่งซื้อ ({n})', { n: inOrder.length })}
          </div>
          <ul className="divide-y divide-line">{inOrder.map(renderItem)}</ul>
          {others.length > 0 && (
            <>
              <div className="border-t border-line bg-sunken px-3 py-1.5 text-xs font-semibold text-ink-soft">
                {t('เพิ่มสินค้าอื่นของผู้ขายรายนี้ ({n})', { n: others.length })}
              </div>
              <ul className="divide-y divide-line">{others.map(renderItem)}</ul>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line">{products.map(renderItem)}</ul>
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
    Object.fromEntries(order.lines.map((l) => [l.productId, { qty: l.orderedQty, unit: shownUnit(l), base: l.baseQty ?? l.orderedQty }])),
  )
  const [expected, setExpected] = useState(order.expectedAt !== undefined ? msToDateInput(order.expectedAt) : '')
  const [note, setNote] = useState(order.note ?? '')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const onOrder = useMemo(() => new Set(order.lines.map((l) => l.productId)), [order])

  // The order's own lines first, whatever state their product is in now, then the rest of
  // what the supplier sells.
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const own = products.filter((p) => onOrder.has(p.id))
    const others = products
      .filter((p) => !onOrder.has(p.id) && p.supplierId === order.supplierId && p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...own, ...others].filter((p) => looseMatch([p.name, p.sku], q))
  }, [products, order, search, onOrder])

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
        <LineList products={list} lines={lines} setLines={setLines} plainUnits={plainUnits} onOrder={onOrder} />
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
  const [fileImport, setFileImport] = useState(false)
  const [lines, setLines] = useState<LineDraft>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  // The day the supplier is to deliver. Offered from their lead time; the person may say
  // otherwise. Empty means unknown, and the lead time then stands in on the calendar.
  const [expected, setExpected] = useState('')
  // Read once for the whole form, not once per line.
  const plainUnits = useEntryUnits()

  // A half-keyed order survives closing the dialog (lib/useDraft.ts).
  const draft = useMemo(() => ({ supplierId, locationId, lines, expected }), [supplierId, locationId, lines, expected])
  const { restored, clear: clearDraft } = useDraft(
    'new-order',
    draft,
    (d) => {
      if (d.supplierId) setSupplierId(d.supplierId)
      if (d.locationId) setLocationId(d.locationId)
      if (d.lines && typeof d.lines === 'object') setLines(d.lines)
      if (typeof d.expected === 'string') setExpected(d.expected)
    },
    (d) => !Object.values(d.lines).some((l) => l.qty > 0),
  )
  function discardDraft() {
    setLines({})
    clearDraft()
  }

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
      clearDraft()
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
        {restored && <DraftNotice onDiscard={discardDraft} />}
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
            <SiteSelect value={locationId} onChange={setLocationId} locations={active} />
          </Field>
          <Field label={t('วันที่ให้ส่งของ')} hint={t('ว่างไว้ = ยังไม่ทราบ ปฏิทินจะใช้ระยะส่งของผู้ขายแทน')}>
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>

        {supplierId && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('ค้นหาในรายการของผู้ขายรายนี้')}
                className="flex-1"
              />
              <Button variant="outline" onClick={() => setFileImport(true)}>
                <Icon name="upload" size={15} />
                {t('นำเข้าจากไฟล์ (Excel / รูป / PDF)')}
              </Button>
            </div>
            <LineList products={theirs} lines={lines} setLines={setLines} plainUnits={plainUnits} />
            {fileImport && (
              <LineImportModal
                // Matched only against this supplier's own products: an order goes to one supplier.
                products={products.filter((p) => p.supplierId === supplierId && p.active !== false)}
                onClose={() => setFileImport(false)}
                onImport={(imported) =>
                  setLines((cur) => {
                    const next = { ...cur }
                    for (const i of imported) {
                      next[i.product.id] = { qty: i.entryUnit ? (i.entryQty ?? i.qty) : i.qty, unit: i.entryUnit ?? i.product.unitType, base: i.qty }
                    }
                    return next
                  })
                }
              />
            )}
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
  onSend,
  onChanged,
}: {
  order: PurchaseOrder
  locationName: string
  onClose: () => void
  /** Offered on an order still waiting for goods: opens the LINE send wizard for it. */
  onSend?: () => void
  /** The order after the server changed it (a supplier date approved, a link issued). */
  onChanged?: (order: PurchaseOrder) => void
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
        <LineBadge order={order} detailed />
        <SheetLangToggle value={sheetLang} onChange={setSheetLang} />
        <PoSheet order={order} locationName={locationName} company={company} ref={sheet} lang={sheetLang} />
        {order.status === 'ordered' && <DeliveryRiskCard order={order} />}
        {onChanged && <SupplierConfirmationPanel order={order} onChanged={onChanged} />}
        {order.revisions && order.revisions.length > 0 && <RevisionHistory revisions={order.revisions} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ปิด')}
          </Button>
          <Button variant="secondary" onClick={() => sheet.current && printElement(sheet.current)}>
            <Icon name="download" size={16} />
            {t('พิมพ์ / บันทึก PDF (A5)')}
          </Button>
          <Button variant={onSend ? 'secondary' : 'primary'} onClick={() => void shareImage()} disabled={sharing}>
            <Icon name="share" size={16} />
            {sharing ? t('กำลังสร้างรูป...') : t('แชร์เป็นรูป (JPG)')}
          </Button>
          {onSend && (
            <Button onClick={onSend}>
              <Icon name="share" size={16} />
              {t('ส่ง LINE')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
