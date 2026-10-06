import type { TxContext } from '../backend/types'
import { AppError } from '../i18n/AppError'
import { COL, type PoReceipt, type Product, type PurchaseOrder, type PurchaseOrderLine, type PurchaseOrderStatus, type StockMovement } from '../types'
import { resolveFactor, toBase } from '../lib/uom'
import { roundQty } from '../lib/validate'
import { planReceive, type FileMovement, type MovementLine } from './ledgerTx'

/**
 * Checking a delivery in against its order (plan A1), as a transaction body over a given
 * `TxContext` — the app runs it over the Firestore SDK (services/purchaseOrders.ts), the
 * trusted command boundary over the service account (functions/_lib/stockCommands.ts,
 * ADR-001). One implementation, so the two can never disagree about what a receipt does.
 */

export interface ReceiptLineInput {
  productId: string
  /** What arrived on THIS delivery, in the order line's unit. Zero means none of it did. */
  receivedQty: number
  /** Ticked to say it matched what was still outstanding. */
  checked: boolean
  note?: string
}

/** What is still to come on a line: ordered, less every delivery so far. Never below zero. */
export function outstandingQty(line: Pick<PurchaseOrderLine, 'orderedQty' | 'receivedQty'>): number {
  return Math.max(0, roundQty(line.orderedQty - (line.receivedQty ?? 0)))
}

/** Whether anything on the order is still to come. */
export function hasOutstanding(order: Pick<PurchaseOrder, 'lines'>): boolean {
  return order.lines.some((l) => outstandingQty(l) > 0)
}

/**
 * The owner's receiving rules applied to one delivery, with no database: what each line
 * becomes and what arrived. Pure so it runs inside the receipt's transaction, against the
 * order as it stands at that moment rather than as a screen loaded it minutes earlier.
 *
 *   - every line still outstanding is accounted for, either ticked or given a quantity;
 *   - a line whose quantity does not match what was outstanding needs a reason against it.
 */
export function settleDelivery(
  order: Pick<PurchaseOrder, 'lines'>,
  lines: readonly ReceiptLineInput[],
): { settled: PurchaseOrderLine[]; arrived: { line: PurchaseOrderLine; qty: number; note?: string }[] } {
  const given = new Map(lines.map((l) => [l.productId, l]))
  const settled: PurchaseOrderLine[] = []
  const thisDelivery: { line: PurchaseOrderLine; qty: number; note?: string }[] = []
  for (const line of order.lines) {
    const outstanding = outstandingQty(line)
    const input = given.get(line.productId)
    // A line already complete may be left out; one still owed has to be looked at.
    if (!input) {
      if (outstanding > 0) throw new AppError('ยังตรวจไม่ครบทุกรายการ')
      settled.push(line)
      continue
    }
    const qty = input.checked ? outstanding : input.receivedQty
    if (!Number.isFinite(qty) || qty < 0) throw new AppError('จำนวนที่รับต้องไม่ติดลบ')
    const note = input.note?.trim()
    // A number that differs from what was owed is a discrepancy, and a discrepancy without a
    // reason is the thing nobody can explain a month later.
    if (qty !== outstanding && !note) {
      throw new AppError('กรุณาระบุเหตุผลของรายการที่จำนวนไม่ตรง: {name}', { name: line.productName })
    }
    settled.push({
      ...line,
      receivedQty: roundQty((line.receivedQty ?? 0) + qty),
      checked: !!input.checked,
      ...(note ? { note } : {}),
    })
    thisDelivery.push({ line, qty, ...(note ? { note } : {}) })
  }
  const arrived = thisDelivery.filter((d) => d.qty > 0)
  if (arrived.length === 0) throw new AppError('ไม่มีรายการที่รับเข้า')
  return { settled, arrived }
}

/** The id a receipt's stock rows are filed under (`<id>_0`, `_1`…) — how a repeat is recognised. */
export function receiptIdFor(orderId: string, operationId: string): string {
  return `rc_${orderId}_${operationId}`
}

export interface ReceiveOrderParams {
  orderId: string
  /** Already trimmed and checked non-empty. */
  invoiceNo: string
  lines: readonly ReceiptLineInput[]
  actor: { id: string; name: string }
  receiptId: string
  date: number
  docDate?: number
  note?: string
  photoDataUrl?: string
  closeReason?: string
}

export interface ReceiveOrderResult {
  docNo: string
  receivedLines: number
  status: PurchaseOrderStatus
  outstandingLines: number
  replayed?: boolean
}

export interface ReceiveOrderOutcome {
  result: ReceiveOrderResult
  /** The order as written, when this attempt wrote it. */
  written: PurchaseOrder | null
  /** How many receipts the order had when read — to explain a lost race afterwards. */
  seen: number
}

