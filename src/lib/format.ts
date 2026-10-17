import { BKK_OFFSET_MS, DAY_MS, bkkDayEnd, bkkDayStart, bkkTimeOf } from './inventoryRules/time'

// ---- Dates (Thai / Buddhist Era) ----
// Business users read dates as Buddhist year (Gregorian + 543). e.g. 2026-07-15 => 15/07/2569.
// With the interface in English the year is Gregorian: the owner's rule is that choosing EN
// changes everything, and a foreign reader has no use for 2569.
//
// All date-input and display functions use Asia/Bangkok (UTC+7, no DST), not browser local time.

export function toBE(year: number): number {
  return year + 543
}

let displayLang: 'th' | 'en' = 'th'

/** Called by the language switch, so every date on every screen follows it. */
export function setDateLanguage(lang: 'th' | 'en'): void {
  displayLang = lang
}

function shownYear(year: number): number {
  return displayLang === 'en' ? year : toBE(year)
}

/** "15/07/2569" — or "15/07/2026" in English (Asia/Bangkok) */
export function formatThaiDate(ms: number): string {
  const d = new Date(ms + BKK_OFFSET_MS)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${shownYear(d.getUTCFullYear())}`
}

/** "15/07/69" (2-digit year, Asia/Bangkok) */
export function formatThaiDateShort(ms: number): string {
  const d = new Date(ms + BKK_OFFSET_MS)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(shownYear(d.getUTCFullYear())).slice(-2)
  return `${dd}/${mm}/${yy}`
}

/** "15/07/2569 14:30" (Asia/Bangkok) */
export function formatThaiDateTime(ms: number): string {
  return `${formatThaiDate(ms)} ${bkkTimeOf(ms)}`
}

/**
 * Convert an <input type="date"> value (YYYY-MM-DD) to the START of that day in Asia/Bangkok.
 *
 * Days now start when they start in Bangkok. Invalid dates fail closed (NaN).
 */
export function dateInputToMs(value: string): number {
  if (!value) return bkkDayStart(Date.now())
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return NaN
  const y = Number(m[1])
  const mon = Number(m[2])
  const d = Number(m[3])
  const ms = Date.UTC(y, mon - 1, d) - BKK_OFFSET_MS
  const chk = new Date(ms + BKK_OFFSET_MS)
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mon - 1 || chk.getUTCDate() !== d) {
    return NaN
  }
  return ms
}

/** Start of the day containing `ms`, in Asia/Bangkok. */
export function startOfDayMs(ms: number): number {
  return bkkDayStart(ms)
}

/**
 * A half-open range [from, to) covering whole Bangkok days.
 *
 * Half-open on purpose: `to` is the start of the day AFTER the one chosen, so every instant
 * of the last day is inside and nothing from the next day is.
 * Invalid dates and reversed ranges fail closed ({ from: NaN, to: NaN, valid: false }).
 */
export function dayRange(fromValue: string, toValue: string): { from: number; to: number; valid?: boolean } {
  const from = fromValue ? dateInputToMs(fromValue) : -Infinity
  const to = toValue ? dateInputToMs(toValue) + DAY_MS : Infinity
  const valid = !Number.isNaN(from) && !Number.isNaN(to) && from < to
  if (!valid) {
    return { from: NaN, to: NaN, valid: false }
  }
  return { from, to, valid: true }
}

/** ms epoch -> "YYYY-MM-DD" for <input type="date"> in Asia/Bangkok */
export function msToDateInput(ms: number): string {
  const d = new Date(ms + BKK_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

export function startOfDay(ms: number): number {
  return bkkDayStart(ms)
}
export function endOfDay(ms: number): number {
  return bkkDayEnd(ms)
}
export function todayMs(): number {
  return bkkDayStart(Date.now())
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

/**
 * A date the way a reader of that language expects it: Thai readers get the Buddhist
 * year, English readers the Gregorian one. For sheets that leave the company. (Asia/Bangkok)
 */
export function formatDateFor(ms: number, lang: 'th' | 'en'): string {
  const d = new Date(ms + BKK_OFFSET_MS)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = lang === 'th' ? toBE(d.getUTCFullYear()) : d.getUTCFullYear()
  return `${dd}/${mm}/${year}`
}
