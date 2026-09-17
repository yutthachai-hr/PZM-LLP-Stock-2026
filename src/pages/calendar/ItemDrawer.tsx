import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Icon } from '../../components/Icon'
import { Badge, Button, Modal } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { fmtQty, formatThaiDate, formatThaiDateShort, formatThaiDateTime } from '../../lib/format'
import { actionsFor, type ItemAction } from '../../lib/inventoryRules/permissions'
import { expectedDeliveryAt, openPurchaseFor, type OpenPurchase } from '../../lib/inventoryRules/purchasing'
import type { CalendarItem, ItemStatus } from '../../lib/inventoryRules/types'
import { useSuppliers } from '../../services/suppliers'
import { PR_STATUS_KEYS } from '../../lib/purchaseRequestStatus'
import type { PurchaseOrder, PurchaseRequest, Role, StockEvent, StockEventStatus } from '../../types'
import {
  DAY_NAMES,
  EVENT_STATUS_LABEL,
  KIND_LABEL,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TYPE_LABEL,
  timeOf,
} from './chips'
import { itemIcon, itemTitle } from './ItemRow'

/**
 * One item, opened beside the calendar (a sheet from the bottom on a phone).
 *
 * What it shows depends on what it is; what it offers depends on who is looking, through
 * `actionsFor` — the same answer the rules give. A derived item's buttons open the record
 * it came from; nothing here creates a purchase order or a request on its own.
 */
