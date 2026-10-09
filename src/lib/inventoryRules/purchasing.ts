import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus, PurchaseRequest, PurchaseRequestStatus, Supplier } from '../../types'
import { bkkAtTime, bkkDayStart, bkkDaysBetween, bkkWeekday, DAY_MS } from './time'
import type { DeliveryState } from './types'
import { resolveFactor, type UnitBearer } from './uom'

/**
 * What the purchasing records say about time: when goods are due, whether they are late,
 * whether something is already on order — and a supplier's order days as calendar entries.
 */

/**
 * How long an order may sit as "ordered" with no delivery date before it is worth chasing.
 * The owner's number: three days without the goods turning up.
 */
export const CHASE_AFTER_DAYS = 3

/**
 * When the supplier is to deliver, as the start of a Bangkok day: the date written on the
 * order; else the lead time counted from the order date; else nothing is known.
 */
export function expectedDeliveryAt(
  order: Pick<PurchaseOrder, 'orderedAt' | 'expectedAt'>,
  leadTimeDays?: number,
): number | undefined {
  if (order.expectedAt !== undefined) return bkkDayStart(order.expectedAt)
  if (leadTimeDays === undefined) return undefined
  return bkkDayStart(order.orderedAt) + leadTimeDays * DAY_MS
}

/** The day an order counts as late from: its due day, or the chase rule when it has none. */
export function lateFrom(order: Pick<PurchaseOrder, 'orderedAt' | 'expectedAt'>, leadTimeDays?: number): number {
  const due = expectedDeliveryAt(order, leadTimeDays)
  return due !== undefined ? due + DAY_MS : bkkDayStart(order.orderedAt) + CHASE_AFTER_DAYS * DAY_MS
}

export function isLate(order: PurchaseOrder, now: number, leadTimeDays?: number): boolean {
  return order.status === 'ordered' && now >= lateFrom(order, leadTimeDays)
}

/** Whole days past the due day (0 when not yet late). */
export function daysLate(order: PurchaseOrder, now: number, leadTimeDays?: number): number {
  if (!isLate(order, now, leadTimeDays)) return 0
  return Math.max(1, bkkDaysBetween(lateFrom(order, leadTimeDays), now) + 1)
}

export function deliveryState(order: PurchaseOrder, now: number, leadTimeDays?: number): DeliveryState {
  if (order.status === 'received') return 'received'
  if (isLate(order, now, leadTimeDays)) return 'delayed'
  const due = expectedDeliveryAt(order, leadTimeDays)
  if (due !== undefined && bkkDayStart(now) === due) return 'arrivingToday'
  return 'expected'
}

const OPEN_PR: readonly PurchaseRequestStatus[] = ['draft', 'pendingApproval', 'returned', 'approved']
const OPEN_PO: readonly PurchaseOrderStatus[] = ['draft', 'ordered']

export interface OpenPurchase {
  kind: 'pr' | 'po'
  id: string
  docNo: string
  status: string
  qty: number
}

/**
 * Something already on its way for this product, so nobody raises it twice: an open
 * request that lists it, or an order not yet received that carries it. The request is
 * matched to the location when one is given; an order counts wherever it lands, because
 * goods are moved between sites and a second order is a second order.
 */
export function openPurchaseFor(
  productId: string,
  locationId: string | undefined,
  data: { requests: readonly PurchaseRequest[]; orders: readonly PurchaseOrder[] },
): OpenPurchase | null {
  for (const pr of data.requests) {
    if (!OPEN_PR.includes(pr.status)) continue
    if (locationId && pr.locationId !== locationId) continue
    const line = pr.items.find((i) => !i.removed && i.productId === productId)
    if (line) {
      return { kind: 'pr', id: pr.id, docNo: pr.docNo, status: pr.status, qty: line.approvedQty ?? line.requestedQty ?? 0 }
    }
  }
  for (const po of data.orders) {
    if (!OPEN_PO.includes(po.status)) continue
    const line = po.lines.find((l) => l.productId === productId)
    if (line) return { kind: 'po', id: po.id, docNo: po.docNo, status: po.status, qty: line.orderedQty }
  }
  return null
}

/** What is still to come on one order line, in the product's own unit. */
export interface RemainingQty {
  qty: number
  /**
   * Converted at the product's rate today, not the rate the order was placed at: a line
   * keyed in another unit before 20 Sep 2026 kept no base quantity. Worth saying so on screen.
   */
  estimated: boolean
  /** No rate at all for the line's unit — it could not be counted, and is left out (0). */
  unknown: boolean
}

/**
 * The one rule for "how much of this line has not arrived yet" (plan A2, 6 Oct 2026):
 * (ordered − received) in the unit the order was placed in, never below zero, times the
 * rate at the time of ordering. `receivedQty` is the running total of deliveries in that
 * same unit; an over-delivery leaves nothing outstanding on the line and takes nothing
 * from another. Closed and cancelled orders are not asked — callers look at `ordered` ones,
 * which is how a closed remainder stops counting.
 */
export function remainingBaseQty(
  line: Pick<PurchaseOrderLine, 'orderedQty' | 'receivedQty' | 'baseQty' | 'entryUnit'>,
  product?: UnitBearer,
): RemainingQty {
  const owed = Math.max(0, line.orderedQty - (line.receivedQty ?? 0))
  const round = (n: number) => Math.round(n * 1000) / 1000
  if (!line.entryUnit) return { qty: round(owed), estimated: false, unknown: false }
  if (line.baseQty !== undefined && line.orderedQty > 0) return { qty: round(owed * (line.baseQty / line.orderedQty)), estimated: false, unknown: false }
  const today = product ? resolveFactor(product, line.entryUnit) : null
  if (today === null) return { qty: 0, estimated: false, unknown: owed > 0 }
  return { qty: round(owed * today), estimated: true, unknown: false }
}

/**
 * Base-unit quantity on placed orders to a location that has not arrived yet — what is
 * still owed, not what was ordered: a part-delivered order's arrived share is already on
 * hand, and counting it again here under-ordered (audit D2). `product` lets an old line
 * keyed in another unit be estimated at today's rate instead of counting as nothing.
 */
export function incomingFor(productId: string, locationId: string, orders: readonly PurchaseOrder[], product?: UnitBearer): number {
  let n = 0
  for (const po of orders) {
    if (po.status !== 'ordered' || po.locationId !== locationId) continue
    for (const l of po.lines) {
      if (l.productId !== productId) continue
      n += remainingBaseQty(l, product).qty
    }
  }
  return Math.round(n * 1000) / 1000
}

/**
 * The instants a supplier's order cut-off falls in a window: one per order day that has a
 * cut-off time. A supplier with days but no time gets none — a day without a deadline is
 * not a calendar entry.
 */
export function cutoffInstants(supplier: Supplier, range: { from: number; to: number }): number[] {
  const days = supplier.orderDays ?? []
  const time = supplier.cutoffTime
  if (!time || days.length === 0 || supplier.active === false) return []
  const out: number[] = []
  for (let day = bkkDayStart(range.from); day <= range.to; day += DAY_MS) {
    if (!days.includes(bkkWeekday(day))) continue
    const at = bkkAtTime(day, time)
    if (at >= range.from && at <= range.to) out.push(at)
  }
  return out
}
