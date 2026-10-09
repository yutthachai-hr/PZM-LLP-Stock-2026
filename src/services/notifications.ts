import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { getBrand, onBrandChange } from '../brand/brand'
import { audienceKeysOf, toDoc, type NotificationDraft, type WritePlan } from '../lib/inventoryRules/notifications'
import { COL, type AppNotification, type NotificationCategory, type NotificationPrefs, type NotificationPriority } from '../types'
import { currentWorkflow } from '../lib/trace'

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
    if (await db.getOne(COL.notifications, draft.id, { label: 'notifications.deliver.check' })) return
    await db.set(COL.notifications, draft.id, toDoc(draft, Date.now(), 'client', actor.id, currentWorkflow()) as unknown as Record<string, unknown>)
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

/**
 * Documents by id, for the drafts the caller does not already hold — 30 ids a query, billed
 * for what is found plus one a query. (Until 6 Oct 2026 one read each: 134 billed reads per
 * run in the measurement, nearly all for documents that did not exist.)
 */
export async function getNotifications(ids: readonly string[]): Promise<AppNotification[]> {
  if (!ids.length) return []
  return scoped().getMany<AppNotification>(COL.notifications, ids, { label: 'notifications.job.lookup' })
}

/** Every notification still showing a live state — the job's occasional sweep for strays. */
export async function getActiveNotifications(): Promise<AppNotification[]> {
  return scoped().query<AppNotification>(COL.notifications, { filters: [{ field: 'active', op: '==', value: true }] }, { label: 'notifications.job.sweep' })
}

/**
 * Give documents written before 6 Oct 2026 their `audienceKeys`, so the recipient-scoped
 * bell finds them. Only active ones the job is already holding; a manager may rewrite a
 * notification (rules: notificationUpdate). Best effort.
 */
export async function backfillAudience(docs: readonly AppNotification[]): Promise<number> {
  const db = scoped()
  let n = 0
  for (const d of docs) {
    if (d.audienceKeys || !d.active) continue
    try {
      await db.set(COL.notifications, d.id, { ...d, audienceKeys: audienceKeysOf(d.to) } as unknown as Record<string, unknown>)
      n++
    } catch {
      // the next run tries again
    }
  }
  return n
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
  await writePrefs(uid, { mute: clean })
}

/** Popup sound and mute (5 Oct 2026), in the same document as the bell's mutes. */
export async function saveSoundPrefs(uid: string, sound: NonNullable<NotificationPrefs['sound']>): Promise<void> {
  const clean: NonNullable<NotificationPrefs['sound']> = {
    enabled: !!sound.enabled,
    volume: Math.min(1, Math.max(0, Number(sound.volume) || 0)),
  }
  if (sound.off?.length) clean.off = [...new Set(sound.off)]
  if (sound.mutedUntil && sound.mutedUntil > Date.now()) clean.mutedUntil = sound.mutedUntil
  if (sound.allowCritical === false) clean.allowCritical = false
  await writePrefs(uid, { sound: clean })
}

/** One write of the whole document, keeping whichever half is not being changed. */
async function writePrefs(uid: string, change: Partial<Pick<NotificationPrefs, 'mute' | 'sound'>>): Promise<void> {
  const cur = cachedPrefs?.uid === uid && cachedPrefs.brand === getBrand() ? cachedPrefs.prefs : await scoped().getOne<NotificationPrefs>(COL.inventorySchedules, prefsId(uid))
  const doc: NotificationPrefs = { id: prefsId(uid), kind: 'prefs', userId: uid, mute: cur?.mute ?? {}, updatedAt: Date.now() }
  if (cur?.sound) doc.sound = cur.sound
  if (change.mute) doc.mute = change.mute
  if (change.sound) doc.sound = change.sound
  await scoped().set(COL.inventorySchedules, doc.id, doc as unknown as Record<string, unknown>)
  cachedPrefs = { uid, brand: getBrand(), prefs: doc }
  announce()
}
