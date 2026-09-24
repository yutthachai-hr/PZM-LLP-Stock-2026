import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { Badge, Button, Modal } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { fmtMoney, fmtQty, formatThaiDate, formatThaiDateShort, formatThaiDateTime } from '../../lib/format'
import { actionsFor, canManageTasks, type ItemAction } from '../../lib/inventoryRules/permissions'
import { expectedDeliveryAt, openPurchaseFor, type OpenPurchase } from '../../lib/inventoryRules/purchasing'
import type { CalendarItem, ItemStatus } from '../../lib/inventoryRules/types'
import { useSuppliers } from '../../services/suppliers'
import { PR_STATUS_KEYS } from '../../lib/purchaseRequestStatus'
import { approveEvent, cancelEvent, completeEvent, reopenEvent, rescheduleEvent, startEvent } from '../../services/events'
import { ADJUST_REASONS, type EventHistoryEntry, type PurchaseOrder, type PurchaseRequest, type Role, type StockEvent } from '../../types'
import { snoozeReorder } from '../../services/schedules'
import { DAY_MS } from '../../lib/inventoryRules/time'
import {
  DAY_NAMES,
  EVENT_STATUS_LABEL,
  HISTORY_LABEL,
  KIND_LABEL,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TYPE_LABEL,
  timeOf,
} from './chips'
import { itemIcon, itemTitle } from './ItemRow'
import { ReasonModal, RescheduleModal } from './RescheduleModal'
import { partialLabel } from '../receive/receipt'

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
  onChanged,
  onEdit,
  onDelete,
}: {
  item: CalendarItem
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  onClose: () => void
  /** A workflow step went through; the task as it now is. */
  onChanged: (e: StockEvent) => void
  onEdit: (item: CalendarItem) => void
  onDelete: (item: CalendarItem) => Promise<void>
}) {
  const t = useT()
  const toast = useToast()
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | 'reopen' | null>(null)
  const [busy, setBusy] = useState(false)
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

  const actor = user ? { id: user.id, name: user.name } : null
  const event = item.meta.kind === 'task' ? item.meta.event : null
  const manages = !!user && canManageTasks(user.role as Role)
  // Finishing a sign-off task hands it in, unless the finisher may sign it themselves.
  const handsIn = !!event?.requiresApproval && !manages

  // Each step signs the history in the actor's name; the drawer already holds the task,
  // so nothing is read first.
  async function run(step: () => Promise<StockEvent>, done: string): Promise<void> {
    setBusy(true)
    try {
      onChanged(await step())
      setDialog(null)
      toast.success(done)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

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
        {item.meta.kind === 'reorder' && <ReorderBody meta={item.meta} inProgress={inProgress} />}
        {item.meta.kind === 'stockoutEstimate' && (
          <>
            <Row label={t('สินค้า')}>{item.meta.product.name}</Row>
            <Row label={t('คลัง/สาขา')}>{item.meta.location.name}</Row>
            <Row label={t('คงเหลือ')}>
              {fmtQty(item.meta.qty)} {item.meta.product.unitType}
            </Row>
            <Row label={t('ใช้เฉลี่ยต่อวัน')}>
              {fmtQty(item.meta.avgDaily)} {item.meta.product.unitType}
            </Row>
            <Row label={t('คาดว่าจะหมดใน')}>{t('{n} วัน', { n: Math.floor(item.meta.daysLeft) })}</Row>
          </>
        )}
        {(item.meta.kind === 'adjustment' || item.meta.kind === 'waste') && (
          <>
            <Row label={t('สินค้า')}>{item.meta.movement.productName}</Row>
            <Row label={t('จำนวน')}>
              {item.meta.movement.fromLocationId ? '-' : '+'}
              {fmtQty(item.meta.movement.qty)} {item.meta.movement.unit}
            </Row>
            <Row label={t('เหตุผล')}>{reasonLabel(item.meta.movement.reason, t)}</Row>
            <Row label={t('มูลค่า')}>{item.meta.value > 0 ? fmtMoney(item.meta.value) : <Muted>{t('ไม่ทราบต้นทุน')}</Muted>}</Row>
            <Row label={t('คลัง/สาขา')}>{locationName(item.locationId) ?? ''}</Row>
            <Row label={t('โดย')}>{item.meta.movement.byUserName}</Row>
            <Row label={t('เลขที่')}>
              <span className="doc-no">{item.meta.movement.docNo}</span>
            </Row>
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
        {event && actor && (has('start') || has('complete') || has('approve') || has('reopen')) && (
          <div className="flex flex-wrap gap-2">
            {has('start') && (
              <Button variant="secondary" disabled={busy} onClick={() => void run(() => startEvent(event, actor), t('เริ่มงานแล้ว'))}>
                <Icon name="arrowRight" size={15} />
                {t('เริ่มทำ')}
              </Button>
            )}
            {has('complete') && (
              <Button
                variant="success"
                disabled={busy}
                onClick={() => void run(() => completeEvent(event, actor, { canApprove: manages }), handsIn ? t('ส่งให้หัวหน้าตรวจแล้ว') : t('บันทึกว่าเสร็จแล้ว'))}
              >
                <Icon name="check" size={15} />
                {handsIn ? t('ทำเสร็จ ส่งตรวจ') : t('ทำเสร็จแล้ว')}
              </Button>
            )}
            {has('approve') && (
              <Button variant="success" disabled={busy} onClick={() => void run(() => approveEvent(event, actor), t('อนุมัติแล้ว'))}>
                <Icon name="checkCircle" size={15} />
                {t('อนุมัติ')}
              </Button>
            )}
            {has('reopen') && (
              <Button variant="secondary" disabled={busy} onClick={() => setDialog('reopen')}>
                <Icon name="refresh" size={15} />
                {t('ส่งกลับให้ทำใหม่')}
              </Button>
            )}
          </div>
        )}
        {event && (has('edit') || has('reschedule') || has('cancel') || has('delete')) && (
          <div className="flex flex-wrap gap-2">
            {has('edit') && (
              <Button variant="secondary" onClick={() => onEdit(item)}>
                <Icon name="pencil" size={15} />
                {t('แก้ไข')}
              </Button>
            )}
            {has('reschedule') && (
              <Button variant="secondary" disabled={busy} onClick={() => setDialog('reschedule')}>
                <Icon name="clock" size={15} />
                {t('เลื่อนงาน')}
              </Button>
            )}
            {has('cancel') && (
              <Button variant="secondary" disabled={busy} onClick={() => setDialog('cancel')}>
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
              <Button onClick={() => go(`/receive?po=${encodeURIComponent(item.sourceId)}`)}>
                <Icon name="receive" size={15} />
                {item.meta.order.receipts?.length ? t('รับส่วนที่เหลือ') : t('ตรวจรับของ')}
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
        {item.meta.kind === 'reorder' && actor && (
          <div className="flex flex-wrap gap-2">
            {!inProgress && (
              <Button onClick={() => go(`/requests/new?product=${item.productId}&location=${item.locationId}&qty=${item.meta.kind === 'reorder' ? item.meta.recommendedQty : ''}`)}>
                <Icon name="cart" size={15} />
                {t('สร้างรายการขอสั่งซื้อ')}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await snoozeReorder(item.productId!, item.locationId!, Date.now() + 7 * DAY_MS, actor)
                  toast.success(t('ซ่อนคำแนะนำนี้ 7 วัน'))
                  onClose()
                } catch (e) {
                  toast.error(errText(e, t))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Icon name="clock" size={15} />
              {t('ยังไม่สั่ง (ซ่อน 7 วัน)')}
            </Button>
            <Button variant="secondary" onClick={() => go(`/movements?product=${item.productId}&location=${item.locationId}`)}>
              <Icon name="history" size={15} />
              {t('ประวัติสินค้า')}
            </Button>
          </div>
        )}
        {(item.meta.kind === 'stockoutEstimate' || item.meta.kind === 'adjustment' || item.meta.kind === 'waste') && (
          <Button variant="secondary" onClick={() => go(`/movements?product=${item.productId}${item.locationId ? `&location=${item.locationId}` : ''}`)}>
            <Icon name="history" size={15} />
            {t('ประวัติสินค้า')}
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

      {event && actor && dialog === 'reschedule' && (
        <RescheduleModal
          event={event}
          onClose={() => setDialog(null)}
          onSubmit={(start, reason) => run(() => rescheduleEvent(event, start, reason, actor), t('เลื่อนงานแล้ว'))}
        />
      )}
      {event && actor && dialog === 'cancel' && (
        <ReasonModal
          title={t('ยกเลิกงาน')}
          message={t('ยกเลิก "{title}" ? งานจะยังอยู่ในปฏิทินพร้อมเหตุผล', { title: event.title })}
          confirmText={t('ยกเลิกงาน')}
          required={false}
          danger
          onClose={() => setDialog(null)}
          onSubmit={(reason) => run(() => cancelEvent(event, actor, reason), t('ยกเลิกงานแล้ว'))}
        />
      )}
      {event && actor && dialog === 'reopen' && (
        <ReasonModal
          title={t('ส่งกลับให้ทำใหม่')}
          message={t('บอกผู้ทำว่าต้องแก้อะไร — ข้อความนี้จะอยู่ในประวัติของงาน')}
          confirmText={t('ส่งกลับ')}
          required
          onClose={() => setDialog(null)}
          onSubmit={(reason) => run(() => reopenEvent(event, actor, reason), t('ส่งกลับแล้ว'))}
        />
      )}
    </Modal>
  )
}

function reasonLabel(reason: string | undefined, t: (k: string) => string): string {
  const r = ADJUST_REASONS.find((x) => x.value === reason)
  return r ? t(r.label) : (reason ?? '')
}

function ReorderBody({ meta, inProgress }: { meta: Extract<CalendarItem['meta'], { kind: 'reorder' }>; inProgress: OpenPurchase | null }) {
  const t = useT()
  const u = meta.product.unitType
  return (
    <>
      <Row label={t('สินค้า')}>
        {meta.product.name}
        <span className="doc-no ml-2 text-xs text-ink-faint">{meta.product.sku}</span>
      </Row>
      <Row label={t('คลัง/สาขา')}>{meta.location.name}</Row>
      <Row label={t('แนะนำให้สั่ง')}>
        <span className="num font-semibold text-ink">
          {fmtQty(meta.recommendedQty)} {u}
        </span>
      </Row>
      <Row label={t('คงเหลือ')}>
        {fmtQty(meta.onHand)} {u}
      </Row>
      <Row label={t('กำลังมา')}>
        {fmtQty(meta.incoming)} {u}
      </Row>
      <Row label={t('ใช้เฉลี่ยต่อวัน')}>{meta.avgDaily !== null ? `${fmtQty(meta.avgDaily)} ${u}` : <Muted>{t('ประวัติยังไม่พอ')}</Muted>}</Row>
      {meta.daysLeft !== null && <Row label={t('คาดว่าจะหมดใน')}>{t('{n} วัน', { n: Math.floor(meta.daysLeft) })}</Row>}
      <Row label={t('ผู้ขาย')}>{meta.supplier?.name ?? <Muted>{t('ยังไม่ระบุ')}</Muted>}</Row>
      <Row label={t('คิดจาก')}>
        {meta.basis === 'usage' ? t('อัตราการใช้ × (ระยะส่ง + วันสำรอง) + ขั้นต่ำ') : t('ยังไม่มีประวัติการใช้พอ — เติมให้ถึง 2 เท่าของขั้นต่ำ')}
      </Row>
      <Row label={t('การสั่งซื้อ')}>{inProgress ? <InProgress p={inProgress} /> : <Muted>{t('ยังไม่มี')}</Muted>}</Row>
    </>
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
      {e.sourceType === 'schedule' && <Row label={t('ที่มา')}>{t('สร้างจากตารางนับสต๊อก')}</Row>}
      {e.requiresApproval && <Row label={t('การตรวจ')}>{t('ต้องให้หัวหน้าอนุมัติเมื่อเสร็จ')}</Row>}
      {e.rescheduledFrom !== undefined && (
        <Row label={t('เดิมกำหนด')}>
          {formatThaiDateShort(e.rescheduledFrom)} {timeOf(e.rescheduledFrom)}
        </Row>
      )}
      {e.startedByName && <Row label={t('เริ่มโดย')}>{signed(e.startedByName, e.startedAt)}</Row>}
      {e.completedByName && <Row label={t('ทำเสร็จโดย')}>{signed(e.completedByName, e.completedAt)}</Row>}
      {e.approvedByName && <Row label={t('อนุมัติโดย')}>{signed(e.approvedByName, e.approvedAt)}</Row>}
      {e.cancelReason && <Row label={t('เหตุผลที่ยกเลิก')}>{e.cancelReason}</Row>}
      <Row label={t('อัปเดตล่าสุด')}>{formatThaiDateTime(e.updatedAt)}</Row>
      {(e.history?.length ?? 0) > 0 && <HistoryList history={e.history ?? []} />}
    </>
  )
}

function signed(name: string, at?: number): string {
  return at ? `${name} · ${formatThaiDateTime(at)}` : name
}


const isMs = (v?: string) => !!v && /^[0-9]+$/.test(v)

/** Who did what, newest first. A move shows the old and new time; a reason shows as said. */
function HistoryList({ history }: { history: EventHistoryEntry[] }) {
  const t = useT()
  const when = (v: string) => (isMs(v) ? `${formatThaiDateShort(Number(v))} ${timeOf(Number(v))}` : v)
  return (
    <div className="border-t border-line pt-3">
      <dt className="mb-2 text-xs text-ink-faint">{t('ประวัติ')}</dt>
      <dd>
        <ol className="space-y-2">
          {[...history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-ink">{t(HISTORY_LABEL[h.action] ?? h.action)}</span>
                <span className="text-xs text-ink-soft">{h.byName}</span>
                <span className="num text-xs text-ink-faint">{formatThaiDateTime(h.at)}</span>
              </div>
              {h.action === 'rescheduled' && h.oldValue && h.newValue && (
                <div className="text-xs text-ink-soft">
                  {when(h.oldValue)} → {when(h.newValue)}
                </div>
              )}
              {h.detail === 'waitingApproval' ? (
                <div className="text-xs text-ink-soft">{t('ส่งให้หัวหน้าตรวจ')}</div>
              ) : (
                h.detail && h.action !== 'generated' && <div className="whitespace-pre-line text-xs text-ink-soft">{h.detail}</div>
              )}
            </li>
          ))}
        </ol>
      </dd>
    </div>
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
      {order.status === 'received' && !order.receipts?.length && (
        <>
          <Row label={t('รับของเมื่อ')}>{order.receivedAt ? formatThaiDateTime(order.receivedAt) : ''}</Row>
          {order.invoiceNo && <Row label={t('เลขที่บิล')}>{order.invoiceNo}</Row>}
        </>
      )}
      {/* Delivered in more than one go (24 Sep 2026): each delivery, and what is still owed. */}
      {!!order.receipts?.length && (
        <>
          {order.receipts.map((r, i) => (
            <Row key={r.docNo} label={t('รับรอบที่ {n}', { n: i + 1 })}>
              {formatThaiDate(r.date)} · <span className="doc-no">{r.docNo}</span> · {t('บิล {no}', { no: r.invoiceNo })}
            </Row>
          ))}
          {order.status === 'ordered' && partialLabel(order, t) && (
            <Row label={t('สถานะ')}>{partialLabel(order, t)}</Row>
          )}
          {order.closedShortAt && (
            <Row label={t('ปิดยอดค้าง')}>
              {order.closedShortReason} <Muted>({order.closedShortByName} · {formatThaiDate(order.closedShortAt)})</Muted>
            </Row>
          )}
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
