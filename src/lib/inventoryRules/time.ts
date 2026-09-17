/**
 * Days as the business counts them: Bangkok, fixed UTC+7, no daylight saving.
 *
 * Every timestamp in the database is epoch ms. The screens format them in the browser's
 * zone, which on the company's devices is Bangkok; the cron Worker has no browser and no
 * zone, so it needs the arithmetic spelled out. Both use these so "today" means the same
 * day on a tablet in the kitchen and in a job running on a machine in another continent.
 *
 * No Intl, no dayjs: this file is also bundled into the Worker.
 */

export const DAY_MS = 86_400_000
export const BKK_OFFSET_MS = 7 * 3_600_000

/** Start of the Bangkok day containing `ms`, as epoch ms. */
export function bkkDayStart(ms: number): number {
  return Math.floor((ms + BKK_OFFSET_MS) / DAY_MS) * DAY_MS - BKK_OFFSET_MS
}

/** Last millisecond of the Bangkok day containing `ms`. */
export function bkkDayEnd(ms: number): number {
  return bkkDayStart(ms) + DAY_MS - 1
}

/** `YYYYMMDD` of the Bangkok day — the piece of a deterministic document id. */
export function bkkDayKey(ms: number): string {
  const d = new Date(bkkDayStart(ms) + BKK_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/** Epoch ms of the start of the day a `YYYYMMDD` key names. */
export function bkkDayFromKey(key: string): number {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(4, 6))
  const d = Number(key.slice(6, 8))
  return Date.UTC(y, m - 1, d) - BKK_OFFSET_MS
}

/** 0 = Sunday … 6 = Saturday, Bangkok. */
export function bkkWeekday(ms: number): number {
  return new Date(bkkDayStart(ms) + BKK_OFFSET_MS).getUTCDay()
}

/** Day of month, Bangkok. */
export function bkkDayOfMonth(ms: number): number {
  return new Date(bkkDayStart(ms) + BKK_OFFSET_MS).getUTCDate()
}

/** `HH:mm` of a Bangkok instant. */
export function bkkTimeOf(ms: number): string {
  const d = new Date(ms + BKK_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** The instant `HH:mm` on the Bangkok day containing `dayMs`. Bad input = start of day. */
export function bkkAtTime(dayMs: number, hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m) return bkkDayStart(dayMs)
  return bkkDayStart(dayMs) + Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000
}

/** Whole Bangkok days from `a` to `b` (negative when b is earlier). */
export function bkkDaysBetween(a: number, b: number): number {
  return Math.round((bkkDayStart(b) - bkkDayStart(a)) / DAY_MS)
}

export function isSameBkkDay(a: number, b: number): boolean {
  return bkkDayStart(a) === bkkDayStart(b)
}
