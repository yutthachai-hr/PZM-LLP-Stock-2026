import type { StockMovement } from '../../types'
import { bkkDayStart, bkkDaysBetween, DAY_MS } from './time'

/**
 * How fast a product leaves a location, from the ledger.
 *
 * Usage is what goes out to be used: issued to a branch or consumed. Loss is what goes out
 * through an adjustment for a reason that means it is gone — lost, broken, expired,
 * damaged. Both are demand the shelf has to cover, so the rate counts both. A count
 * correction or a find is not demand and is left out.
 *
 * A rate from almost nothing is worse than none: one issue last Tuesday is not "a kilo a
 * day". Below two outgoing movements, or under a week of history at the location, the rate
 * is `null` and the callers fall back to the minimum stock, saying so.
 *
 * Only the product's own unit counts; a line keyed in another unit (Pack, Carton) is a
 * separate balance and is never converted (see StockMovement.entryUnit).
 */

export const LOSS_REASONS = ['lost', 'broken', 'expired', 'damage'] as const
export const MIN_MOVES = 2
export const MIN_HISTORY_DAYS = 7

export interface UsageStat {
  used: number
  lost: number
  /** Outgoing movements counted (issue, consume, loss). */
  moves: number
  /** Days of history the average is over: from the first movement here in the window to today. */
  days: number
  /** Per day, or null when there is too little history to say. */
  avgDaily: number | null
}

export type UsageIndex = Map<string, UsageStat>

const key = (locationId: string, productId: string) => `${locationId}__${productId}`

/** One pass over the ledger window, for every product and location at once. */
export function usageIndex(movements: readonly StockMovement[], now: number, windowDays: number): UsageIndex {
  const from = bkkDayStart(now) - Math.max(1, windowDays) * DAY_MS
  const acc = new Map<string, { used: number; lost: number; moves: number; first: number }>()
  const touch = (k: string, date: number) => {
    let a = acc.get(k)
    if (!a) {
      a = { used: 0, lost: 0, moves: 0, first: date }
      acc.set(k, a)
    }
    if (date < a.first) a.first = date
    return a
  }
  for (const m of movements) {
    if (m.voided || m.entryUnit || m.date < from || m.date > now) continue
    // Any movement at a location is history there, receipts included.
    if (m.toLocationId) touch(key(m.toLocationId, m.productId), m.date)
    if (!m.fromLocationId) continue
    const a = touch(key(m.fromLocationId, m.productId), m.date)
    if (m.type === 'issue' || m.type === 'consume') {
      a.used += m.qty
      a.moves++
    } else if (m.type === 'adjust' && (LOSS_REASONS as readonly string[]).includes(m.reason ?? '')) {
      a.lost += m.qty
      a.moves++
    }
  }
  const out: UsageIndex = new Map()
  for (const [k, a] of acc) {
    const days = Math.min(Math.max(1, windowDays), Math.max(1, bkkDaysBetween(bkkDayStart(a.first), bkkDayStart(now)) + 1))
    const enough = a.moves >= MIN_MOVES && days >= MIN_HISTORY_DAYS
    out.set(k, { used: a.used, lost: a.lost, moves: a.moves, days, avgDaily: enough ? (a.used + a.lost) / days : null })
  }
  return out
}

export function usageAt(index: UsageIndex, locationId: string, productId: string): UsageStat | undefined {
  return index.get(key(locationId, productId))
}
