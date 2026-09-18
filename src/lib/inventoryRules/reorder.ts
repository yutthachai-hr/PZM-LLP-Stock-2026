/**
 * When to order, and how much — a suggestion, never an order.
 *
 * With a usage rate: the reorder point is what the shelf needs to last until a delivery
 * could land (rate × lead time) plus the minimum as a safety stock. At or under it —
 * counting what is already on order — the suggestion is enough to reach the lead time plus
 * `coverDays` of use, plus the safety stock, rounded up, and at least the supplier's
 * minimum order.
 *
 * Without a rate (see usage.ts): at or under the minimum, bring it to twice the minimum.
 * The screen says which basis it used; the owner can change `coverDays` in Settings.
 */

/** Used when a supplier has no lead time set. Shown as an assumption, not a fact. */
export const DEFAULT_LEAD_DAYS = 2
/** With no rate to go on, top up to this many times the minimum. */
export const MIN_STOCK_TARGET_FACTOR = 2

export interface ReorderInput {
  onHand: number
  incoming: number
  avgDaily: number | null
  min: number
  leadTimeDays?: number
  coverDays: number
  minOrderQty?: number
}

export interface Recommendation {
  recommendedQty: number
  basis: 'usage' | 'minStock'
  /** Days until it runs out at the current rate, or null without one. */
  daysLeft: number | null
  reorderPoint: number
  leadTimeDays: number
}

export function recommend(i: ReorderInput): Recommendation | null {
  const lead = i.leadTimeDays ?? DEFAULT_LEAD_DAYS
  const have = Math.max(0, i.onHand) + Math.max(0, i.incoming)
  const safety = Math.max(0, i.min)
  let qty: number
  let basis: Recommendation['basis']
  let reorderPoint: number
  if (i.avgDaily !== null && i.avgDaily > 0) {
    basis = 'usage'
    reorderPoint = i.avgDaily * lead + safety
    if (have > reorderPoint) return null
    qty = Math.ceil(i.avgDaily * (lead + Math.max(0, i.coverDays)) + safety - have)
  } else {
    // No minimum and no rate: nobody has said how much this needs.
    if (safety <= 0) return null
    basis = 'minStock'
    reorderPoint = safety
    if (have > reorderPoint) return null
    qty = Math.ceil(safety * MIN_STOCK_TARGET_FACTOR - have)
  }
  if (qty <= 0) return null
  if (i.minOrderQty && qty < i.minOrderQty) qty = Math.ceil(i.minOrderQty)
  return {
    recommendedQty: qty,
    basis,
    daysLeft: i.avgDaily && i.avgDaily > 0 ? Math.max(0, i.onHand) / i.avgDaily : null,
    reorderPoint,
    leadTimeDays: lead,
  }
}

/**
 * Gone before a delivery ordered today could land, at the current rate: the "estimated
 * stock-out" worth a warning. Nothing on hand is already "out", which is its own alert.
 */
export function stockoutSoon(onHand: number, incoming: number, avgDaily: number | null, leadTimeDays?: number): number | null {
  if (avgDaily === null || avgDaily <= 0 || onHand <= 0) return null
  const daysLeft = onHand / avgDaily
  const lead = leadTimeDays ?? DEFAULT_LEAD_DAYS
  // What is already on order will cover it; no warning.
  if (incoming > 0 && onHand + incoming > avgDaily * lead) return null
  return daysLeft <= lead + 1 ? daysLeft : null
}
