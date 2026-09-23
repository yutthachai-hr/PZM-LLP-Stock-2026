/**
 * The start of the window `days` back, counted from midnight rather than from now.
 *
 * Firestore can only pick a listener up where it left off when the query is the same one,
 * and a boundary of "now minus seven days" is a different query every single time the page
 * loads — so every load re-read the window in full. Anchored to midnight, every device
 * asks the same question all day, and the second open of the day can be served with just
 * what changed since the first.
 */
export function windowStart(days: number, now = Date.now()): number {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return midnight.getTime() - days * 24 * 60 * 60 * 1000
}
