import { useEffect, useState } from 'react'
import { backend, BACKEND_MODE } from '../backend'
import { getBrand, resolveCollection } from '../brand/brand'
import { useLive } from './useLive'
import { onReturnFromLongAbsence } from './readMeter'
import { clearCopies, FULL_EVERY_MS, readCopy, SKEW_MS, writeCopy } from './deviceStore'

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

export { SKEW_MS, FULL_EVERY_MS } from './deviceStore'
/** Bump to discard every stored copy (a change in what is kept). */
const VERSION = 1

interface Snapshot<T> {
  v: number
  fullAt: number
  cursor: number
  docs: T[]
}

type WithStamp = { id: string; updatedAt?: number }

async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  const s = await readCopy<Snapshot<T>>(key)
  return s && s.v === VERSION && Array.isArray(s.docs) ? s : null
}

async function saveSnapshot<T>(key: string, s: Snapshot<T>): Promise<void> {
  await writeCopy(key, s)
}

/** Erase every stored copy — on sign-out, with Firestore's own offline copy. */
export const clearSyncedSnapshots = clearCopies

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

export interface SyncOptions {
  label: string
  /** Stamps to listen on for changes. Default `updatedAt`; the ledger adds `createdAt`. */
  fields?: string[]
  /** How long a copy may go without a whole read. Default a day. */
  fullEvery?: number
  /** Read only part of the collection whole: `field >= from` (the ledger's last week). */
  window?: { field: string; from: number }
}

/** The newest value of one stamp field in a set of documents (0 for none). */
export function newestOf(docs: Iterable<Record<string, unknown>>, field: string): number {
  let n = 0
  for (const d of docs) {
    const v = d[field]
    if (typeof v === 'number' && v > n) n = v
  }
  return n
}

/**
 * The collection, as a list, kept current. Same shape as `useLive`. In local/demo mode it
 * is simply `useLive` — there is no bill to save.
 */
export function useSynced<T extends WithStamp>(collection: string, opts: SyncOptions): { data: T[]; loading: boolean } {
  const cloud = BACKEND_MODE === 'cloud'
  const live = useLive<T>(collection, {
    enabled: !cloud,
    label: opts.label,
    ...(opts.window ? { sinceField: opts.window.field, sinceValue: opts.window.from } : {}),
  })
  const synced = useSyncedCloud<T>(collection, opts, cloud)
  return cloud ? synced : live
}

function useSyncedCloud<T extends WithStamp>(collection: string, opts: SyncOptions, enabled: boolean): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const brand = getBrand()
  const { label } = opts
  const fields = (opts.fields ?? ['updatedAt']).join(',')
  const fullEvery = opts.fullEvery ?? FULL_EVERY_MS
  const winField = opts.window?.field
  const winFrom = opts.window?.from

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const unsubs: (() => void)[] = []
    let offReturn: (() => void) | null = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const key = resolveCollection(collection, brand) + (winField ? `@${winField}` : '')
    const db = backend.forBrand(brand)
    const held = new Map<string, T>()
    let fullAt = 0
    // A row whose window field has fallen behind the window (last week's ledger) is dropped.
    const keep = (d: T) => winField === undefined || Number((d as Record<string, unknown>)[winField] ?? 0) >= (winFrom ?? 0)
    const prune = () => {
      if (winField === undefined) return
      for (const [id, d] of held) if (!keep(d)) held.delete(id)
    }
    const emit = () => {
      if (!stopped) setData([...held.values()].filter(keep))
    }
    const snapshot = (): Snapshot<T> => ({ v: VERSION, fullAt, cursor: newestStamp(held.values()), docs: [...held.values()] })
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void saveSnapshot<T>(key, snapshot()), 1500)
    }

    void (async () => {
      const snap = await loadSnapshot<T>(key)
      if (stopped) return
      if (snap && Date.now() - snap.fullAt < fullEvery) {
        for (const d of snap.docs) held.set(d.id, d)
        fullAt = snap.fullAt
        prune()
        emit()
        setLoading(false)
      } else {
        try {
          const all =
            winField !== undefined
              ? await db.getRange<T>(collection, winField, winFrom ?? 0, Number.MAX_SAFE_INTEGER, { label: `${label}.full` })
              : await db.getAll<T>(collection, { label: `${label}.full` })
          if (stopped) return
          for (const d of all) held.set(d.id, d)
          fullAt = Date.now()
          emit()
          persist()
        } catch {
          // Offline or refused: what was held (nothing) stands; the listeners below retry.
        }
        setLoading(false)
      }
      const listen = () => {
        for (const field of fields.split(',')) {
          const since = Math.max(0, newestOf(held.values() as Iterable<Record<string, unknown>>, field) - SKEW_MS)
          let window = new Set<string>()
          unsubs.push(
            db.subscribe<T>(
              collection,
              (docs) => {
                window = mergeDelta(held, window, docs)
                prune()
                emit()
                persist()
                setLoading(false)
              },
              { since: { field, value: since }, label: `${label}.delta.${field}`, onError: () => setLoading(false) },
            ),
          )
        }
      }
      listen()
      // Back after more than half an hour: start again from what is held now, so the return
      // is charged what changed while away — not everything since the app was opened.
      offReturn = onReturnFromLongAbsence(() => {
        if (stopped) return
        unsubs.splice(0).forEach((u) => u())
        listen()
      })
    })()

    return () => {
      stopped = true
      offReturn?.()
      unsubs.forEach((u) => u())
      if (saveTimer) {
        clearTimeout(saveTimer)
        void saveSnapshot<T>(key, snapshot())
      }
    }
  }, [collection, brand, enabled, label, fields, fullEvery, winField, winFrom])

  return { data, loading }
}
