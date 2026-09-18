import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { getBrand, onBrandChange } from '../brand/brand'
import { toDoc, type NotificationDraft, type WritePlan } from '../lib/inventoryRules/notifications'
import { COL, type AppNotification, type NotificationCategory, type NotificationPrefs, type NotificationPriority } from '../types'

/**
 * Notifications as the app writes them.
 *
 * Reading them is DataContext's job (one listener over the last week). Here: marking one
 * read — a write of the reader's own key and nothing else, which is all the rules allow —
 * the instant ones a person's own action causes, each person's mutes, and applying a
 * write plan from the engine when the app stands in for the Worker.
 */

const scoped = () => backend.forBrand(getBrand())

export async function markRead(n: AppNotification, uid: string, now = Date.now()): Promise<void> {
  if (n.readBy?.[uid]) return
  await scoped().update(COL.notifications, n.id, { [`readBy.${uid}`]: now, updatedAt: now })
}

export async function markAllRead(list: readonly AppNotification[], uid: string): Promise<number> {
  const now = Date.now()
  let n = 0
  for (const item of list) {
    if (item.readBy?.[uid]) continue
    await markRead(item, uid, now)
    n++
  }
  return n
}

/**
 * Announce what the person just did — a task handed in, a request sent, a large
 * adjustment. Best effort: the job will say it on its next run if this write is lost, and
 * a refused or duplicate write must never undo the action that caused it.
 */
export async function deliver(draft: NotificationDraft, actor: { id: string }): Promise<void> {
  try {
    const db = scoped()
    if (await db.getOne(COL.notifications, draft.id)) return
    await db.set(COL.notifications, draft.id, toDoc(draft, Date.now(), 'client', actor.id) as unknown as Record<string, unknown>)
  } catch {
    // see above
  }
}

/** Write what the engine planned. Returns how many documents were written. */
export async function applyPlan(p: WritePlan): Promise<number> {
  const db = scoped()
  const now = Date.now()
  for (const doc of [...p.create, ...p.rearm]) await db.set(COL.notifications, doc.id, doc as unknown as Record<string, unknown>)
  for (const id of p.resolve) await db.update(COL.notifications, id, { active: false, resolvedAt: now, updatedAt: now })
  return p.create.length + p.rearm.length + p.resolve.length
}

/** Documents by id, for the drafts the caller does not already hold. One read each. */
export async function getNotifications(ids: readonly string[]): Promise<AppNotification[]> {
  const db = scoped()
  const out: AppNotification[] = []
  for (const id of ids) {
    const doc = await db.getOne<AppNotification>(COL.notifications, id)
    if (doc) out.push(doc)
  }
  return out
}

// ------------------------------------------------------------------- preferences ----

const prefsId = (uid: string) => `prefs__${uid}`
let cachedPrefs: { uid: string; brand: string; prefs: NotificationPrefs | null } | null = null
const listeners = new Set<() => void>()
const announce = () => listeners.forEach((fn) => fn())
onBrandChange(() => {
  cachedPrefs = null
  announce()
})

async function loadPrefs(uid: string): Promise<void> {
  const brand = getBrand()
  try {
    const doc = await scoped().getOne<NotificationPrefs>(COL.inventorySchedules, prefsId(uid))
    cachedPrefs = { uid, brand, prefs: doc }
  } catch {
    cachedPrefs = { uid, brand, prefs: null }
  }
  announce()
}

/** This person's mutes for the open brand, read once per session. */
export function useNotificationPrefs(uid: string | undefined): NotificationPrefs | null {
  const snap = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => cachedPrefs,
    () => cachedPrefs,
  )
  const fresh = !!uid && snap?.uid === uid && snap.brand === getBrand()
  useEffect(() => {
    if (uid && !fresh) void loadPrefs(uid)
  }, [uid, fresh])
  return fresh ? (snap?.prefs ?? null) : null
}

export async function savePrefs(uid: string, mute: Partial<Record<NotificationCategory, NotificationPriority[]>>): Promise<void> {
  // Critical is never muted; drop it rather than store a setting that does nothing.
  const clean: Partial<Record<NotificationCategory, NotificationPriority[]>> = {}
  for (const [cat, list] of Object.entries(mute) as [NotificationCategory, NotificationPriority[]][]) {
    const kept = [...new Set(list.filter((p) => p !== 'critical'))]
    if (kept.length) clean[cat] = kept
  }
  const doc: NotificationPrefs = { id: prefsId(uid), kind: 'prefs', userId: uid, mute: clean, updatedAt: Date.now() }
  await scoped().set(COL.inventorySchedules, doc.id, doc as unknown as Record<string, unknown>)
  cachedPrefs = { uid, brand: getBrand(), prefs: doc }
  announce()
}
