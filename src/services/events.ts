import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import { requireEpochMs } from '../lib/validate'
import {
  COL,
  type StockEvent,
  type StockEventPriority,
  type StockEventStatus,
  type StockEventType,
} from '../types'

/**
 * The inventory calendar's data access.
 *
 * ## Why nothing here is live
 *
 * A subscription is billed again every time the app cold-starts, and because the shared
 * tablets sign out after 20 minutes and clear their offline copy, nearly every session is
 * a cold start. This app has 50,000 document reads a day for both companies together.
 *
 * A calendar is looked at deliberately and briefly. So it reads one date range at a time,
 * once, and costs nothing while the screen is closed. Nothing here belongs in DataContext.
 *
 * ## Why the range is on one field
 *
 * `startAt >= from && startAt <= to` is two bounds on a single field, which Firestore's
 * automatic index already serves. Adding `status` or `type` to the query would need a
 * composite index — per physical collection, so two of them, since brands are separate
 * collections — and a deploy. The screen filters those in memory instead, over documents
 * it has already paid for.
 */

export interface EventInput {
  title: string
  type: StockEventType
  locationId?: string
  startAt: number
  dueAt?: number
  priority: StockEventPriority
  assignedTo?: string
  assignedToName?: string
  note?: string
}

/** Midnight-to-midnight bounds for a day, in the browser's own timezone. */
export function dayBounds(ms: number): { from: number; to: number } {
  const d = new Date(ms)
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return { from, to: from + 86_400_000 - 1 }
}

/**
 * The grid a month view actually shows — the 1st back to the preceding Sunday, and the
 * last day forward to the following Saturday.
 *
 * Querying the calendar month alone would leave the leading and trailing cells empty even
 * though they are on screen, which reads as "nothing scheduled" rather than "not loaded".
 */
export function monthGridBounds(year: number, month: number): { from: number; to: number } {
  const first = new Date(year, month, 1)
  const from = new Date(year, month, 1 - first.getDay()).getTime()
  const last = new Date(year, month + 1, 0)
  const to = new Date(year, month + 1, 0 + (6 - last.getDay())).getTime() + 86_400_000 - 1
  return { from, to }
}

/** Sunday-to-Saturday bounds for the week containing `ms`. */
export function weekBounds(ms: number): { from: number; to: number } {
  const d = new Date(ms)
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime()
  return { from, to: from + 7 * 86_400_000 - 1 }
}

/**
 * Events whose start falls in [from, to].
 *
 * One query, however many events are in the window — typically tens. The caller caches by
 * range so paging back to a month already seen costs nothing.
 */
export async function listEventsInRange(from: number, to: number): Promise<StockEvent[]> {
  requireEpochMs(from)
  requireEpochMs(to)
  if (to < from) throw new AppError('ช่วงวันที่ไม่ถูกต้อง')
  const rows = await backend.getRange<StockEvent>(COL.events, 'startAt', from, to)
  return rows.sort((a, b) => a.startAt - b.startAt || a.title.localeCompare(b.title))
}

function validate(input: EventInput): void {
  if (!input.title.trim()) throw new AppError('กรุณากรอกชื่องาน')
  requireEpochMs(input.startAt)
  if (input.dueAt !== undefined) {
    requireEpochMs(input.dueAt)
    // A deadline before the start is almost always a mis-set date, and it makes "overdue"
    // true the moment the event is created.
    if (input.dueAt < input.startAt) throw new AppError('กำหนดเสร็จต้องไม่อยู่ก่อนวันเริ่ม')
  }
}

/** Optional strings are omitted rather than written empty — the rules reject unknown shapes. */
function optional(input: EventInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.locationId) out.locationId = input.locationId
  if (input.dueAt !== undefined) out.dueAt = input.dueAt
  if (input.assignedTo) out.assignedTo = input.assignedTo
  if (input.assignedToName) out.assignedToName = input.assignedToName
  if (input.note?.trim()) out.note = input.note.trim()
  return out
}

export async function createEvent(input: EventInput, createdBy: string): Promise<string> {
  validate(input)
  const now = Date.now()
  return backend.add(COL.events, {
    title: input.title.trim(),
    type: input.type,
    startAt: input.startAt,
    status: 'upcoming' satisfies StockEventStatus,
    priority: input.priority,
    ...optional(input),
    createdBy,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateEvent(id: string, input: EventInput): Promise<void> {
  validate(input)
  // Clearing an optional field has to remove it, not blank it: the validators use hasOnly
  // and an empty string is still a present key.
  const { DELETE_FIELD } = await import('../backend/types')
  const opt = optional(input)
  const patch: Record<string, unknown> = {
    title: input.title.trim(),
    type: input.type,
    startAt: input.startAt,
    priority: input.priority,
    updatedAt: Date.now(),
    ...opt,
  }
  for (const key of ['locationId', 'dueAt', 'assignedTo', 'assignedToName', 'note']) {
    if (!(key in opt)) patch[key] = DELETE_FIELD
  }
  await backend.update(COL.events, id, patch)
}

/** Move an event along. The only change staff are allowed to make. */
export async function setEventStatus(id: string, status: StockEventStatus): Promise<void> {
  await backend.update(COL.events, id, { status, updatedAt: Date.now() })
}

export async function deleteEvent(id: string): Promise<void> {
  await backend.remove(COL.events, id)
}
