import type { MonthlyCountLine, MonthlyCountResult } from '../types'
import { bkkDayStart, DAY_MS } from './inventoryRules/time'
import { roundQty } from './validate'

/**
 * The monthly count's arithmetic (owner, 29 Sep 2026), kept pure so it is tested alone.
 *
 * A count taken on the morning of the 1st is the shelf at the end of the month before, so
 * a month's count is compared with — and filed on — that month's last day.
 */

/** 'YYYY-MM' of the Bangkok day containing `ms`. */
export function monthOf(ms: number): string {
  const d = new Date(bkkDayStart(ms) + 7 * 3_600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The business date (Bangkok day start) of the month's last day. */
export function countDayOf(month: string): number {
  const [y, m] = month.split('-').map(Number)
  // Midnight UTC of the 1st of the next month is 07:00 Bangkok on the 1st: a day back is
  // inside the last day.
  return bkkDayStart(Date.UTC(y, m, 1) - DAY_MS)
}

/** The month a count is usually for: the one just ended. */
export function previousMonth(now: number): string {
  const [y, m] = monthOf(now).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function monthlyCountId(locationId: string, month: string): string {
  return `${locationId}__${month}`
}

/** The month before, for "how did last month's count come out". */
export function monthBefore(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** A difference worth a second look: over 10% of the books, or over 500 baht either way. */
export const BIG_PCT = 0.1
export const BIG_BAHT = 500

export interface CountRow {
  productId: string
  systemQty: number
  /** Null when not counted: left as it is, never read as zero. */
  countedQty: number | null
  diff: number | null
  value: number | null
  big: boolean
  /** This product's difference in last month's confirmed count, if there was one. */
  lastDiff?: number
}

export interface CountSummary {
  total: number
  counted: number
  withDiff: number
  big: number
  shortValue: number
  overValue: number
}

export function isBig(systemQty: number, diff: number, value: number): boolean {
  if (diff === 0) return false
  if (Math.abs(value) >= BIG_BAHT) return true
  if (systemQty <= 0) return true
  return Math.abs(diff) / systemQty >= BIG_PCT
}

export function countRows(input: {
  productIds: readonly string[]
  lines: Readonly<Record<string, MonthlyCountLine>>
  systemQty: (productId: string) => number
  cost: (productId: string) => number
  last?: Readonly<Record<string, MonthlyCountResult>>
}): { rows: CountRow[]; summary: CountSummary } {
  const ids = [...new Set([...input.productIds, ...Object.keys(input.lines)])]
  const rows: CountRow[] = ids.map((productId) => {
    const systemQty = roundQty(input.systemQty(productId))
    const line = input.lines[productId]
    const lastDiff = input.last?.[productId]?.diff
    if (!line) return { productId, systemQty, countedQty: null, diff: null, value: null, big: false, lastDiff }
    const diff = roundQty(line.qty - systemQty)
    const value = Math.round(diff * input.cost(productId) * 100) / 100
    return { productId, systemQty, countedQty: line.qty, diff, value, big: isBig(systemQty, diff, value), lastDiff }
  })
  const summary: CountSummary = { total: rows.length, counted: 0, withDiff: 0, big: 0, shortValue: 0, overValue: 0 }
  for (const r of rows) {
    if (r.countedQty === null) continue
    summary.counted++
    if (r.diff) summary.withDiff++
    if (r.big) summary.big++
    if (r.value && r.value < 0) summary.shortValue += r.value
    if (r.value && r.value > 0) summary.overValue += r.value
  }
  summary.shortValue = Math.round(summary.shortValue * 100) / 100
  summary.overValue = Math.round(summary.overValue * 100) / 100
  return { rows, summary }
}

/** The snapshot kept on the sheet when it is confirmed: counted rows only. */
export function resultsOf(rows: readonly CountRow[]): Record<string, MonthlyCountResult> {
  const out: Record<string, MonthlyCountResult> = {}
  for (const r of rows) {
    if (r.countedQty === null || r.diff === null) continue
    out[r.productId] = { systemQty: r.systemQty, countedQty: r.countedQty, diff: r.diff, value: r.value ?? 0 }
  }
  return out
}

/**
 * The counted products to settle, in parts small enough for one transaction each: every
 * counted product not yet settled (plan A10 — the difference is worked out inside the
 * transaction, so a product that showed none on screen is checked too). Two writes a line
 * (balance, ledger row) against Firestore's 500 per transaction, with room for the counter
 * and the sheet.
 */
export const POST_CHUNK = 200

export function postingPlan<T extends { productId: string }>(rows: readonly T[], postedIds: readonly string[] = []): T[][] {
  const done = new Set(postedIds)
  const todo = rows.filter((r) => !done.has(r.productId))
  const parts: T[][] = []
  for (let i = 0; i < todo.length; i += POST_CHUNK) parts.push(todo.slice(i, i + POST_CHUNK))
  return parts
}
