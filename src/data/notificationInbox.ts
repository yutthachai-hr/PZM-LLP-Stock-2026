import { useCallback, useEffect, useMemo, useState } from 'react'
import { backend } from '../backend'
import type { QuerySpec } from '../backend/types'
import { getBrand, resolveCollection } from '../brand/brand'
import { INBOX_LIMIT, NOTIFICATION_WINDOW_DAYS, readerKeys } from '../lib/inventoryRules/notifications'
import { COL, type AppNotification, type AppUser } from '../types'
import { readCopy, SKEW_MS, writeCopy } from './deviceStore'
import { windowStart } from './ledgerWindow'
import { onReturnFromLongAbsence } from './readMeter'

/**
 * One person's notifications (perf/firestore-read-budget, 6 Oct 2026).
 *
 * Until now every device listened to the last week of EVERY recipient's notifications and
 * kept the few addressed to its person: ~135 documents on each open in the 6 Oct
 * measurement, and every write or "read" mark anywhere in the company was a billed read on
 * every open phone. Now:
 *
 *  - the server matches the reader's keys (`all`, `role:x`, `uid:x` — `audienceKeys` on
 *    each document) and sends the newest INBOX_LIMIT, once;
 *  - the device keeps that list, and listens only to the reader's documents whose
 *    `updatedAt` moved since — new ones, read marks, resolved states — so a return after
 *    hours costs what changed, not the list again;
 *  - older ones come a page at a time, on request (`loadOlder`), never as a listener.
 *
 * Both queries need the composite indexes in firestore.indexes.json. Until they are
 * deployed Firestore refuses them with failed-precondition; the inbox then falls back to
 * the newest documents of the week for everyone, bounded, filtered by the bell as before.
 *
 * NotificationHost and the bell share this one listener through DataContext.
 */

const LEGACY_LIMIT = 60
/** The device keeps at most this many — the bell's list plus a margin for paging. */
const KEEP = INBOX_LIMIT * 2
const COPY_EVERY_MS = 24 * 60 * 60_000

export interface Inbox {
  notifications: AppNotification[]
  loading: boolean
  /** Whether the keyed queries are in use (false: the bounded fallback until the indexes exist). */
  keyed: boolean
  hasOlder: boolean
  olderLoading: boolean
  loadOlder: () => Promise<void>
}

export function inboxSpec(user: Pick<AppUser, 'id' | 'role'>, before?: number, limit = INBOX_LIMIT): QuerySpec {
  return {
    filters: [
      { field: 'audienceKeys', op: 'array-contains-any', value: readerKeys(user) },
      ...(before !== undefined ? [{ field: 'createdAt', op: '<' as const, value: before }] : []),
    ],
    orderBy: { field: 'createdAt', dir: 'desc' },
    limit,
  }
}

/** The reader's newest-changed documents at or after `since` (index: audienceKeys + updatedAt desc). */
export function inboxChangedSpec(user: Pick<AppUser, 'id' | 'role'>, since: number): QuerySpec {
  return {
    filters: [
      { field: 'audienceKeys', op: 'array-contains-any', value: readerKeys(user) },
      { field: 'updatedAt', op: '>=', value: since },
    ],
    // A burst (a job run touching a hundred states) costs at most this many on a return.
    orderBy: { field: 'updatedAt', dir: 'desc' },
    limit: KEEP,
  }
}

interface Copy {
  v: 1
  at: number
  docs: AppNotification[]
}

/** Newest first, at most `n`. */
function newest(docs: Iterable<AppNotification>, n: number): AppNotification[] {
  return [...docs].sort((a, b) => b.createdAt - a.createdAt).slice(0, n)
}

