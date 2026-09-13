import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { requireEpochMs } from '../lib/validate'
import { receiveStock } from './stock'
import {
  COL,
  type Product,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
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

export interface OrderLineInput {
  productId: string
  qty: number
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
  eventId?: string
  note?: string
}): Promise<string> {
  const { supplier, locationId, actor } = params
  if (!supplier.id) throw new AppError('กรุณาเลือกผู้ขาย')
  if (!locationId) throw new AppError('กรุณาเลือกคลังปลายทาง')
  const orderedAt = params.orderedAt ?? Date.now()
  requireEpochMs(orderedAt)

  const byId = new Map(params.products.map((p) => [p.id, p]))
  const lines: PurchaseOrderLine[] = []
  for (const l of params.lines) {
    if (!(l.qty > 0)) continue // a line nobody put a number against is not an order
    const p = byId.get(l.productId)
    if (!p) throw new AppError('ไม่พบสินค้า')
    lines.push({
      productId: p.id,
      productName: p.name,
      unit: p.unitType,
      orderedQty: l.qty,
    })
  }
  if (lines.length === 0) throw new AppError('ยังไม่ได้ระบุจำนวนสินค้าที่จะสั่ง')
  if (lines.length > MAX_LINES) {
    throw new AppError('สั่งได้สูงสุด {max} รายการต่อใบ', { max: MAX_LINES })
  }

  const db = scoped()
  return db.transaction(async (tx) => {
    const counter = await tx.get<{ value: number }>(COL.counters, 'purchaseOrder')
    const seq = (counter?.value ?? 0) + 1
    tx.set(COL.counters, 'purchaseOrder', { value: seq })
    const now = Date.now()
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
    tx.set(COL.purchaseOrders, id, {
      docNo: makeDocNo(seq),
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: 'ordered' satisfies PurchaseOrderStatus,
      locationId,
      orderedAt,
      lines,
      ...(params.eventId ? { eventId: params.eventId } : {}),
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
 * How long an order may sit as "ordered" before it is worth chasing.
 *
 * The owner's number: three days without the goods turning up.
 */
export const CHASE_AFTER_DAYS = 3

/** Orders that were sent more than three days ago and have still not arrived. */
export function overdueOrders(orders: readonly PurchaseOrder[], now = Date.now()): PurchaseOrder[] {
  const cutoff = now - CHASE_AFTER_DAYS * 86_400_000
  return orders.filter((o) => o.status === 'ordered' && o.orderedAt < cutoff)
}

/** Whole days an order has been waiting, for the screen to say how late it is. */
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
    receivedAt: now,
    receivedBy: actor.id,
    receivedByName: actor.name,
    movementDocNo: docNo,
    updatedAt: now,
  })
  return { docNo, receivedLines: arrived.length }
}

/** Cancel an order that was never placed or never turned up. Stock is never involved. */
export async function deletePurchaseOrder(id: string): Promise<void> {
  const order = await scoped().getOne<PurchaseOrder>(COL.purchaseOrders, id)
  if (order?.status === 'received') {
    throw new AppError('ลบไม่ได้: ใบสั่งซื้อนี้รับของเข้าคลังแล้ว')
  }
  await scoped().remove(COL.purchaseOrders, id)
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
