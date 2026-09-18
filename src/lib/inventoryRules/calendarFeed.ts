import type { PurchaseOrder, StockEvent } from '../../types'
import { shortages } from './lowStock'
import { CHASE_AFTER_DAYS, cutoffInstants, daysLate, deliveryState, expectedDeliveryAt } from './purchasing'
import { bkkDayEnd, bkkDayStart, bkkDaysBetween, bkkTimeOf, DAY_MS } from './time'
import type { CalendarItem, FeedInput, ItemPriority, ItemStatus } from './types'

/**
 * Everything on the calendar for a window, from data the caller already holds.
 *
 * Pure and deterministic: the same input gives the same items with the same ids, so a
 * screen can rebuild it on every render and a job can run it twice without creating
 * anything twice. Titles are translation keys with {params}; the screens render them.
 */

// Title keys, filled by the screen through t(). i18n-key
export const TITLE = {
  task: '{title}',
  poExpected: '{supplier} · {n} รายการ · {docNo}', // i18n-key
  prPending: '{docNo} รออนุมัติ · {n} รายการ', // i18n-key
  cutoff: 'ตัดรอบสั่ง {supplier} · {time}', // i18n-key
  lowStock: '{product} ใกล้หมด · เหลือ {qty} {unit}', // i18n-key
  outOfStock: '{product} หมด · {location}', // i18n-key
  reorder: 'แนะนำสั่ง {product} · {qty} {unit}', // i18n-key
  stockoutEstimate: '{product} คาดว่าจะหมดใน {days} วัน', // i18n-key
  adjustment: 'ปรับสต๊อก {product} {sign}{qty} {unit}', // i18n-key
  waste: 'ของเสีย {product} -{qty} {unit}', // i18n-key
} as const

const PRIORITY_RANK: Record<ItemPriority, number> = { critical: 0, high: 1, medium: 2, normal: 3 }

function inRange(at: number, range: { from: number; to: number }): boolean {
  return at >= range.from && at <= range.to
}

/** A task's due moment: its deadline, else the end of the day it starts. */
export function taskDueAt(e: Pick<StockEvent, 'startAt' | 'dueAt'>): number {
  return e.dueAt ?? bkkDayEnd(e.startAt)
}

export function isTaskOpen(e: Pick<StockEvent, 'status'>): boolean {
  return e.status === 'upcoming' || e.status === 'inProgress' || e.status === 'waitingApproval'
}

export function isTaskOverdue(e: Pick<StockEvent, 'status' | 'startAt' | 'dueAt'>, now: number): boolean {
  return (e.status === 'upcoming' || e.status === 'inProgress') && taskDueAt(e) < now
}

function taskStatus(e: StockEvent, now: number): ItemStatus {
  if (isTaskOverdue(e, now)) return 'overdue'
  switch (e.status) {
    case 'upcoming':
      return 'pending'
    case 'inProgress':
      return 'inProgress'
    case 'waitingApproval':
      return 'waitingApproval'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
  }
}

function taskPriority(e: StockEvent, status: ItemStatus): ItemPriority {
  if (status === 'overdue') return e.priority === 'critical' ? 'critical' : 'high'
  return e.priority === 'critical' ? 'critical' : e.priority === 'high' ? 'high' : 'normal'
}

export function taskItem(e: StockEvent, now: number): CalendarItem {
  const status = taskStatus(e, now)
  return {
    id: `task__${e.id}`,
    kind: 'task',
    sourceType: 'stockEvent',
    sourceId: e.id,
    titleKey: TITLE.task,
    titleParams: { title: e.title },
    at: e.startAt,
    endAt: e.dueAt,
    allDay: false,
    locationId: e.locationId,
    productId: e.productId,
    supplierId: e.supplierId,
    priority: taskPriority(e, status),
    status,
    meta: { kind: 'task', event: e },
    persisted: true,
  }
}

/** Where an order sits on the calendar: its due day, or the day it becomes worth chasing. */
export function orderDay(order: PurchaseOrder, leadTimeDays?: number): number {
  if (order.status === 'received' && order.receivedAt !== undefined) return bkkDayStart(order.receivedAt)
  return expectedDeliveryAt(order, leadTimeDays) ?? bkkDayStart(order.orderedAt) + CHASE_AFTER_DAYS * DAY_MS
}

