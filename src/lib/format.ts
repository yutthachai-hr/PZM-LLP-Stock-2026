import dayjs from 'dayjs'

// ---- Dates (Thai / Buddhist Era) ----
// Business users read dates as Buddhist year (Gregorian + 543). e.g. 2026-07-15 => 15/07/2569.

export function toBE(year: number): number {
  return year + 543
}

/** "15/07/2569" */
export function formatThaiDate(ms: number): string {
  const d = dayjs(ms)
  const dd = String(d.date()).padStart(2, '0')
  const mm = String(d.month() + 1).padStart(2, '0')
  return `${dd}/${mm}/${toBE(d.year())}`
}

/** "15/07/69" (2-digit BE year) */
export function formatThaiDateShort(ms: number): string {
  const d = dayjs(ms)
  const dd = String(d.date()).padStart(2, '0')
  const mm = String(d.month() + 1).padStart(2, '0')
  const yy = String(toBE(d.year())).slice(-2)
  return `${dd}/${mm}/${yy}`
}

/** "15/07/2569 14:30" */
export function formatThaiDateTime(ms: number): string {
  return `${formatThaiDate(ms)} ${dayjs(ms).format('HH:mm')}`
}

/**
 * Convert an <input type="date"> value (YYYY-MM-DD) to the START of that day, locally.
 *
 * This used to return midday, and the filters compared against it directly. Picking the 8th
 * to the 8th therefore ran from noon on the 8th to noon on the 9th: a stock count taken on
 * the morning of the 8th fell outside the day it happened, and movements from lunchtime on
 * the 9th were counted as the 8th. Days now start when they start.
 */
export function dateInputToMs(value: string): number {
  if (!value) return startOfDay(Date.now())
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/** Start of the day containing `ms`, in the browser's timezone. */
export function startOfDayMs(ms: number): number {
  return startOfDay(ms)
}

/**
 * A half-open range [from, to) covering whole local days.
 *
 * Half-open on purpose: `to` is the start of the day AFTER the one chosen, so every instant
 * of the last day is inside and nothing from the next day is. Comparing `<= endOfDay` would
 * work too, but only if every caller remembers to; an exclusive bound cannot be got wrong
 * by one millisecond.
 */
export function dayRange(fromValue: string, toValue: string): { from: number; to: number } {
  return {
    from: fromValue ? dateInputToMs(fromValue) : -Infinity,
    to: toValue ? dateInputToMs(toValue) + 86_400_000 : Infinity,
  }
}

/** ms epoch -> "YYYY-MM-DD" for <input type="date"> */
export function msToDateInput(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DD')
}

export function startOfDay(ms: number): number {
  return dayjs(ms).startOf('day').valueOf()
}
export function endOfDay(ms: number): number {
  return dayjs(ms).endOf('day').valueOf()
}
export function todayMs(): number {
  return dayjs().startOf('day').valueOf()
}

// ---- Numbers ----
export function fmtQty(n: number): string {
  // up to 3 decimals, no trailing zeros, thousands separators
  const rounded = Math.round(n * 1000) / 1000
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