/** The transaction body. Every read comes before any write (Firestore's rule). */
export async function receiveOrderInTx(tx: TxContext, file: FileMovement, params: ReceiveOrderParams): Promise<ReceiveOrderOutcome> {
  const { orderId, actor, invoiceNo, receiptId, date, note } = params
  const closeReason = params.closeReason
  let written: PurchaseOrder | null = null
  let seen = 0
  // ---- reads (all before any write: Firestore's rule for transactions) ----
  const already = await tx.get<StockMovement>(COL.movements, `${receiptId}_0`)
  const order = await tx.get<PurchaseOrder>(COL.purchaseOrders, orderId)
  if (!order) throw new AppError('ไม่พบใบสั่งซื้อ')
  seen = order.receipts?.length ?? 0
  if (already) {
    // This very receipt was filed before — a retry, or the same press twice. Say what it did.
    const stillOwed = order.lines.filter((l) => outstandingQty(l) > 0).length
    const mine = order.receipts?.find((r) => r.docNo === already.docNo)
    return {
      written: null,
      seen,
      result: {
        docNo: already.docNo,
        receivedLines: mine?.lines.length ?? 0,
        status: order.status,
        outstandingLines: order.status === 'received' ? 0 : stillOwed,
        replayed: true,
      },
    }
  }
  if (order.status === 'received') throw new AppError('ใบสั่งซื้อนี้รับของแล้ว')
  if (order.status === 'cancelled') throw new AppError('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว')
  // A draft is a proposal nobody has placed; goods cannot arrive against it.
  if (order.status === 'draft') throw new AppError('ใบสั่งซื้อนี้ยังเป็นร่าง ต้องอนุมัติก่อนรับของ')

  const { settled, arrived } = settleDelivery(order, params.lines)

  // What arrived, in the product's own unit. A line ordered in another unit converts at
  // the rate it was placed at (baseQty / orderedQty); a line from before that was kept
  // takes the product's rate today, and is refused if there is none — never guessed.
  const stockLines: MovementLine[] = []
  for (const { line: l, qty, note: why } of arrived) {
    // A line's reason for differing travels with its stock row, so the history says why.
    const lineNote = why ? { note: why } : {}
    if (!l.entryUnit) {
      stockLines.push({ productId: l.productId, productName: l.productName, unit: l.unit, qty, ...lineNote })
      continue
    }
    let factor = l.baseQty !== undefined && l.orderedQty > 0 ? l.baseQty / l.orderedQty : null
    if (factor === null) {
      const p = await tx.get<Product>(COL.products, l.productId)
      factor = p ? resolveFactor(p, l.entryUnit) : null
      if (factor === null) {
        throw new AppError('ยังไม่ได้กำหนดอัตราแปลง "{unit}" ของ "{name}" — กำหนดที่หน้าสินค้าก่อน', { unit: l.entryUnit, name: l.productName })
      }
    }
    stockLines.push({ productId: l.productId, productName: l.productName, unit: l.unit, entryUnit: l.entryUnit, entryQty: qty, qty: toBase(qty, factor), ...lineNote })
  }

  const plan = await planReceive(tx, {
    toLocationId: order.locationId,
    lines: stockLines,
    actor,
    date,
    ...(note ? { note } : {}),
    doc: {
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      invoiceNo,
      docDate: params.docDate,
      poId: order.id,
      poDocNo: order.docNo,
    },
    photoDataUrl: params.photoDataUrl,
  })

  // ---- writes ----
  const docNo = plan.commit(file, (i) => `${receiptId}_${i}`)
  const receipt: PoReceipt = {
    docNo,
    receiptId,
    date,
    invoiceNo,
    byId: actor.id,
    byName: actor.name,
    lines: arrived.map((d) => ({ productId: d.line.productId, qty: d.qty, ...(d.note ? { note: d.note } : {}) })),
  }
  const stillOwed = settled.filter((l) => outstandingQty(l) > 0).length
  const done = stillOwed === 0 || !!closeReason
  const status: PurchaseOrderStatus = done ? 'received' : 'ordered'
  const now = Date.now()
  const patch: Partial<PurchaseOrder> = {
    status,
    lines: settled,
    receipts: [...(order.receipts ?? []), receipt],
    // The latest delivery, so everything that read one receipt per order still reads true.
    invoiceNo,
    // The date on the delivery note, the same one the stock receipt is filed under — not
    // the moment it was keyed. (Until 17 Sep 2026 this was Date.now().) `updatedAt` keeps
    // the keying time.
    receivedAt: date,
    receivedBy: actor.id,
    receivedByName: actor.name,
    movementDocNo: docNo,
    ...(closeReason && stillOwed > 0
      ? { closedShortReason: closeReason, closedShortBy: actor.id, closedShortByName: actor.name, closedShortAt: now }
      : {}),
    updatedAt: now,
  }
  tx.update(COL.purchaseOrders, orderId, patch as Record<string, unknown>)
  written = { ...order, ...patch } as PurchaseOrder
  return { written, seen, result: { docNo, receivedLines: arrived.length, status, outstandingLines: done ? 0 : stillOwed } }
}