export function buildFeed(input: FeedInput): CalendarItem[] {
  const { range, now } = input
  const items: CalendarItem[] = []
  const supplierById = new Map(input.suppliers.map((s) => [s.id, s]))
  const locationName = (id: string | undefined) => input.locations.find((l) => l.id === id)?.name ?? ''

  for (const e of input.events) {
    // Kinds this calendar no longer offers are still shown while their documents exist.
    if (inRange(e.startAt, range)) items.push(taskItem(e, now))
  }

  for (const order of input.orders) {
    // A draft was never placed and a cancelled order never will be: neither is awaited.
    if (order.status === 'draft' || order.status === 'cancelled') continue
    const lead = supplierById.get(order.supplierId)?.leadTimeDays
    const at = orderDay(order, lead)
    if (!inRange(at, range)) continue
    const delivery = deliveryState(order, now, lead)
    const late = daysLate(order, now, lead)
    const status: ItemStatus = delivery === 'received' ? 'completed' : delivery === 'delayed' ? 'overdue' : 'pending'
    items.push({
      id: `poExpected__${order.id}`,
      kind: 'poExpected',
      sourceType: 'purchaseOrder',
      sourceId: order.id,
      titleKey: TITLE.poExpected,
      titleParams: { supplier: order.supplierName, n: order.lines.length, docNo: order.docNo },
      at,
      allDay: true,
      locationId: order.locationId,
      supplierId: order.supplierId,
      priority: delivery === 'delayed' ? 'high' : delivery === 'arrivingToday' ? 'medium' : 'normal',
      status,
      meta: { kind: 'poExpected', order, delivery, daysLate: late, items: order.lines.length },
      persisted: false,
    })
  }

  for (const pr of input.requests) {
    if (pr.status !== 'pendingApproval') continue
    const at = pr.submittedAt ?? pr.createdAt
    if (!inRange(at, range)) continue
    const live = pr.items.filter((i) => !i.removed)
    const waitingDays = bkkDaysBetween(at, now)
    items.push({
      id: `prPending__${pr.id}`,
      kind: 'prPending',
      sourceType: 'purchaseRequest',
      sourceId: pr.id,
      titleKey: TITLE.prPending,
      titleParams: { docNo: pr.docNo, n: live.length },
      at,
      allDay: false,
      locationId: pr.locationId,
      priority: waitingDays >= 2 ? 'high' : 'medium',
      status: 'pending',
      meta: {
        kind: 'prPending',
        request: pr,
        items: live.length,
        suppliers: new Set(live.map((i) => i.supplierId)).size,
        waitingDays,
      },
      persisted: false,
    })
  }

  for (const supplier of input.suppliers) {
    for (const at of cutoffInstants(supplier, range)) {
      items.push({
        id: `cutoff__${supplier.id}__${bkkDayStart(at)}`,
        kind: 'cutoff',
        sourceType: 'supplier',
        sourceId: supplier.id,
        titleKey: TITLE.cutoff,
        titleParams: { supplier: supplier.name, time: bkkTimeOf(at) },
        at,
        allDay: false,
        supplierId: supplier.id,
        priority: 'normal',
        status: at < now ? 'completed' : 'info',
        meta: { kind: 'cutoff', supplier, time: bkkTimeOf(at) },
        persisted: false,
      })
    }
  }

  // Shortages are a fact about today, so they sit on today — and only when today is in view.
  const today = bkkDayStart(now)
  if (inRange(today, range)) {
    for (const s of shortages(input)) {
      items.push({
        id: `${s.out ? 'outOfStock' : 'lowStock'}__${s.product.id}__${s.location.id}`,
        kind: s.out ? 'outOfStock' : 'lowStock',
        sourceType: 'stockLevel',
        sourceId: `${s.location.id}__${s.product.id}`,
        titleKey: s.out ? TITLE.outOfStock : TITLE.lowStock,
        titleParams: {
          product: s.product.name,
          location: locationName(s.location.id),
          qty: s.qty,
          unit: s.product.unitType,
        },
        at: today,
        allDay: true,
        locationId: s.location.id,
        productId: s.product.id,
        supplierId: s.product.supplierId,
        priority: s.out ? 'critical' : 'medium',
        status: 'info',
        meta: { kind: s.out ? 'outOfStock' : 'lowStock', product: s.product, location: s.location, qty: s.qty, min: s.min },
        persisted: false,
      })
    }
  }

  // The analysis: suggestions and estimates sit on today, adjustments on their own day.
  const ins = input.insights
  if (ins && inRange(today, range)) {
    for (const r of ins.reorders) {
      items.push({
        id: `reorder__${r.product.id}__${r.location.id}`,
        kind: 'reorder',
        sourceType: 'derived',
        sourceId: `${r.location.id}__${r.product.id}`,
        titleKey: TITLE.reorder,
        titleParams: { product: r.product.name, qty: r.recommendedQty, unit: r.product.unitType },
        at: today,
        allDay: true,
        locationId: r.location.id,
        productId: r.product.id,
        supplierId: r.supplier?.id,
        priority: r.inProgress ? 'normal' : 'medium',
        status: 'info',
        meta: {
          kind: 'reorder',
          product: r.product,
          location: r.location,
          onHand: r.onHand,
          incoming: r.incoming,
          avgDaily: r.avgDaily,
          daysLeft: r.daysLeft,
          recommendedQty: r.recommendedQty,
          supplier: r.supplier,
          basis: r.basis,
        },
        persisted: false,
      })
    }
    for (const s of ins.stockouts) {
      items.push({
        id: `stockoutEstimate__${s.product.id}__${s.location.id}`,
        kind: 'stockoutEstimate',
        sourceType: 'derived',
        sourceId: `${s.location.id}__${s.product.id}`,
        titleKey: TITLE.stockoutEstimate,
        titleParams: { product: s.product.name, days: Math.max(0, Math.floor(s.daysLeft)) },
        at: today,
        allDay: true,
        locationId: s.location.id,
        productId: s.product.id,
        priority: 'high',
        status: 'info',
        meta: { kind: 'stockoutEstimate', product: s.product, location: s.location, qty: s.qty, avgDaily: s.avgDaily, daysLeft: s.daysLeft },
        persisted: false,
      })
    }
  }
  for (const a of ins?.adjustments ?? []) {
    const m = a.movement
    if (!inRange(m.date, range)) continue
    items.push({
      id: `${a.kind}__${m.id}`,
      kind: a.kind,
      sourceType: 'movement',
      sourceId: m.id,
      titleKey: a.kind === 'waste' ? TITLE.waste : TITLE.adjustment,
      titleParams: { product: m.productName, qty: m.qty, unit: m.unit, sign: m.fromLocationId ? '-' : '+' },
      at: m.date,
      allDay: true,
      locationId: m.fromLocationId ?? m.toLocationId,
      productId: m.productId,
      priority: 'high',
      status: 'info',
      meta: { kind: a.kind, movement: m, product: a.product, value: a.value ?? 0 },
      persisted: false,
    })
  }

  return items.sort(
    (a, b) => a.at - b.at || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id),
  )
}
