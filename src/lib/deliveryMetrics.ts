import type { PoReceipt, PurchaseOrder, PurchaseOrderLine } from '../types'
import { bkkDayEnd, bkkDayStart, bkkDaysBetween } from './inventoryRules/time'

/**
 * Delivery ground truth for one purchase order (Supplier Intelligence S1, 5 Oct 2026).
 *
 * Derived, never stored: every field below is a pure function of what an order already
 * carries — its dates and revisions, the supplier's answer, and its receipts. So orders
 * from before any of this existed are measured by the same rules, nothing has to be
 * back-filled, and a correction to an order corrects its outcome.
 *
 * The rule the owner set: a supplier is on time against the date it CONFIRMED, not the date
 * we asked for — asked the 6th, supplier proposed the 8th, we accepted, delivered the 8th:
 * on time. Whether the asked date was accepted is measured separately (`requestedAccepted`).
 *
 * Days are Bangkok business days (inventoryRules/time). Delivered on the due day is on time.
 */

export const DELIVERY_METRICS_VERSION = 1

/**
 * `open` — still owed and not closed; `undated` — complete but there was never a due date,
 * so on time cannot be judged (kept out of on-time rates rather than guessed).
 */
export type DeliveryStatus = 'early' | 'on_time' | 'late' | 'partial' | 'cancelled' | 'open' | 'undated'

export interface LineOutcome {
  productId: string
  productName: string
  /** In the line's own unit (as `orderedQty`). */
  ordered: number
  received: number
  /** Received by the end of the confirmed day ÷ ordered; null without a due date. */
  dueFill: number | null
  /** The day the line was complete, if it ever was. */
  completedAt: number | null
  /** completedAt − confirmed, in days; null when incomplete or undated. */
  delayDays: number | null
}

export interface DeliveryOutcome {
  version: number
  poId: string
  docNo: string
  supplierId: string
  supplierName: string
  locationId: string
  orderedAt: number
  /** The date we asked for (see `requestedOf`). */
  requestedDeliveryDate: number | null
  /** The date agreed: the supplier's confirmation, else the order's final due date. */
  confirmedDeliveryDate: number | null
  dueKnown: boolean
  /** Confirmed equals requested — the asked date was accepted as it stood. */
  requestedAccepted: boolean | null
  actualFirstReceivedAt: number | null
  actualFullyReceivedAt: number | null
  lastReceivedAt: number | null
  deliveries: number
  supplierConfirmedAt: number | null
  supplierConfirmationStatus: PurchaseOrder['supplierConfirmationStatus'] | null
  /** Times the supplier proposed a date other than the one standing. */
  supplierDateChangeCount: number
  supplierDeliveryNote: string | null
  /** Minutes from the link being sent to the supplier's first answer. */
  supplierResponseMinutes: number | null
  /**
   * Quantities in the product's own unit, over lines whose unit can be compared (a line
   * keyed in another unit before 20 Sep 2026 carries no base equivalent and is left out).
   */
  orderedQuantity: number
  receivedQuantity: number
  /** Not recorded at receiving yet — unknown, not zero. */
  rejectedQuantity: null
  shortQuantity: number
  /** Σ min(received, ordered) ÷ Σ ordered. Null when nothing comparable was ordered. */
  fillRate: number | null
  /** Same, counting only what arrived by the end of the confirmed day. */
  dueDateFillRate: number | null
  firstDeliveryOnTime: boolean | null
  /** First delivery − confirmed, days. */
  firstDelayDays: number | null
  /** Completion (or last delivery when closed short) − confirmed, days. Negative = early. */
  delayDays: number | null
  deliveryStatus: DeliveryStatus
  /** Received in full, closed short, or cancelled: the order's story is finished. */
  completed: boolean
  lines: LineOutcome[]
}

/**
 * The date we asked for: the supplier-confirmation snapshot when there is one, else the
 * first due date the order ever had (an amendment's `from`), else its due date.
 */
