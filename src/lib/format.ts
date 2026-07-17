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

/** Convert an <input type="date"> value (YYYY-MM-DD) to a ms epoch at local midday (avoids TZ drift). */
export function dateInputToMs(value: string): number {
  if (!value) return Date.now()
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).getTime()
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
