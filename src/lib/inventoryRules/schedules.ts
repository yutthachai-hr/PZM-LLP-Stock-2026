import type { InventorySchedule, StockEvent } from '../../types'
import { bkkAtTime, bkkDayEnd, bkkDayKey, bkkDayOfMonth, bkkDayStart, bkkDaysBetween, bkkWeekday, DAY_MS } from './time'

/**
 * From a schedule to the days it falls on, and from a day to the task document.
 *
 * Pure: the app runs it to preview "next five dates" and to generate ahead in demo mode;
 * the cron Worker runs it every night. Both produce the same document under the same id
 * for the same day, which is the whole of the duplicate prevention.
 */

/** The Bangkok day-starts a schedule falls on, inside [from, to] inclusive. */
export function occurrencesBetween(s: InventorySchedule, from: number, to: number): number[] {
  if (!s.enabled) return []
  const out: number[] = []
  const anchor = bkkDayStart(s.anchorDay ?? s.createdAt)
  for (let day = bkkDayStart(from); day <= to; day += DAY_MS) {
    if (day < anchor && s.frequency !== 'monthly' && s.frequency !== 'daily' && s.frequency !== 'weekly') continue
    if (occursOn(s, day, anchor)) out.push(day)
  }
  return out
}

function occursOn(s: InventorySchedule, day: number, anchor: number): boolean {
  switch (s.frequency) {
    case 'daily':
      return true
    case 'weekly':
      return (s.daysOfWeek ?? []).includes(bkkWeekday(day))
    case 'biweekly': {
      if (!(s.daysOfWeek ?? []).includes(bkkWeekday(day))) return false
      // Weeks counted from the anchor's week (Sunday-first), every other one.
      const anchorWeekStart = anchor - bkkWeekday(anchor) * DAY_MS
      const weeks = Math.floor(bkkDaysBetween(anchorWeekStart, day) / 7)
      return weeks % 2 === 0
    }
    case 'monthly': {
      const want = s.dayOfMonth ?? 1
      const dom = bkkDayOfMonth(day)
      if (dom === want) return true
      // A month without that day (31st in June) counts on its last day instead.
      const lastOfMonth = bkkDayOfMonth(day + DAY_MS) === 1
      return lastOfMonth && want > dom
    }
    case 'custom': {
      const every = Math.max(1, s.intervalDays ?? 1)
      return bkkDaysBetween(anchor, day) % every === 0
    }
  }
}

/** The document id of the task for one day — the same string is its `refKey`. */
export function taskIdFor(scheduleId: string, dayMs: number): string {
  return `sc__${scheduleId}__${bkkDayKey(dayMs)}`
}

/** The task a schedule produces for a day, ready to write under `taskIdFor`. */
export function buildTaskDoc(
  s: InventorySchedule,
  dayMs: number,
  actor: { id: string; name: string },
  now: number,
): StockEvent {
  const id = taskIdFor(s.id, dayMs)
  const startAt = bkkAtTime(dayMs, s.startTime)
  const dueAt = s.durationMin ? startAt + s.durationMin * 60_000 : bkkDayEnd(dayMs)
  return {
    id,
    title: s.name,
    type: 'stockCount',
    locationId: s.locationId,
    startAt,
    dueAt,
    status: 'upcoming',
    priority: s.priority,
    ...(s.assignedToAll ? { assignedToAll: true } : s.assignedTo?.length ? { assignedTo: s.assignedTo } : {}),
    ...(s.assignedToName ? { assignedToName: s.assignedToName } : {}),
    ...(s.note ? { note: s.note } : {}),
    ...(s.requiresApproval ? { requiresApproval: true } : {}),
    sourceType: 'schedule',
    sourceId: s.id,
    scheduleId: s.id,
    refKey: id,
    history: [{ at: now, by: actor.id, byName: actor.name, action: 'generated', detail: s.name }],
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * The tasks that should exist for a set of schedules over a window but do not yet: the
 * generator's whole job. `existingIds` is what the caller already holds for the window.
 */
export function missingTasks(
  schedules: readonly InventorySchedule[],
  existingIds: ReadonlySet<string>,
  from: number,
  to: number,
  actor: { id: string; name: string },
  now: number,
): StockEvent[] {
  const out: StockEvent[] = []
  for (const s of schedules) {
    for (const day of occurrencesBetween(s, from, to)) {
      const id = taskIdFor(s.id, day)
      if (!existingIds.has(id)) out.push(buildTaskDoc(s, day, actor, now))
    }
  }
  return out
}

/** How far ahead tasks are generated. Two weeks: enough to plan, few enough to correct. */
export const GENERATE_AHEAD_DAYS = 14