export function requestedDateOf(o: PurchaseOrder): number | null {
  if (o.requestedDeliveryDate !== undefined) {
    // Purchasing may have moved the ask after the link went out; the first ask is the one
    // the supplier was originally given.
    const first = o.deliveryDateHistory?.find((h) => h.action === 'requested' && h.to !== undefined)
    return bkkDayStart(first?.to ?? o.requestedDeliveryDate)
  }
  const amended = [...(o.revisions ?? [])]
    .sort((a, b) => a.rev - b.rev)
    .flatMap((r) => r.changes)
    .find((c) => c.kind === 'expectedAt')
  if (amended && amended.kind === 'expectedAt' && amended.from !== undefined) return bkkDayStart(amended.from)
  return o.expectedAt !== undefined ? bkkDayStart(o.expectedAt) : null
}

/** The date the supplier is held to. A date still waiting for approval is not agreed yet. */
export function confirmedDateOf(o: PurchaseOrder): number | null {
  const d = o.confirmedDeliveryDate ?? o.expectedAt
  return d !== undefined ? bkkDayStart(d) : null
}

/** The order's deliveries, oldest first, one per receipt document. */
export function receiptsOf(o: PurchaseOrder): PoReceipt[] {
  if (o.receipts?.length) {
    const seen = new Set<string>()
    return [...o.receipts]
      .filter((r) => (seen.has(r.docNo) ? false : (seen.add(r.docNo), true)))
      .sort((a, b) => a.date - b.date)
  }
  // Received in one go before receipts were kept (24 Sep 2026): one delivery from the
  // fields that described it then.
  if (o.status === 'received' && o.receivedAt !== undefined) {
    return [
      {
        docNo: o.movementDocNo ?? 'legacy',
        date: o.receivedAt,
        invoiceNo: o.invoiceNo ?? '',
        byId: o.receivedBy ?? '',
        byName: o.receivedByName ?? '',
        lines: o.lines.map((l) => ({ productId: l.productId, qty: l.receivedQty ?? l.orderedQty })),
      },
    ]
  }
  return []
}

/** Multiplier from a line's own unit to the product's; null when it cannot be known. */
function baseFactor(l: PurchaseOrderLine): number | null {
  if (!l.entryUnit) return 1
  if (l.baseQty !== undefined && l.orderedQty > 0) return l.baseQty / l.orderedQty
  return null
}

function firstAnswerAt(o: PurchaseOrder): number | null {
  const a = (o.supplierActivity ?? []).find((x) => x.kind === 'accepted' || x.kind === 'autoApplied' || x.kind === 'pendingApproval')
  return a?.at ?? o.supplierConfirmedAt ?? null
}

function linkSentAt(o: PurchaseOrder): number | null {
  const a = (o.supplierActivity ?? []).find((x) => x.kind === 'linkIssued')
  return a?.at ?? o.supplierLink?.issuedAt ?? null
}