export function ItemDrawer({
  item,
  orders,
  requests,
  onClose,
  onMove,
  onEdit,
  onDelete,
}: {
  item: CalendarItem
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  onClose: () => void
  onMove: (item: CalendarItem, status: StockEventStatus) => Promise<void>
  onEdit: (item: CalendarItem) => void
  onDelete: (item: CalendarItem) => Promise<void>
}) {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { locationById } = useData()
  const suppliers = useSuppliers()
  const actions = actionsFor(item, user ? { id: user.id, role: user.role as Role } : null)
  const has = (a: ItemAction) => actions.includes(a)
  const locationName = (id?: string) => (id ? locationById(id)?.name : undefined)
  const inProgress =
    (item.kind === 'lowStock' || item.kind === 'outOfStock' || item.kind === 'reorder') && item.productId
      ? openPurchaseFor(item.productId, item.locationId, { requests, orders })
      : null

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  return (
    <Modal open sheet onClose={onClose} title={itemTitle(item, t)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
          <Icon name={itemIcon(item)} size={14} />
          {item.meta.kind === 'task' ? t(TYPE_LABEL[item.meta.event.type]) : t(KIND_LABEL[item.kind])}
        </span>
        {item.status !== 'info' && <Badge color={STATUS_COLOR[item.status]}>{t(STATUS_LABEL[item.status])}</Badge>}
        {item.priority !== 'normal' && <Badge color={PRIORITY_COLOR[item.priority]}>{t(PRIORITY_LABEL[item.priority])}</Badge>}
      </div>

      <dl className="space-y-3 text-sm">
        {item.meta.kind === 'task' && <TaskBody event={item.meta.event} status={item.status} locationName={locationName} />}
        {item.meta.kind === 'poExpected' && (
          <OrderBody order={item.meta.order} locationName={locationName} leadTimeDays={suppliers.find((s) => s.id === item.supplierId)?.leadTimeDays} />
        )}
        {item.meta.kind === 'prPending' && <RequestBody request={item.meta.request} locationName={locationName} waitingDays={item.meta.waitingDays} />}
        {item.meta.kind === 'cutoff' && (
          <>
            <Row label={t('ผู้ขาย')}>{item.meta.supplier.name}</Row>
            <Row label={t('เวลาตัดรอบ')}>{item.meta.time}</Row>
            <Row label={t('วันที่สั่งได้')}>{(item.meta.supplier.orderDays ?? []).map((d) => t(DAY_NAMES[d])).join(', ')}</Row>
            {item.meta.supplier.leadTimeDays !== undefined && (
              <Row label={t('ระยะเวลาส่ง')}>{t('{n} วัน', { n: item.meta.supplier.leadTimeDays })}</Row>
            )}
          </>
        )}
        {(item.meta.kind === 'lowStock' || item.meta.kind === 'outOfStock') && (
          <ShortageBody
            meta={item.meta}
            supplierName={suppliers.find((s) => s.id === item.supplierId)?.name}
            inProgress={inProgress}
          />
        )}
      </dl>

      <div className="mt-6 space-y-2 border-t border-line pt-4">
        {item.meta.kind === 'task' && (has('start') || has('complete')) && (
          <div className="flex flex-wrap gap-2">
            {has('start') && (
              <Button variant="secondary" onClick={() => void onMove(item, 'inProgress')}>
                <Icon name="arrowRight" size={15} />
                {t('เริ่มทำ')}
              </Button>
            )}
            {has('complete') && (
              <Button variant="success" onClick={() => void onMove(item, 'completed')}>
                <Icon name="check" size={15} />
                {t('ทำเสร็จแล้ว')}
              </Button>
            )}
          </div>
        )}
        {item.meta.kind === 'task' && (has('edit') || has('cancel') || has('delete')) && (
          <div className="flex flex-wrap gap-2">
            {has('edit') && (
              <Button variant="secondary" onClick={() => onEdit(item)}>
                <Icon name="pencil" size={15} />
                {t('แก้ไข')}
              </Button>
            )}
            {has('cancel') && (
              <Button variant="secondary" onClick={() => void onMove(item, 'cancelled')}>
                {t('ยกเลิกงาน')}
              </Button>
            )}
            {has('delete') && (
              <Button variant="danger" onClick={() => void onDelete(item)}>
                <Icon name="trash" size={15} />
                {t('ลบ')}
              </Button>
            )}
          </div>
        )}
        {item.meta.kind === 'poExpected' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => go(`/orders?po=${item.sourceId}`)}>
              <Icon name="eye" size={15} />
              {t('ดูใบสั่ง')}
            </Button>
            {has('receive') && (
              <Button onClick={() => go(`/orders?receive=${item.sourceId}`)}>
                <Icon name="receive" size={15} />
                {t('ตรวจรับของ')}
              </Button>
            )}
          </div>
        )}
        {item.meta.kind === 'prPending' && (
          <Button onClick={() => go(`/requests/${item.sourceId}`)}>
            <Icon name="arrowRight" size={15} />
            {t('เปิดรายการขอสั่งซื้อ')}
          </Button>
        )}
        {item.meta.kind === 'cutoff' && (
          <Button variant="secondary" onClick={() => go('/suppliers')}>
            {t('ดูผู้ขาย')}
          </Button>
        )}
        {(item.meta.kind === 'lowStock' || item.meta.kind === 'outOfStock') && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => go(`/movements?product=${item.productId}&location=${item.locationId}`)}>
              <Icon name="history" size={15} />
              {t('ประวัติสินค้า')}
            </Button>
            {has('createPR') && !inProgress && (
              <Button onClick={() => go(`/requests/new?product=${item.productId}&location=${item.locationId}`)}>
                <Icon name="cart" size={15} />
                {t('สร้างรายการขอสั่งซื้อ')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ShortageBody({
  meta,
  supplierName,
  inProgress,
}: {
  meta: Extract<CalendarItem['meta'], { kind: 'lowStock' | 'outOfStock' }>
  supplierName?: string
  inProgress: OpenPurchase | null
}) {
  const t = useT()
  return (
    <>
      <Row label={t('สินค้า')}>
        {meta.product.name}
        <span className="doc-no ml-2 text-xs text-ink-faint">{meta.product.sku}</span>
      </Row>
      <Row label={t('คลัง/สาขา')}>{meta.location.name}</Row>
      <Row label={t('คงเหลือ')}>
        <span className={`num font-semibold ${meta.qty <= 0 ? 'text-out' : 'text-warn'}`}>
          {fmtQty(meta.qty)} {meta.product.unitType}
        </span>
      </Row>
      <Row label={t('ขั้นต่ำ')}>
        {fmtQty(meta.min)} {meta.product.unitType}
      </Row>
      <Row label={t('ผู้ขาย')}>{supplierName ?? <Muted>{t('ยังไม่ระบุ')}</Muted>}</Row>
      <Row label={t('การสั่งซื้อ')}>{inProgress ? <InProgress p={inProgress} /> : <Muted>{t('ยังไม่มี')}</Muted>}</Row>
    </>
  )
}

function TaskBody({ event: e, status, locationName }: { event: StockEvent; status: ItemStatus; locationName: (id?: string) => string | undefined }) {
  const t = useT()
  return (
    <>
      <Row label={t('สถานะ')}>
        <Badge color={STATUS_COLOR[status]}>{status === 'overdue' ? t(STATUS_LABEL.overdue) : t(EVENT_STATUS_LABEL[e.status])}</Badge>
      </Row>
      <Row label={t('วันเวลา')}>
        {formatThaiDateShort(e.startAt)} {timeOf(e.startAt)}
      </Row>
      {e.dueAt !== undefined && (
        <Row label={t('กำหนดเสร็จ')}>
          {formatThaiDateShort(e.dueAt)} {timeOf(e.dueAt)}
        </Row>
      )}
      <Row label={t('คลัง/สาขา')}>{locationName(e.locationId) ?? <Muted>{t('ไม่ระบุ')}</Muted>}</Row>
      <Row label={t('ผู้รับผิดชอบ')}>{e.assignedToAll ? t('ทุกคน') : e.assignedToName || <Muted>{t('ยังไม่มอบหมาย')}</Muted>}</Row>
      <Row label={t('หมายเหตุ')}>{e.note ? <span className="whitespace-pre-line">{e.note}</span> : <Muted>{t('ไม่มี')}</Muted>}</Row>
      <Row label={t('อัปเดตล่าสุด')}>{formatThaiDateTime(e.updatedAt)}</Row>
    </>
  )
}

function OrderBody({
  order,
  locationName,
  leadTimeDays,
}: {
  order: PurchaseOrder
  locationName: (id?: string) => string | undefined
  leadTimeDays?: number
}) {
  const t = useT()
  const expected = expectedDeliveryAt(order, leadTimeDays)
  const totalQty = order.lines.reduce((n, l) => n + l.orderedQty, 0)
  return (
    <>
      <Row label={t('ผู้ขาย')}>{order.supplierName}</Row>
      <Row label={t('เลขที่')}>
        <span className="doc-no">{order.docNo}</span>
      </Row>
      <Row label={t('วันที่สั่ง')}>{formatThaiDate(order.orderedAt)}</Row>
      <Row label={t('กำหนดส่ง')}>
        {expected !== undefined ? formatThaiDate(expected) : <Muted>{t('ยังไม่ทราบ')}</Muted>}
        {order.expectedAt === undefined && expected !== undefined && (
          <span className="ml-1 text-xs text-ink-faint">({t('ตามระยะส่งของผู้ขาย')})</span>
        )}
      </Row>
      <Row label={t('คลังปลายทาง')}>{locationName(order.locationId) ?? ''}</Row>
      <Row label={t('รายการ')}>{t('{n} รายการ · รวม {qty}', { n: order.lines.length, qty: fmtQty(totalQty) })}</Row>
      {order.status === 'received' && (
        <>
          <Row label={t('รับของเมื่อ')}>{order.receivedAt ? formatThaiDateTime(order.receivedAt) : ''}</Row>
          {order.invoiceNo && <Row label={t('เลขที่บิล')}>{order.invoiceNo}</Row>}
        </>
      )}
      {order.shareStatus === 'sent' && <Row label={t('LINE')}>{t('ส่งเข้า LINE แล้ว')}</Row>}
    </>
  )
}

function RequestBody({
  request,
  locationName,
  waitingDays,
}: {
  request: PurchaseRequest
  locationName: (id?: string) => string | undefined
  waitingDays: number
}) {
  const t = useT()
  const live = request.items.filter((i) => !i.removed)
  return (
    <>
      <Row label={t('เลขที่ PR')}>
        <span className="doc-no">{request.docNo}</span>
      </Row>
      <Row label={t('สถานะ')}>
        <Badge color="amber">{t(PR_STATUS_KEYS[request.status])}</Badge>
      </Row>
      <Row label={t('ผู้ขอ')}>{request.requestedByName}</Row>
      <Row label={t('ส่งตรวจเมื่อ')}>{request.submittedAt ? formatThaiDateTime(request.submittedAt) : formatThaiDateTime(request.createdAt)}</Row>
      <Row label={t('รอมาแล้ว')}>{t('{n} วัน', { n: waitingDays })}</Row>
      <Row label={t('คลังปลายทาง')}>{locationName(request.locationId) ?? ''}</Row>
      <Row label={t('รายการ')}>{t('{n} รายการ · {s} ผู้ขาย', { n: live.length, s: new Set(live.map((i) => i.supplierId)).size })}</Row>
      {request.note && <Row label={t('หมายเหตุ')}>{request.note}</Row>}
    </>
  )
}

function InProgress({ p }: { p: OpenPurchase }) {
  const t = useT()
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge color="blue">{t('มีการสั่งซื้ออยู่แล้ว')}</Badge>
      <span className="doc-no text-xs">{p.docNo}</span>
      <span className="text-xs text-ink-soft">· {p.kind === 'pr' ? t(PR_STATUS_KEYS[p.status as PurchaseRequest['status']]) : t('สั่งแล้ว')}</span>
    </span>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  )
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-ink-faint">{children}</span>
}
