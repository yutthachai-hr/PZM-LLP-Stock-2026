/**
 * What the popup host did, for debugging a "why didn't it beep?" (5 Oct 2026): the last
 * 200 events in memory — displayed, sound attempted and its result, opened — with ids and
 * kinds only, never the text. Read it from the console as `window.__pzmNotificationLog`.
 */

export interface NotificationLogEntry {
  at: number
  event: 'displayed' | 'sound' | 'opened'
  data: Record<string, unknown>
}

const MAX = 200
const entries: NotificationLogEntry[] = []

export function logNotification(event: NotificationLogEntry['event'], data: Record<string, unknown>): void {
  entries.push({ at: Date.now(), event, data })
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
}

export function notificationLog(): readonly NotificationLogEntry[] {
  return entries
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__pzmNotificationLog', { get: () => entries.slice(), configurable: true })
}
