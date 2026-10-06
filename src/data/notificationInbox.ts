import { useCallback, useEffect, useMemo, useState } from 'react'
import { backend } from '../backend'
import type { QuerySpec } from '../backend/types'
import { getBrand } from '../brand/brand'
import { INBOX_LIMIT, NOTIFICATION_WINDOW_DAYS, readerKeys } from '../lib/inventoryRules/notifications'
import { COL, type AppNotification, type AppUser } from '../types'
import { windowStart } from './ledgerWindow'

/**
 * One person's notifications (perf/firestore-read-budget, 6 Oct 2026).
 *
 * Until now every device listened to the last week of EVERY recipient's notifications and
 * kept the few addressed to its person: ~135 documents on each open in the 6 Oct
 * measurement, and every write or "read" mark anywhere in the company was a billed read on
 * every open phone. Now the server matches the reader's keys (`all`, `role:x`, `uid:x` —
 * `audienceKeys` on each document) and sends the newest INBOX_LIMIT. Older ones are a page
 * at a time, on request (`loadOlder`), never a standing listener.
 *
 * The keyed query needs the composite index in firestore.indexes.json. Until it is
 * deployed Firestore refuses it with failed-precondition; the inbox then falls back to the
 * newest documents of the week for everyone, bounded, and the bell filters them as before.
 *
 * NotificationHost and the bell share this one listener through DataContext.
 */

const LEGACY_LIMIT = 60

export interface Inbox {
  notifications: AppNotification[]
  loading: boolean
  /** Whether the keyed query is in use (false: the bounded fallback until the index exists). */
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
    const unsub = keyed
      ? backend.subscribe<AppNotification>(
          COL.notifications,
          (docs) => {
            setLive(docs)
            setLoading(false)
          },
          {
            label: 'notifications.inbox',
            query: inboxSpec(me),
            onError: (e) => {
              // No index yet: fall back rather than leave the bell empty.
              if ((e as { code?: string })?.code === 'failed-precondition') setKeyed(false)
              setLoading(false)
            },
          },
        )
      : backend.subscribe<AppNotification>(
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
    return unsub
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
