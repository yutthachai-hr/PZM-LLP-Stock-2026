import { useEffect, useState } from 'react'
import { backend, BACKEND_MODE } from '../backend'
import { getBrand, resolveCollection } from '../brand/brand'
import { useLive } from './useLive'

/**
 * A whole collection kept on this device, refreshed by what CHANGED since the last sync
 * (perf/firestore-read-budget, 6 Oct 2026).
 *
 * Products (336) and stock balances (524) were live listeners over the whole collection.
 * Firestore keeps a listener's place for 30 minutes; a phone that put the app away for
 * longer — every phone, many times a day — was charged all 860 documents again on return,
 * and again for every second tab. Measured on the 6 Oct backup that was 860 of the ~1,300–
 * 1,550 reads of every cold open, and the day ran to ~203k against a 50k allowance.
 *
 * Here the device keeps its last copy (IndexedDB) and listens only to documents whose
 * `updatedAt` is at or after the last one it holds, less a margin. A return after hours
 * costs the documents that changed in those hours — usually a handful — not the
 * collection. Once a day, or with no copy yet, it reads the whole collection once, which
 * also catches deletions and any write whose clock was too far behind for the margin.
 *
 * Every write to these collections sets `updatedAt` (the stock engine's levelDoc, every
 * product update) — that is what makes this correct. The margin covers device clocks that
 * disagree by up to SKEW_MS; the daily full read covers the rest.
 *
 * The copy holds what every signed-in person of the brand can already read, and sign-out
 * erases it with Firestore's own offline copy (`clearSyncedSnapshots`).
 */

export const SKEW_MS = 30 * 60_000
export const FULL_EVERY_MS = 24 * 60 * 60_000
const DB_NAME = 'pzm-synced'
const STORE = 'snapshots'
/** Bump to discard every stored copy (a change in what is kept). */
const VERSION = 1

interface Snapshot<T> {
  v: number
  fullAt: number
  cursor: number
  docs: T[]
}

type WithStamp = { id: string; updatedAt?: number }

// ------------------------------------------------------------------- storage ----

let opening: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined)
        try {
          const req = work(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  const s = (await run<Snapshot<T>>('readonly', (st) => st.get(key) as IDBRequest<Snapshot<T>>)) ?? null
  return s && s.v === VERSION && Array.isArray(s.docs) ? s : null
}

async function saveSnapshot<T>(key: string, s: Snapshot<T>): Promise<void> {
  await run('readwrite', (st) => st.put(s, key))
}

/** Erase every stored copy — on sign-out, with Firestore's own offline copy. */
export async function clearSyncedSnapshots(): Promise<void> {
  await run('readwrite', (st) => st.clear())
}

// --------------------------------------------------------------------- merge ----

/** The newest stamp in a set of documents (0 for none). */
export function newestStamp(docs: Iterable<WithStamp>): number {
  let n = 0
  for (const d of docs) if (typeof d.updatedAt === 'number' && d.updatedAt > n) n = d.updatedAt
  return n
}

/**
 * Fold one delivery of the delta listener into the held copy. `window` is everything the
 * listener now matches; an id it matched before and no longer does was deleted (a stamp
 * never moves backwards, so nothing else leaves the window).
 */
export function mergeDelta<T extends WithStamp>(held: Map<string, T>, prevWindow: Set<string>, window: readonly T[]): Set<string> {
  const now = new Set<string>()
  for (const d of window) {
    held.set(d.id, d)
    now.add(d.id)
  }
  for (const id of prevWindow) if (!now.has(id)) held.delete(id)
  return now
}

// ---------------------------------------------------------------------- hook ----

/**
 * The collection, as a list, kept current. Same shape as `useLive`. In local/demo mode it
 * is simply `useLive` — there is no bill to save.
 */
export function useSynced<T extends WithStamp>(collection: string, opts: { label: string }): { data: T[]; loading: boolean } {
  const cloud = BACKEND_MODE === 'cloud'
  const live = useLive<T>(collection, { enabled: !cloud, label: opts.label })
  const synced = useSyncedCloud<T>(collection, opts.label, cloud)
  return cloud ? synced : live
}

function useSyncedCloud<T extends WithStamp>(collection: string, label: string, enabled: boolean): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const brand = getBrand()

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let unsub: (() => void) | null = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const key = resolveCollection(collection, brand)
    const db = backend.forBrand(brand)
    const held = new Map<string, T>()
    let fullAt = 0
    let window = new Set<string>()

    const emit = () => {
      if (!stopped) setData([...held.values()])
    }
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        void saveSnapshot<T>(key, { v: VERSION, fullAt, cursor: newestStamp(held.values()), docs: [...held.values()] })
      }, 1500)
    }

    void (async () => {
      const snap = await loadSnapshot<T>(key)
      if (stopped) return
      if (snap && Date.now() - snap.fullAt < FULL_EVERY_MS) {
        for (const d of snap.docs) held.set(d.id, d)
        fullAt = snap.fullAt
        emit()
        setLoading(false)
      } else {
        try {
          const all = await db.getAll<T>(collection, { label: `${label}.full` })
          if (stopped) return
          for (const d of all) held.set(d.id, d)
          fullAt = Date.now()
          emit()
          persist()
        } catch {
          // Offline or refused: what was held (nothing) stands; the listener below retries.
        }
        setLoading(false)
      }
      const since = Math.max(0, newestStamp(held.values()) - SKEW_MS)
      unsub = db.subscribe<T>(
        collection,
        (docs) => {
          window = mergeDelta(held, window, docs)
          emit()
          persist()
          setLoading(false)
        },
        { since: { field: 'updatedAt', value: since }, label: `${label}.delta`, onError: () => setLoading(false) },
      )
    })()

    return () => {
      stopped = true
      unsub?.()
      if (saveTimer) {
        clearTimeout(saveTimer)
        void saveSnapshot<T>(key, { v: VERSION, fullAt, cursor: newestStamp(held.values()), docs: [...held.values()] })
      }
    }
  }, [collection, brand, enabled, label])

  return { data, loading }
}