export function deliveryOutcome(o: PurchaseOrder): DeliveryOutcome {
  const requested = requestedDateOf(o)
  const confirmed = confirmedDateOf(o)
  const dueKnown = confirmed !== null
  const receipts = o.status === 'cancelled' ? [] : receiptsOf(o)

  // Walk the deliveries in order, keeping per-line running totals.
  const lineIdx = new Map(o.lines.map((l, i) => [l.productId, i]))
  const running = o.lines.map(() => 0)
  const byDue = o.lines.map(() => 0)
  const completedAt: (number | null)[] = o.lines.map((l) => (l.orderedQty <= 0 ? (receipts[0]?.date ?? null) : null))
  let fullAt: number | null = null
  for (const r of receipts) {
    for (const rl of r.lines) {
      const i = lineIdx.get(rl.productId)
      if (i === undefined) continue
      running[i] += rl.qty
      if (confirmed !== null && r.date <= bkkDayEnd(confirmed)) byDue[i] += rl.qty
      if (completedAt[i] === null && running[i] >= o.lines[i].orderedQty) completedAt[i] = r.date
    }
    if (fullAt === null && completedAt.every((c) => c !== null)) fullAt = r.date
  }

  // The order's own cumulative figure wins where it exists: it is what the books hold.
  const received = o.lines.map((l, i) => l.receivedQty ?? running[i])

  let orderedQ = 0
  let receivedQ = 0
  let filled = 0
  let filledByDue = 0
  o.lines.forEach((l, i) => {
    const f = baseFactor(l)
    if (f === null) return
    orderedQ += l.orderedQty * f
    receivedQ += received[i] * f
    filled += Math.min(received[i], l.orderedQty) * f
    filledByDue += Math.min(byDue[i], l.orderedQty) * f
  })

  const first = receipts[0]?.date ?? null
  const last = receipts.length ? receipts[receipts.length - 1].date : null
  // Received but not in full: closed short (since 24 Sep), or an older single receipt that
  // came in under the order and closed it — either way the shortfall is final.
  const closedShort = o.status === 'received' && fullAt === null
  const days = (d: number | null) => (d === null || confirmed === null ? null : bkkDaysBetween(confirmed, d))
  const completion = fullAt ?? (closedShort ? last : null)

  let status: DeliveryStatus
  if (o.status === 'cancelled') status = 'cancelled'
  else if (closedShort) status = 'partial'
  else if (fullAt === null) status = 'open'
  else if (!dueKnown) status = 'undated'
  else {
    const d = days(fullAt) as number
    status = d < 0 ? 'early' : d === 0 ? 'on_time' : 'late'
  }

  const sent = linkSentAt(o)
  const answered = firstAnswerAt(o)

  return {
    version: DELIVERY_METRICS_VERSION,
    poId: o.id,
    docNo: o.docNo,
    supplierId: o.supplierId,
    supplierName: o.supplierName,
    locationId: o.locationId,
    orderedAt: o.orderedAt,
    requestedDeliveryDate: requested,
    confirmedDeliveryDate: confirmed,
    dueKnown,
    requestedAccepted: requested !== null && confirmed !== null ? requested === confirmed : null,
    actualFirstReceivedAt: first,
    actualFullyReceivedAt: fullAt,
    lastReceivedAt: last,
    deliveries: receipts.length,
    supplierConfirmedAt: o.supplierConfirmedAt ?? null,
    supplierConfirmationStatus: o.supplierConfirmationStatus ?? null,
    supplierDateChangeCount: (o.deliveryDateHistory ?? []).filter(
      (h) => h.source === 'supplier' && (h.action === 'autoApplied' || h.action === 'proposed'),
    ).length,
    supplierDeliveryNote: o.supplierDeliveryNote ?? null,
    supplierResponseMinutes: sent !== null && answered !== null && answered >= sent ? Math.round((answered - sent) / 60_000) : null,
    orderedQuantity: orderedQ,
    receivedQuantity: receivedQ,
    rejectedQuantity: null,
    shortQuantity: Math.max(0, orderedQ - filled),
    fillRate: orderedQ > 0 ? filled / orderedQ : null,
    dueDateFillRate: orderedQ > 0 && dueKnown ? filledByDue / orderedQ : null,
    firstDeliveryOnTime: first === null || !dueKnown ? null : (days(first) as number) <= 0,
    firstDelayDays: days(first),
    delayDays: days(completion),
    deliveryStatus: status,
    completed: status !== 'open',
    lines: o.lines.map((l, i) => ({
      productId: l.productId,
      productName: l.productName,
      ordered: l.orderedQty,
      received: received[i],
      dueFill: dueKnown && l.orderedQty > 0 ? Math.min(1, byDue[i] / l.orderedQty) : null,
      completedAt: completedAt[i],
      delayDays: days(completedAt[i]),
    })),
  }
}

/** Outcomes for the orders that count: placed (not drafts). */
export function deliveryOutcomes(orders: readonly PurchaseOrder[]): DeliveryOutcome[] {
  return orders.filter((o) => o.status !== 'draft').map(deliveryOutcome)
}
