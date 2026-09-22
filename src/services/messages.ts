import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { createRangeCache } from '../data/rangeCache'
import { COL, MESSAGE_DAYS, MESSAGE_MAX, type AppMessage } from '../types'

/**
 * The message board: notes the shift leaves each other (owner, 22 Sep 2026).
 *
 * ## Why there is no listener
 *
 * Every real-time subscription is paid for by every device all day, and this app has about
 * seven of them against Firestore's ten. A board people open a few times a day does not
 * need one: it is read as a date range through the same session cache the calendar uses,
 * refreshed while the panel is open, and a message just sent is folded into that cache, so
 * the sender sees it without another read.
 *
 * ## What cannot happen
 *
 * A message cannot be edited (only pinned, by a manager) and only its author or an admin
 * may take it down — enforced again in the rules, because this file is client code.
 */
const DAY = 86_400_000

function scoped() {
  return backend.forBrand(getBrand())
}

export const messageCache = createRangeCache<AppMessage>({
  fetch: async (from, to) => scoped().getRange<AppMessage>(COL.messages, 'createdAt', from, to),
  atOf: (m) => m.createdAt,
})

/** The window the board opens on: the last two weeks, deepened by "โหลดเพิ่ม". */
export const DEFAULT_DAYS = 14

export async function listMessages(days = DEFAULT_DAYS, opts: { force?: boolean } = {}): Promise<AppMessage[]> {
  const now = Date.now()
  const rows = await messageCache.fetchRange(now - days * DAY, now + DAY, opts)
  return sortForBoard(rows)
}

/** Pinned first, then newest first — the order the panel shows. */
export function sortForBoard(rows: readonly AppMessage[]): AppMessage[] {
  return [...rows].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt - a.createdAt)
}

/** How many of these a person has not seen, from when they last opened the board. */
export function unreadCount(rows: readonly AppMessage[], readAt: number | undefined, meId: string): number {
  return rows.filter((m) => m.byUserId !== meId && m.createdAt > (readAt ?? 0)).length
}

export async function sendMessage(params: { body: string; actor: { id: string; name: string } }): Promise<AppMessage> {
  const body = params.body.trim()
  if (!body) throw new AppError('พิมพ์ข้อความก่อนส่ง')
  if (body.length > MESSAGE_MAX) throw new AppError('ข้อความยาวเกิน {n} ตัวอักษร', { n: MESSAGE_MAX })
  const doc = {
    body,
    byUserId: params.actor.id,
    byUserName: params.actor.name,
    createdAt: Date.now(),
  }
  const id = await scoped().add(COL.messages, doc)
  const saved = { ...doc, id } as AppMessage
  messageCache.patch(saved)
  return saved
}

/** Keep a message at the top, or let it go. Managers and admins only (rules agree). */
export async function setPinned(message: AppMessage, pinned: boolean): Promise<AppMessage> {
  const next: AppMessage = { ...message, pinned }
  await scoped().update(COL.messages, message.id, { pinned })
  messageCache.patch(next)
  return next
}

/** Take a message down. The author may remove their own; an admin may remove any. */
export async function deleteMessage(message: AppMessage, actor: { id: string; role: string }): Promise<void> {
  if (actor.role !== 'admin' && message.byUserId !== actor.id) {
    throw new AppError('ลบได้เฉพาะข้อความของตัวเอง')
  }
  await scoped().remove(COL.messages, message.id)
  messageCache.remove(message.id)
}

/** Note that this person has now seen the board (one write, on opening it). */
export async function markMessagesRead(userId: string, at = Date.now()): Promise<void> {
  await scoped().update(COL.users, userId, { messagesReadAt: at })
}

/** Anything older than the agreed 90 days is gone; used by the cron Worker. */
export function isExpired(m: AppMessage, now = Date.now()): boolean {
  return m.createdAt < now - MESSAGE_DAYS * DAY
}
