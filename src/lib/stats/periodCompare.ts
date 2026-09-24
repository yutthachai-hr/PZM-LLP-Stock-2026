import type { StockMovement } from '../../types'
import { bkkDayStart, DAY_MS } from '../inventoryRules/time'

/**
 * "Compared with the period before" for the figures on the dashboard (spec §2.1).
 *
 * Everything here is computed from the ledger window already in memory — no extra read.
 * That window only reaches back so far (DataContext's `movementsFrom`), so every function
 * that looks back takes it and answers `null` when the period it needs starts before the
 * window does. A tile shows no comparison rather than one computed from half the data:
 * "+400% from last month" off a ledger that only holds the last ten days would be a lie
 * that looks exactly like the truth.
 *
 * Pure; the tests are tests/period-compare.test.ts.
 */

/** A row filed under the pre-20 Sep unit rule sits on its own `#Unit` balance, not in the product's unit. */
function isLegacyUnit(m: StockMovement): boolean {
  return m.entryUnit !== undefined && m.entryQty === undefined
}

/**
 * What a movement did to the stock held across `scope` (all sites when omitted), in the
 * product's own unit: + in, − out, 0 for a transfer between two sites both in scope.
 */
export function netEffect(m: StockMovement, scope?: ReadonlySet<string>): number {
  if (m.voided || isLegacyUnit(m)) return 0
  const inScope = (id?: string) => !!id && (!scope || scope.has(id))
  return (inScope(m.toLocationId) ? m.qty : 0) - (inScope(m.fromLocationId) ? m.qty : 0)
}

/** A transfer is an issue that lands somewhere; an issue with no destination is stock used. */
export function isTransfer(m: StockMovement): boolean {
  if (m.transferId) {
    return m.type === 'issue' && m.fromLocationId === 'transit'
  }
  return m.type === 'issue' && !!m.fromLocationId && !!m.toLocationId
}

export type ActivityKind = 'in' | 'out' | 'transfer' | 'adjust'

/** Which bar of the weekly chart a movement belongs to. */
export function activityKind(m: StockMovement): ActivityKind {
  if (m.type === 'receive') return 'in'
  if (m.type === 'adjust') return 'adjust'
  if (isTransfer(m)) return 'transfer'
  return 'out'
}

/** Distinct documents (a receipt of twelve lines is one receipt) matching `pred` on one business day. */
export function docsOnDay(movements: StockMovement[], day: number, pred: (m: StockMovement) => boolean): number {
  const start = bkkDayStart(day)
  const docs = new Set<string>()
  for (const m of movements) {
    if (m.voided || !pred(m)) continue
    if (bkkDayStart(m.date) === start) docs.add(m.docNo)
  }
  return docs.size
}

/** Lines per business day for the last `days` days ending on `today`, one count per kind. */
export function dailyActivity(
  movements: StockMovement[],
  today: number,
  days = 7,
): { day: number; in: number; out: number; transfer: number; adjust: number }[] {
  const end = bkkDayStart(today)
  const rows = Array.from({ length: days }, (_, i) => ({ day: end - (days - 1 - i) * DAY_MS, in: 0, out: 0, transfer: 0, adjust: 0 }))
  const byDay = new Map(rows.map((r) => [r.day, r]))
  for (const m of movements) {
    if (m.voided) continue
    const r = byDay.get(bkkDayStart(m.date))
    if (r) r[activityKind(m)]++
  }
  return rows
}

/** Whether the ledger window (starting at `windowFrom`) holds everything since `since`. */
export function covers(windowFrom: number, since: number): boolean {
  return windowFrom <= bkkDayStart(since)
}

/**
 * Stock value at the start of the day `since` falls in: today's value with every movement
 * dated on or after it undone, each at the product's current cost. `null` when the ledger
 * window does not reach back that far.
 */
export function valueAsOf(
  currentValue: number,
  movements: StockMovement[],
  since: number,
  windowFrom: number,
  costOf: (productId: string) => number,
  scope?: ReadonlySet<string>,
): number | null {
  if (!covers(windowFrom, since)) return null
  const start = bkkDayStart(since)
  let delta = 0
  for (const m of movements) {
    if (m.date < start) continue
    delta += netEffect(m, scope) * costOf(m.productId)
  }
  return currentValue - delta
}

export interface Change {
  /** "+12%", "−3.5%", or "+2" when the earlier figure was zero and a percentage means nothing. */
  text: string
  up: boolean
  /** Nothing changed: the tile says so rather than drawing an arrow. */
  flat: boolean
}

/** The change from `before` to `now`, as the tile's comparison line shows it. */
export function change(now: number, before: number, opts: { unit?: string } = {}): Change {
  const diff = now - before
  const up = diff >= 0
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : ''
  if (before === 0) {
    const n = Math.abs(diff)
    return { text: `${sign}${formatNumber(n)}${opts.unit ? ` ${opts.unit}` : ''}`, up, flat: diff === 0 }
  }
  const pct = Math.abs((diff / Math.abs(before)) * 100)
  const shown = pct >= 10 ? Math.round(pct).toString() : (Math.round(pct * 10) / 10).toString()
  return { text: `${sign}${shown}%`, up, flat: diff === 0 }
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US')
}
