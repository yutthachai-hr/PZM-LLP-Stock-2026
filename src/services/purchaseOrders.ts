import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
import { isLate } from '../lib/inventoryRules/purchasing'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { sameUnit } from '../lib/units'
import { requireEpochMs } from '../lib/validate'
import { orderCache } from '../data/orderCache'
import { receiveStock } from './stock'
import {
  COL,
  type Product,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
  type PurchaseShareStatus,
  type Supplier,
} from '../types'

/**
 * Orders placed with suppliers, from the list going out to the goods being checked in.
 *
 * ## What this is and is not
 *
 * An order is a promise; the ledger is a fact. Nothing here touches a balance until somebody
 * stands in front of the delivery, checks it against the order, and gives the invoice number.
 * At that moment it becomes an ordinary stock receipt — the same one the receiving screen
 * writes — so the warehouse has one way of knowing how goods arrived, not two.
 *
 * ## Why the reads are shaped this way
 *
 * Orders are read by date range, the same as the calendar, because a dashboard wants "this
 * week" and not "everything since we started". Lines live inside the order rather than in
 * their own collection: an order of sixty lines is one read, and nothing ever needs a line
 * without its order.
 */

/** Above this an order stops being a delivery and starts being a database problem. */
const MAX_LINES = 200

function scoped() {
  return backend.forBrand(getBrand())
}

/** PO-00001. Shares nothing with the stock document numbers, which count separately. */
function makeDocNo(seq: number): string {
  return `PO-${String(seq).padStart(5, '0')}`
}

/**
 * The counter an order's number comes from: one per supplier.
 *
 * The owner's rule is that the numbers belong to the supplier — HOMEMADE CHEESE's first
 * order is PO-00001 whatever anyone else ordered that week, and its second is PO-00002.
 * One shared counter had the eighth order of the day come out as PO-00008 for a supplier
 * ordered from once, which reads as a sequence nobody has.
 */
export function counterId(supplierId: string): string {
  return `purchaseOrder__${supplierId}`
}

/**
 * The lowest value each supplier's counter may hold, given the orders that exist.
 *
 * Two things are counted and the larger wins. The number of orders the supplier has, so a
 * supplier's first order under per-supplier numbering is counted after the ones it already
 * had. And the highest number actually printed on one of them — the eight orders placed
 * under the old shared counter carry numbers up to PO-00008, and a supplier whose one order
 * says PO-00008 would otherwise reach a second PO-00008 seven orders later. A gap in the
 * sequence is a curiosity; the same number on two orders is a filing error.
 *
 * Used when an order is placed, and by the restore to rebuild the counters from the orders
 * it has just put back.
 */
export function orderCounterFloors(orders: readonly PurchaseOrder[]): Map<string, number> {
  const count = new Map<string, number>()
  const max = new Map<string, number>()
  for (const o of orders) {
    const id = counterId(o.supplierId)
    count.set(id, (count.get(id) ?? 0) + 1)
    const seq = Number(String(o.docNo ?? '').split('-')[1])
    if (Number.isFinite(seq) && seq > (max.get(id) ?? 0)) max.set(id, seq)
  }
  const out = new Map<string, number>()
  for (const [id, n] of count) out.set(id, Math.max(n, max.get(id) ?? 0))
  return out
}

// ---------------------------------------------------------------- renumbering ----

/** One order whose number the renumbering would change. */
export interface RenumberChange {
  id: string
  supplierId: string
  supplierName: string
  from: string
  to: string
}

/**
 * The numbers every order SHOULD carry under the owner's rule: each supplier's orders
 * count 1, 2, 3 … in the order they were placed, whatever else was ordered that week.
 *
 * Orders placed before the numbers were made per-supplier (14 Sep 2026) took the old
 * shared sequence, so a supplier ordered from once was holding PO-00005 and its next
 * order came out as PO-00006 — a sequence that supplier never had. The owner's ruling
 * (15 Sep): BETAGRO's orders are BETAGRO's first, second, third, and the old numbers are
 * put right, not worked around. Sorted by when the order was placed, then by when it was
 * recorded, so two on one day keep the order they were keyed in.
 */