export function useNotificationInbox(user: Pick<AppUser, 'id' | 'role'> | null): Inbox {
  const [live, setLive] = useState<AppNotification[]>([])
  const [older, setOlder] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [keyed, setKeyed] = useState(true)
  const [hasOlder, setHasOlder] = useState(true)
  const [olderLoading, setOlderLoading] = useState(false)
  const uid = user?.id
  const role = user?.role
  const brand = getBrand()

  useEffect(() => {
    setLive([])
    setOlder([])
    setHasOlder(true)
    if (!uid || !role) {
      setLoading(false)
      return
    }
    setLoading(true)
    const me = { id: uid, role }
    const db = backend.forBrand(brand)
    let stopped = false
    let unsub: (() => void) | null = null
    let offReturn: (() => void) | null = null
    const failed = (e: unknown) => {
      // No index yet: fall back rather than leave the bell empty.
      if ((e as { code?: string })?.code === 'failed-precondition') setKeyed(false)
      setLoading(false)
    }

    if (!keyed) {
      unsub = db.subscribe<AppNotification>(
        COL.notifications,
        (docs) => {
          setLive(docs)
          setLoading(false)
        },
        {
          label: 'notifications.inbox.legacy',
          since: { field: 'createdAt', value: windowStart(NOTIFICATION_WINDOW_DAYS) },
          query: { orderBy: { field: 'createdAt', dir: 'desc' }, limit: LEGACY_LIMIT },
          onError: () => setLoading(false),
        },
      )
      return () => unsub?.()
    }

    const key = `inbox:${resolveCollection(COL.notifications, brand)}:${uid}:${role}`
    const held = new Map<string, AppNotification>()
    const show = () => {
      if (!stopped) setLive(newest(held.values(), KEEP))
    }
    const save = () => void writeCopy<Copy>(key, { v: 1, at: Date.now(), docs: newest(held.values(), KEEP) })

    void (async () => {
      const copy = db.mode === 'cloud' ? await readCopy<Copy>(key) : null
      if (stopped) return
      if (copy && copy.v === 1 && Date.now() - copy.at < COPY_EVERY_MS) {
        for (const n of copy.docs) held.set(n.id, n)
      } else {
        try {
          for (const n of await db.query<AppNotification>(COL.notifications, inboxSpec(me), { label: 'notifications.inbox.first' })) held.set(n.id, n)
          save()
        } catch (e) {
          failed(e)
          return
        }
      }
      if (stopped) return
      show()
      setLoading(false)
      const listen = () => {
        let cursor = 0
        for (const n of held.values()) if (n.updatedAt > cursor) cursor = n.updatedAt
        unsub = db.subscribe<AppNotification>(
          COL.notifications,
          (docs) => {
            for (const n of docs) held.set(n.id, n)
            show()
            save()
            setLoading(false)
          },
          { label: 'notifications.inbox', query: inboxChangedSpec(me, Math.max(0, cursor - SKEW_MS)), onError: failed },
        )
      }
      listen()
      // Back after more than half an hour: a fresh cursor, so the return costs what changed.
      offReturn = onReturnFromLongAbsence(() => {
        if (stopped) return
        unsub?.()
        listen()
      })
    })()

    return () => {
      stopped = true
      offReturn?.()
      unsub?.()
    }
  }, [uid, role, brand, keyed])

  const loadOlder = useCallback(async () => {
    if (!uid || !role || !keyed) return
    const all = [...live, ...older]
    const oldest = all.length ? Math.min(...all.map((n) => n.createdAt)) : Date.now()
    setOlderLoading(true)
    try {
      const page = await backend.query<AppNotification>(COL.notifications, inboxSpec({ id: uid, role }, oldest), { label: 'notifications.history' })
      setOlder((cur) => [...cur, ...page])
      setHasOlder(page.length === INBOX_LIMIT)
    } finally {
      setOlderLoading(false)
    }
  }, [uid, role, keyed, live, older])

  const notifications = useMemo(() => {
    const byId = new Map<string, AppNotification>()
    for (const n of older) byId.set(n.id, n)
    for (const n of live) byId.set(n.id, n) // the live copy wins: it carries read marks
    return [...byId.values()]
  }, [live, older])

  return { notifications, loading, keyed, hasOlder: keyed && hasOlder, olderLoading, loadOlder }
}
