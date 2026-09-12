import type { MovementType, StockMovement } from '../types'
import { roundQty } from './validate'

// ---------------------------------------------------------------------------
// Reading the ledger.
//
// The Stock Card and the movement report both answer "how much was here, and when did it
// change". They used to answer it from the rows they were about to display: filter to a
// date range, start a total at zero, add the visible rows up. So a warehouse holding 10
// since last month, with one issue of 3 inside the chosen week, reported a balance of -3.
// Nothing looked broken — it looked like the stock was wrong.
//
// The fix is the separation these functions exist to enforce: the rows on screen are one
// question, and the balance each row leaves behind is another. The balance is always
// computed from EVERY movement up to that point, whatever the filters are showing.
// ---------------------------------------------------------------------------

/** How much a movement adds to (or takes from) one location. */
export function effectAt(m: StockMovement, locationId: string): number {
  if (m.toLocationId === locationId) return m.qty
  if (m.fromLocationId === locationId) return -m.qty
  return 0
}

/**
 * Signed quantity when no location is chosen, so the whole brand is in view.
 *
 * A transfer between two of your own locations moves nothing overall, so it is not counted;
 * a receipt is in, everything else that leaves is out.
 */
export function effectOverall(m: StockMovement): number {
  if (m.fromLocationId && m.toLocationId) return 0 // an internal transfer nets to nothing
  if (m.toLocationId) return m.qty
  return -m.qty
}

function effect(m: StockMovement, locationId?: string): number {
  return locationId ? effectAt(m, locationId) : effectOverall(m)
}

export interface LedgerScope {
  productId?: string
  locationId?: string
}

function inScope(m: StockMovement, scope: LedgerScope): boolean {
  if (m.voided) return false
  if (scope.productId && m.productId !== scope.productId) return false
  if (scope.locationId && m.fromLocationId !== scope.locationId && m.toLocationId !== scope.locationId) {
    return false
  }
  return true
}

function chronological(a: StockMovement, b: StockMovement): number {
  return a.date - b.date || a.createdAt - b.createdAt
}

/**
 * What was on hand immediately before `before`.
 *
 * This is the number a period has to start from. Passing every movement — including ones
 * outside the chosen dates and outside any type filter — is the whole point.
 */
export function openingBalance(
  all: StockMovement[],
  scope: LedgerScope & { before?: number },
): number {
  const before = scope.before
  let sum = 0
  for (const m of all) {
    if (!inScope(m, scope)) continue
    if (before !== undefined && m.date >= before) continue
    sum += effect(m, scope.locationId)
  }
  return roundQty(sum)
}

export interface StockCardRow {
  movement: StockMovement
  /** quantity into this location (0 if this row takes stock out) */
  inQty: number
  /** quantity out of this location */
  outQty: number
  /**
   * On-hand balance after this movement.
   *
   * Null when no single location is chosen and the totals would mix warehouses, which is
   * the only case where a running balance is not a real number about a real shelf.
   */
  balance: number | null
}

export interface StockCard {
  /** balance carried in from before the chosen period */
  opening: number
  rows: StockCardRow[]
  totalIn: number
  totalOut: number
  /** balance after the last row shown */
  closing: number
}

export interface StockCardQuery extends LedgerScope {
  /** inclusive start, ms */
  from?: number
  /** exclusive end, ms */
  to?: number
  /** show only this kind of movement — affects the rows, never the balances */
  type?: MovementType | ''
}

/**
 * Rows to display, each carrying the balance the warehouse was actually left at.
 *
 * Every movement in scope is walked in order and contributes to the running total. Only
 * the date range and the type filter decide what comes back, so changing the type filter
 * cannot change the balance shown against a row that was already there.
 */
export function stockCard(all: StockMovement[], q: StockCardQuery): StockCard {
  const ordered = all.filter((m) => inScope(m, q)).sort(chronological)
  const from = q.from ?? -Infinity
  const to = q.to ?? Infinity

  let running = 0
  let opening = 0
  let seenStart = false
  let totalIn = 0
  let totalOut = 0
  const rows: StockCardRow[] = []

  for (const m of ordered) {
    const delta = effect(m, q.locationId)
    if (m.date < from) {
      running = roundQty(running + delta)
      continue
    }
    if (!seenStart) {
      opening = running
      seenStart = true
    }
    if (m.date >= to) break
    running = roundQty(running + delta)
    if (q.type && m.type !== q.type) continue

    const inQty = delta > 0 ? delta : 0
    const outQty = delta < 0 ? -delta : 0
    totalIn = roundQty(totalIn + inQty)
    totalOut = roundQty(totalOut + outQty)
    rows.push({
      movement: m,
      inQty,
      outQty,
      balance: q.locationId ? running : null,
    })
  }
  if (!seenStart) opening = running

  return {
    opening,
    rows,
    totalIn,
    totalOut,
    closing: rows.length > 0 ? running : opening,
  }
}

/**
 * The unit a row is shown and reported in: what the person keyed, not what the product is
 * measured in.
 *
 * One place, because the stock card, the on-screen report, the spreadsheet and the PDF all
 * have to say the same thing — this went wrong once already, when every one of them printed
 * the product's unit over the top of whatever had actually been selected.
 */
export function shownUnit(m: { unit: string; entryUnit?: string }): string {
  return (m.entryUnit ?? '').trim() || m.unit
}

/**
 * Everyone who has changed a row since it was filed, oldest first.
 *
 * The owner asked for this by name: if more than one account has touched a movement, the
 * report has to name all of them, because a single "last edited by" is exactly what someone
 * altering a colleague's entry would hide behind.
 */
export function editorsOf(m: { edits?: { byName: string }[]; updatedByName?: string }): string[] {
  if (m.edits?.length) {
    // The same person correcting a row twice is one name, in the order they first appear.
    return [...new Set(m.edits.map((e) => e.byName).filter(Boolean))]
  }
  // Rows edited before the history existed still know who touched them last.
  return m.updatedByName ? [m.updatedByName] : []
}