export function renumberPlan(orders: readonly PurchaseOrder[]): {
  changes: RenumberChange[]
  counters: Map<string, number>
} {
  const bySupplier = new Map<string, PurchaseOrder[]>()
  for (const o of orders) bySupplier.set(o.supplierId, [...(bySupplier.get(o.supplierId) ?? []), o])
  const changes: RenumberChange[] = []
  const counters = new Map<string, number>()
  for (const [supplierId, list] of bySupplier) {
    list.sort((a, b) => a.orderedAt - b.orderedAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    list.forEach((o, i) => {
      const to = makeDocNo(i + 1)
      if (o.docNo !== to) {
        changes.push({ id: o.id, supplierId, supplierName: o.supplierName, from: o.docNo, to })
      }
    })
    counters.set(counterId(supplierId), list.length)
  }
  return { changes, counters }
}

/**
 * Put every order's number right, and every supplier's counter with it.
 *
 * Reads the whole collection (tens of documents) and rewrites only the numbers that
 * differ from the plan. Admin only — the rules let nobody else touch a number once
 * written, and a counter may only ever go up, so a counter that must come DOWN is
 * removed and created afresh rather than edited. Returns what was changed so the screen
 * can show it and the history can name it.
 */
export async function renumberOrdersPerSupplier(): Promise<RenumberChange[]> {
  const db = scoped()
  const orders = await db.getAll<PurchaseOrder>(COL.purchaseOrders)
  const { changes, counters } = renumberPlan(orders)
  const now = Date.now()
  for (const c of changes) {
    await db.update(COL.purchaseOrders, c.id, { docNo: c.to, updatedAt: now })
  }
  for (const [id, value] of counters) {
    const cur = await db.getOne<{ value: number }>(COL.counters, id)
    if (cur?.value === value) continue
    if (cur && cur.value > value) await db.remove(COL.counters, id)
    await db.set(COL.counters, id, { value })
  }
  return changes
}

export interface OrderLineInput {
  productId: string
  qty: number
  /** The unit keyed. Dropped when it is the product's own, however it was spelled. */
  entryUnit?: string
}

/**
 * Open an order for one supplier.
 *
 * The lines are looked up from the catalogue rather than trusted from the caller, so an
 * order always names the product and unit that existed when it was placed.
 */
export async function createPurchaseOrder(params: {
  supplier: Pick<Supplier, 'id' | 'name'>
  locationId: string
  lines: readonly OrderLineInput[]
  products: readonly Product[]
  actor: { id: string; name: string }
  orderedAt?: number
  /** The day the supplier is to deliver. Omitted = unknown (the lead time stands in). */
  expectedAt?: number
  eventId?: string
  /**
   * The imported order list this came from. Such an order is born a draft: it is a
   * proposal until somebody approves it, and the sheet is never shared before that.
   */
  batchId?: string
  /** The approved purchase request this comes from. Placed at once — the approval was the decision. */
  requestId?: string
  note?: string
}): Promise<string> {
  const { supplier, locationId, actor } = params
  if (!supplier.id) throw new AppError('กรุณาเลือกผู้ขาย')
  if (!locationId) throw new AppError('กรุณาเลือกคลังปลายทาง')
  const orderedAt = params.orderedAt ?? Date.now()
  requireEpochMs(orderedAt)
  if (params.expectedAt !== undefined) requireEpochMs(params.expectedAt)

  const byId = new Map(params.products.map((p) => [p.id, p]))
  const lines: PurchaseOrderLine[] = []
  for (const l of params.lines) {
    if (!(l.qty > 0)) continue // a line nobody put a number against is not an order
    const p = byId.get(l.productId)
    if (!p) throw new AppError('ไม่พบสินค้า')
    const entryUnit = (l.entryUnit ?? '').trim()
    lines.push({
      productId: p.id,
      productName: p.name,
      unit: p.unitType,
      ...(entryUnit && !sameUnit(entryUnit, p.unitType) ? { entryUnit } : {}),
      orderedQty: l.qty,
    })
  }
  if (lines.length === 0) throw new AppError('ยังไม่ได้ระบุจำนวนสินค้าที่จะสั่ง')
  if (lines.length > MAX_LINES) {
    throw new AppError('สั่งได้สูงสุด {max} รายการต่อใบ', { max: MAX_LINES })
  }

  const db = scoped()

  // Orders placed before the numbers became per-supplier carry the old shared sequence,
  // and the rules freeze an order's number once written — so they stay as they are, and
  // the supplier's counter starts from the floor those orders set (see orderCounterFloors).
  // Read outside the transaction (a query cannot run inside one) and used only when the
  // supplier's counter does not exist yet; if two people open the same new supplier's
  // first order at once, the second transaction retries against the counter the first
  // one created and never sees this number.
  const existing = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'supplierId', supplier.id)
  const seed = orderCounterFloors(existing).get(counterId(supplier.id)) ?? 0

  return db.transaction(async (tx) => {
    const counter = await tx.get<{ value: number }>(COL.counters, counterId(supplier.id))
    const seq = (counter?.value ?? seed) + 1
    tx.set(COL.counters, counterId(supplier.id), { value: seq })
    const now = Date.now()
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
    tx.set(COL.purchaseOrders, id, {
      docNo: makeDocNo(seq),
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: (params.batchId ? 'draft' : 'ordered') satisfies PurchaseOrderStatus,
      locationId,
      orderedAt,
      ...(params.expectedAt !== undefined ? { expectedAt: params.expectedAt } : {}),
      lines,
      ...(params.eventId ? { eventId: params.eventId } : {}),
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(params.note?.trim() ? { note: params.note.trim() } : {}),
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    return id
  })
}

/**
 * Turn a draft into an order.
 *
 * The moment the proposal becomes a promise: from here the order counts as waiting for
 * goods, shows on the dashboard, and may be sent. `orderedAt` is reset to now, because the
 * date an order was drafted is not the date it was placed. Who approved is written on the
 * order itself, so a sheet that turns out wrong can be traced without the batch.
 */
export async function approvePurchaseOrder(
  id: string,
  actor: { id: string; name: string },
): Promise<void> {
  const db = scoped()
  await db.transaction(async (tx) => {
    const order = await tx.get<PurchaseOrder>(COL.purchaseOrders, id)
    if (!order) throw new AppError('ไม่พบใบสั่งซื้อ')
    if (order.status !== 'draft') return // already approved; idempotent by design
    const now = Date.now()
    tx.update(COL.purchaseOrders, id, {
      status: 'ordered' satisfies PurchaseOrderStatus,
      orderedAt: now,
      approvedBy: actor.id,
      approvedByName: actor.name,
      approvedAt: now,
      updatedAt: now,
    })
  })
}

/**
 * Record where the sheet has got to on its way to the supplier — see the field's comment on
 * PurchaseOrder for what each status may honestly claim.
 */
export async function setShareStatus(
  id: string,
  status: PurchaseShareStatus,
  actor: { id: string; name: string },
  imageVersion?: number,
): Promise<void> {
  const now = Date.now()
  const patch: Record<string, unknown> = { shareStatus: status, updatedAt: now }
  if (status === 'shareOpened') patch.shareOpenedAt = now
  if (status === 'sent') {
    patch.sentAt = now
    patch.sentBy = actor.id
    patch.sentByName = actor.name
    if (imageVersion !== undefined) patch.imageVersion = imageVersion
  }
  await scoped().update(COL.purchaseOrders, id, patch)
}

/**
 * Orders placed in a window, newest first.
 *
 * One field, two bounds — the automatic index serves it, so no composite index to deploy,
 * which is the same reason the calendar queries the way it does.
 */
export async function listOrdersInRange(from: number, to: number): Promise<PurchaseOrder[]> {
  requireEpochMs(from)
  requireEpochMs(to)
  if (to < from) throw new AppError('ช่วงวันที่ไม่ถูกต้อง')
  const rows = await scoped().getRange<PurchaseOrder>(COL.purchaseOrders, 'orderedAt', from, to)
  return rows.sort((a, b) => b.orderedAt - a.orderedAt)
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  return scoped().getOne<PurchaseOrder>(COL.purchaseOrders, id)
}

/**
 * When the supplier is to deliver: the date on the order, else the lead time counted from
 * the order date, else nothing. Bangkok days; see lib/inventoryRules/purchasing.ts.
 */
export { expectedDeliveryAt, CHASE_AFTER_DAYS } from '../lib/inventoryRules/purchasing'

/**
 * Change the delivery date the order is waiting on — the supplier said a different day,
 * or none was known when it was placed. Dated to the start of that day.
 */
export async function setExpectedDelivery(id: string, expectedAt: number | undefined): Promise<void> {
  if (expectedAt !== undefined) requireEpochMs(expectedAt)
  await scoped().update(COL.purchaseOrders, id, {
    expectedAt: expectedAt === undefined ? DELETE_FIELD : expectedAt,
    updatedAt: Date.now(),
  })
}

/**
 * Orders that have not arrived by the day they were due — the date on the order when it
 * has one, otherwise the owner's rule of three days after ordering.
 */
export function overdueOrders(
  orders: readonly PurchaseOrder[],
  now = Date.now(),
  leadTimeOf?: (supplierId: string) => number | undefined,
): PurchaseOrder[] {
  return orders.filter((o) => o.status === 'ordered' && isLate(o, now, leadTimeOf?.(o.supplierId)))
}

export { isLate } from '../lib/inventoryRules/purchasing'

/** Whole days an order has been waiting since it was placed, for "รอมา n วัน". */
export function daysWaiting(order: PurchaseOrder, now = Date.now()): number {
  return Math.floor((now - order.orderedAt) / 86_400_000)
}

export interface ReceiptLineInput {
  productId: string
  /** What actually arrived. Zero means none of it did. */
  receivedQty: number
  /** Ticked to say it matched the order. */
  checked: boolean
  note?: string
}

/**
 * Check a delivery in, and take it into stock.
 *
 * The rules the owner set, enforced here rather than only in the form, because a form is
 * client code and this is the moment stock becomes real:
 *
 *   - every line is accounted for, either ticked as correct or given a quantity;
 *   - a line whose quantity does not match the order needs a reason written against it;
 *   - the invoice number is required, exactly as it is when a receipt is keyed by hand.
 *
 * The stock receipt is an ordinary one. The order records which receipt it became, so the
 * two can be read against each other, and it is written after the stock has actually moved —
 * an order marked received with no goods behind it is the one state worth never producing.
 */
export async function receivePurchaseOrder(params: {
  orderId: string
  invoiceNo: string
  lines: readonly ReceiptLineInput[]
  actor: { id: string; name: string }
  date?: number
}): Promise<{ docNo: string; receivedLines: number }> {
  const { orderId, actor } = params
  const invoiceNo = params.invoiceNo.trim()
  if (!invoiceNo) throw new AppError('กรุณาระบุเลขที่บิล/ใบส่งของ')

  const db = scoped()
  const order = await db.getOne<PurchaseOrder>(COL.purchaseOrders, orderId)
  if (!order) throw new AppError('ไม่พบใบสั่งซื้อ')
  if (order.status === 'received') throw new AppError('ใบสั่งซื้อนี้รับของแล้ว')
  // A draft is a proposal nobody has placed; goods cannot arrive against it.
  if (order.status === 'draft') throw new AppError('ใบสั่งซื้อนี้ยังเป็นร่าง ต้องอนุมัติก่อนรับของ')

  const given = new Map(params.lines.map((l) => [l.productId, l]))
  const settled: PurchaseOrderLine[] = []
  for (const line of order.lines) {
    const input = given.get(line.productId)
    if (!input) throw new AppError('ยังตรวจไม่ครบทุกรายการ')
    const receivedQty = input.checked ? line.orderedQty : input.receivedQty
    if (!Number.isFinite(receivedQty) || receivedQty < 0) {
      throw new AppError('จำนวนที่รับต้องไม่ติดลบ')
    }
    // A number that differs from the order is a discrepancy, and a discrepancy without a
    // reason is the thing nobody can explain a month later.
    if (receivedQty !== line.orderedQty && !input.note?.trim()) {
      throw new AppError('กรุณาระบุเหตุผลของรายการที่จำนวนไม่ตรง: {name}', {
        name: line.productName,
      })
    }
    settled.push({
      ...line,
      receivedQty,
      checked: !!input.checked,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    })
  }

  const arrived = settled.filter((l) => (l.receivedQty ?? 0) > 0)
  if (arrived.length === 0) throw new AppError('ไม่มีรายการที่รับเข้า')

  // Stock first. If this fails nothing has been marked received, and the check can be redone.
  const docNo = await receiveStock({
    toLocationId: order.locationId,
    lines: arrived.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      unit: l.unit,
      // Into the balance for the unit it was ordered in, exactly as the receiving screen
      // would file it if the same person keyed the same delivery by hand.
      ...(l.entryUnit ? { entryUnit: l.entryUnit } : {}),
      qty: l.receivedQty!,
    })),
    actor,
    date: params.date ?? Date.now(),
    note: invoiceNo,
  })

  const now = Date.now()
  await db.update(COL.purchaseOrders, orderId, {
    status: 'received' satisfies PurchaseOrderStatus,
    lines: settled,
    invoiceNo,
    // The date on the delivery note, the same one the stock receipt is filed under — not
    // the moment it was keyed. (Until 17 Sep 2026 this was Date.now(), which stamped every
    // receipt with the day it was typed in.) `updatedAt` keeps the keying time.
    receivedAt: params.date ?? now,
    receivedBy: actor.id,
    receivedByName: actor.name,
    movementDocNo: docNo,
    updatedAt: now,
  })
  return { docNo, receivedLines: arrived.length }
}

