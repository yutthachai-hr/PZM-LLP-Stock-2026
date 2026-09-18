import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import { requireEpochMs } from '../lib/validate'
import { DELETE_FIELD } from '../backend/types'
import { taskApprovalDraft } from '../lib/inventoryRules/notifications'
import { deliver } from './notifications'
import {
  COL,
  type EventHistoryAction,
  type EventHistoryEntry,
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
  assignedTo?: string[]
  assignedToAll?: boolean
  assignedToName?: string
  note?: string
  requiresApproval?: boolean
}

/** Who is acting, as the history records it: the uid the rules check and a name to show. */
export interface Actor {
  id: string
  name: string
}

/** History is capped by the rules; the oldest entries after the first go, the first stays. */
export const HISTORY_MAX = 100

/**
 * The uids an event is assigned to, whatever shape the document holds.
 *
 * A list on anything written since assignees became several; one uid as a string on
 * everything before. Empty when it is for everyone — that is the flag's job, and a list
 * of every uid would be wrong the day someone new signs in.
 */
export function assigneesOf(e: {
  assignedTo?: string[] | string
  assignedToAll?: boolean
}): string[] {
  if (e.assignedToAll) return []
  if (Array.isArray(e.assignedTo)) return e.assignedTo
  return e.assignedTo ? [e.assignedTo] : []
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

/** One task by id — the editor re-reads what it wrote so the drawer shows the stored history. */
export async function getEvent(id: string): Promise<StockEvent | null> {
  return backend.getOne<StockEvent>(COL.events, id)
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
  // Everyone, or some people, never both: the flag wins and the list is dropped.
  if (input.assignedToAll) out.assignedToAll = true
  else if (input.assignedTo?.length) out.assignedTo = input.assignedTo
  if (input.assignedToName) out.assignedToName = input.assignedToName
  if (input.note?.trim()) out.note = input.note.trim()
  if (input.requiresApproval) out.requiresApproval = true
  return out
}

const OPTIONAL_KEYS = ['locationId', 'dueAt', 'assignedTo', 'assignedToAll', 'assignedToName', 'note', 'requiresApproval']

function entry(actor: Actor, action: EventHistoryAction, at: number, extra: Partial<EventHistoryEntry> = {}): EventHistoryEntry {
  const e: EventHistoryEntry = { at, by: actor.id, byName: actor.name, action }
  if (extra.detail) e.detail = extra.detail
  if (extra.oldValue !== undefined) e.oldValue = extra.oldValue
  if (extra.newValue !== undefined) e.newValue = extra.newValue
  return e
}

/** The history with one more entry, kept inside the rules' cap without losing its origin. */
export function appendHistory(history: EventHistoryEntry[] | undefined, next: EventHistoryEntry): EventHistoryEntry[] {
  const cur = history ?? []
  if (cur.length < HISTORY_MAX) return [...cur, next]
  return [cur[0], ...cur.slice(cur.length - HISTORY_MAX + 2), next]
}

export async function createEvent(input: EventInput, actor: Actor): Promise<string> {
  validate(input)
  const now = Date.now()
  return backend.add(COL.events, {
    title: input.title.trim(),
    type: input.type,
    startAt: input.startAt,
    status: 'upcoming' satisfies StockEventStatus,
    priority: input.priority,
    ...optional(input),
    sourceType: 'manual',
    history: [entry(actor, 'created', now)],
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * A manager's edit. `previous` is the task as the editor opened it: the edit goes into
 * its history, and a new start time is recorded as a move — the rules refuse a re-date
 * that leaves no line behind.
 */
export async function updateEvent(id: string, input: EventInput, actor: Actor, previous: StockEvent): Promise<void> {
  validate(input)
  // Clearing an optional field has to remove it, not blank it: the validators use hasOnly
  // and an empty string is still a present key.
  const opt = optional(input)
  const now = Date.now()
  const patch: Record<string, unknown> = {
    title: input.title.trim(),
    type: input.type,
    startAt: input.startAt,
    priority: input.priority,
    updatedAt: now,
    ...opt,
  }
  for (const key of OPTIONAL_KEYS) {
    if (!(key in opt)) patch[key] = DELETE_FIELD
  }
  const moved = previous.startAt !== input.startAt
  patch.history = appendHistory(
    previous.history,
    moved
      ? entry(actor, 'rescheduled', now, { oldValue: String(previous.startAt), newValue: String(input.startAt) })
      : entry(actor, 'edited', now),
  )
  if (moved) patch.rescheduledFrom = previous.startAt
  await backend.update(COL.events, id, patch)
}

// ---------------------------------------------------------------- the workflow ----
//
// Each step writes only what the rules let that person write, and signs the history in
// their own name. The caller holds the document already (the drawer opened it), so the
// history grows without another read.

async function step(e: StockEvent, patch: Record<string, unknown>, h: EventHistoryEntry): Promise<StockEvent> {
  const full = { ...patch, history: appendHistory(e.history, h), updatedAt: h.at }
  await backend.update(COL.events, e.id, full)
  const next: Record<string, unknown> = { ...e, ...full }
  for (const [k, v] of Object.entries(full)) if ((v as unknown) === DELETE_FIELD) delete next[k]
  return next as unknown as StockEvent
}

/** Take a task up. */
export async function startEvent(e: StockEvent, actor: Actor): Promise<StockEvent> {
  if (e.status !== 'upcoming') throw new AppError('งานนี้เริ่มไปแล้ว')
  const now = Date.now()
  return step(
    e,
    { status: 'inProgress', startedBy: actor.id, startedByName: actor.name, startedAt: now },
    entry(actor, 'started', now),
  )
}

/**
 * Finish a task. One that needs a manager's sign-off waits for it — unless the person
 * finishing it may sign, in which case it is done in one step, signed by them.
 */
export async function completeEvent(
  e: StockEvent,
  actor: Actor,
  opts: { canApprove: boolean; locationName?: (id: string | undefined) => string },
): Promise<StockEvent> {
  if (e.status !== 'upcoming' && e.status !== 'inProgress') throw new AppError('งานนี้ปิดไปแล้ว')
  const now = Date.now()
  const signed = { completedBy: actor.id, completedByName: actor.name, completedAt: now }
  if (e.requiresApproval && !opts.canApprove) {
    const next = await step(e, { status: 'waitingApproval', ...signed }, entry(actor, 'completed', now, { detail: 'waitingApproval' }))
    // Tell the managers now rather than at the next job run.
    await deliver(taskApprovalDraft(next, opts.locationName ?? (() => '')), actor)
    return next
  }
  const approval = e.requiresApproval ? { approvedBy: actor.id, approvedByName: actor.name, approvedAt: now } : {}
  return step(e, { status: 'completed', ...signed, ...approval }, entry(actor, 'completed', now))
}

/** A manager signs off a task handed in. */
export async function approveEvent(e: StockEvent, actor: Actor): Promise<StockEvent> {
  if (e.status !== 'waitingApproval') throw new AppError('งานนี้ไม่ได้รอตรวจ')
  const now = Date.now()
  return step(
    e,
    { status: 'completed', approvedBy: actor.id, approvedByName: actor.name, approvedAt: now },
    entry(actor, 'approved', now),
  )
}

/** A manager sends a handed-in task back to be done again; the reason goes in the history. */
export async function reopenEvent(e: StockEvent, actor: Actor, reason: string): Promise<StockEvent> {
  if (e.status !== 'waitingApproval' && e.status !== 'completed') throw new AppError('งานนี้ยังไม่ได้ส่งตรวจ')
  if (!reason.trim()) throw new AppError('กรุณาระบุเหตุผล')
  const now = Date.now()
  return step(
    e,
    {
      status: 'inProgress',
      completedBy: DELETE_FIELD,
      completedByName: DELETE_FIELD,
      completedAt: DELETE_FIELD,
      approvedBy: DELETE_FIELD,
      approvedByName: DELETE_FIELD,
      approvedAt: DELETE_FIELD,
    },
    entry(actor, 'reopened', now, { detail: reason.trim() }),
  )
}

/** Move a task to another time. The old time stays on the document and in the history. */
export async function rescheduleEvent(e: StockEvent, newStart: number, reason: string, actor: Actor): Promise<StockEvent> {
  requireEpochMs(newStart)
  if (!reason.trim()) throw new AppError('กรุณาระบุเหตุผลที่เลื่อน')
  if (e.status === 'completed' || e.status === 'cancelled') throw new AppError('งานนี้ปิดไปแล้ว')
  const now = Date.now()
  const shift = newStart - e.startAt
  const patch: Record<string, unknown> = { startAt: newStart, rescheduledFrom: e.startAt }
  // The deadline moves with the start, so the task keeps the same time to do it.
  if (e.dueAt !== undefined) patch.dueAt = e.dueAt + shift
  return step(
    e,
    patch,
    entry(actor, 'rescheduled', now, { detail: reason.trim(), oldValue: String(e.startAt), newValue: String(newStart) }),
  )
}

/** Call a task off. A generated one is cancelled, never deleted, or the schedule would make it again. */
export async function cancelEvent(e: StockEvent, actor: Actor, reason: string): Promise<StockEvent> {
  if (e.status === 'completed' || e.status === 'cancelled') throw new AppError('งานนี้ปิดไปแล้ว')
  const now = Date.now()
  const patch: Record<string, unknown> = { status: 'cancelled' }
  if (reason.trim()) patch.cancelReason = reason.trim()
  return step(e, patch, entry(actor, 'cancelled', now, { detail: reason.trim() }))
}

export async function deleteEvent(id: string): Promise<void> {
  await backend.remove(COL.events, id)
}
