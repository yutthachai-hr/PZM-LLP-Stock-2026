import type { StockMovement } from '../../types'
import { effectAt, effectOverall } from '../ledger'
import { bkkDayStart, DAY_MS } from '../inventoryRules/time'
import { isLegacyUnitRow } from '../uom'
import { roundQty } from '../validate'

/**
 * A product's balance at the end of each of the last `days` business days — the Stock
 * Card's trend line (spec §2.7).
 *
 * Worked backwards from the balance now rather than forwards from zero: the ledger that is
 * loaded may not reach back to the product's first receipt, and the balance now is the
 * one number known to be right. Each day's closing is the next day's closing with that
 * next day's movements taken back off.
 *
 * Legacy rows filed on their own `#Unit` balance (the 13–20 Sep rule) are left out, the
 * same way the balance now leaves them out. Pure; tests in tests/balance-series.test.ts.
 */
export interface BalancePoint {
  /** Start of the Bangkok day, ms. */
  day: number
  /** On hand at the end of that day. */
  balance: number
}

export function balanceSeries(
  movements: readonly StockMovement[],
  opts: { productId: string; current: number; today: number; days: number; locationId?: string },
): BalancePoint[] {
  const end = bkkDayStart(opts.today)
  const byDay = new Map<number, number>()
  for (const m of movements) {
    if (m.voided || m.productId !== opts.productId || isLegacyUnitRow(m)) continue
    const d = bkkDayStart(m.date)
    if (d > end) continue
    const e = opts.locationId ? effectAt(m, opts.locationId) : effectOverall(m)
    if (e !== 0) byDay.set(d, (byDay.get(d) ?? 0) + e)
  }
  // Anything dated after today (a row keyed for tomorrow) is already in the balance now,
  // so it has to come off before today's close is known.
  let future = 0
  for (const m of movements) {
    if (m.voided || m.productId !== opts.productId || isLegacyUnitRow(m)) continue
    if (bkkDayStart(m.date) > end) future += opts.locationId ? effectAt(m, opts.locationId) : effectOverall(m)
  }
  const points: BalancePoint[] = []
  let closing = roundQty(opts.current - future)
  for (let i = 0; i < opts.days; i++) {
    const day = end - i * DAY_MS
    points.push({ day, balance: closing })
    closing = roundQty(closing - (byDay.get(day) ?? 0))
  }
  return points.reverse()
}