/**
 * Put right the received orders stamped with the keying day instead of the delivery date.
 *
 * Every receipt files a stock movement under the date the person chose; the order used to
 * be stamped with Date.now(). The movement is the truth, so each received order takes the
 * date of the movement it points at. Safe to run again: an order already right is skipped.
 */
export async function repairReceivedDates(): Promise<{ checked: number; fixed: number }> {
  const db = scoped()
  const orders = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'received')
  let fixed = 0
  for (const o of orders) {
    if (!o.movementDocNo || o.receivedAt === undefined) continue
    const moves = await db.getBy<{ date: number }>(COL.movements, 'docNo', o.movementDocNo)
    const date = moves[0]?.date
    if (date === undefined || sameDay(date, o.receivedAt)) continue
    await db.update(COL.purchaseOrders, o.id, { receivedAt: date, updatedAt: Date.now() })
    orderCache.patch({ ...o, receivedAt: date })
    fixed++
  }
  return { checked: orders.length, fixed }
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/**
 * Call an order off — one never placed, or one the goods never came for. Stock is never
 * involved, and the document is never removed: it keeps its number, and records who
 * cancelled it and why, so the sequence PO-00001, 00002, 00003 has no holes an audit
 * cannot explain. (Until 18 Sep 2026 this deleted the document.)
 */
export async function cancelPurchaseOrder(params: {
  id: string
  reason: string
  actor: { id: string; name: string }
}): Promise<PurchaseOrder> {
  const reason = params.reason.trim()
  if (!reason) throw new AppError('กรุณาระบุเหตุผลที่ยกเลิก')
  const db = scoped()
  const order = await db.getOne<PurchaseOrder>(COL.purchaseOrders, params.id)
  if (!order) throw new AppError('ไม่พบใบสั่งซื้อ')
  if (order.status === 'received') throw new AppError('ยกเลิกไม่ได้: ใบสั่งซื้อนี้รับของเข้าคลังแล้ว')
  if (order.status === 'cancelled') throw new AppError('ใบสั่งซื้อนี้ยกเลิกไปแล้ว')
  const now = Date.now()
  const patch = {
    status: 'cancelled' as const,
    cancelReason: reason,
    cancelledBy: params.actor.id,
    cancelledByName: params.actor.name,
    cancelledAt: now,
    updatedAt: now,
  }
  await db.update(COL.purchaseOrders, params.id, patch)
  const next: PurchaseOrder = { ...order, ...patch }
  orderCache.patch(next)
  return next
}

/**
 * Drop a draft. Only a draft: it is a proposal the import screen rebuilds as rows change,
 * not an order anyone was told about. Anything placed is cancelled, never removed.
 */
export async function deletePurchaseOrder(id: string): Promise<void> {
  const order = await scoped().getOne<PurchaseOrder>(COL.purchaseOrders, id)
  if (order && order.status !== 'draft') {
    throw new AppError('ลบได้เฉพาะร่าง ใบที่สั่งแล้วต้องยกเลิกพร้อมเหตุผล')
  }
  await scoped().remove(COL.purchaseOrders, id)
  orderCache.remove(id)
}

/**
 * What was ordered from whom in a window, for the summary the owner asked for:
 * "on 12/9, which supplier, which items, how many".
 *
 * Computed over orders already read rather than by querying again.
 */
export function summariseBySupplier(
  orders: readonly PurchaseOrder[],
): { supplierName: string; orders: number; lines: number; items: number }[] {
  const by = new Map<string, { supplierName: string; orders: number; lines: number; items: number }>()
  for (const o of orders) {
    if (o.status === 'draft' || o.status === 'cancelled') continue // neither was ordered from anyone
    const row = by.get(o.supplierId) ?? {
      supplierName: o.supplierName,
      orders: 0,
      lines: 0,
      items: 0,
    }
    row.orders++
    row.lines += o.lines.length
    row.items += o.lines.reduce((n, l) => n + l.orderedQty, 0)
    by.set(o.supplierId, row)
  }
  return [...by.values()].sort((a, b) => b.orders - a.orders || a.supplierName.localeCompare(b.supplierName))
}
