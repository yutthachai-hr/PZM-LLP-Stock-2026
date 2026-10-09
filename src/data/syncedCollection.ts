import { useCallback, useEffect, useState } from 'react'
import { backend, BACKEND_MODE } from '../backend'
import { getBrand, resolveCollection } from '../brand/brand'
import { useLive } from './useLive'
import { liveErrorKind, type LiveFailure } from './liveError'
import { onReturnFromLongAbsence } from './readMeter'
import { clearCopies, FULL_EVERY_MS, readCopy, SKEW_MS, writeCopy } from './deviceStore'
import { noteSeed } from './readMeter'
import { deltaStart, postgrestTransport, SEED_ENTITIES, seedConfig, seedFromShadow, seedMayReplaceFullRead, type SeedEntity } from './shadowSeed'

/** The pilot's transport, built once (null = off: the default, and every build without it). */
const seedCfg = seedConfig()
const seedTransport = seedCfg
  ? postgrestTransport(seedCfg, async () => {
      const { getAuthInstance } = await import('../firebase/app')
      return (await getAuthInstance().currentUser?.getIdToken()) ?? null
    })
  : null

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
  /** The brand's cache epoch the copy was read under (services/cacheEpoch), when the set follows one. */
  epoch?: number
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
  /**
   * The brand's cache epoch for this collection (services/cacheEpoch). An admin's restore,
   * delete or correction bumps it, and a copy read under another epoch is read whole again —
   * changes that move no timestamp (a deleted row, a restored backup) cannot be followed by
   * the change listeners. `null` while the epoch is still being read: nothing starts until
   * it is. Absent: the set follows no epoch.
   */
  epoch?: number | null
}

/**
 * Whether a device copy may be used as it is (then only the changes are read): it exists,
 * was read whole within `fullEvery`, and — for a set that follows the brand's cache epoch —
 * under the epoch now in force. Anything else is read whole again.
 */
export function copyIsCurrent(snap: { fullAt: number; epoch?: number } | null, now: number, fullEvery: number, epoch: number | undefined): snap is { fullAt: number; epoch?: number } {
  return !!snap && now - snap.fullAt < fullEvery && (epoch === undefined || snap.epoch === epoch)
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
/** What a synced or live set reports (plan C1: a listener the database ended is said, with a retry). */
export type LiveSet<T> = { data: T[]; loading: boolean; error: LiveFailure | null; retry: () => void }

export function useSynced<T extends WithStamp>(collection: string, opts: SyncOptions): LiveSet<T> {
  const cloud = BACKEND_MODE === 'cloud'
  const live = useLive<T>(collection, {
    enabled: !cloud,
    label: opts.label,
    ...(opts.window ? { sinceField: opts.window.field, sinceValue: opts.window.from } : {}),
  })
  const synced = useSyncedCloud<T>(collection, opts, cloud)
  return cloud ? synced : live
}

function useSyncedCloud<T extends WithStamp>(collection: string, opts: SyncOptions, enabled: boolean): LiveSet<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  // Plan C1 on the device copy: a listener or full read the database refused is reported
  // (the held rows stay), and retry() starts the sync again.
  const [error, setError] = useState<LiveFailure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const brand = getBrand()
  const { label } = opts
  const fields = (opts.fields ?? ['updatedAt']).join(',')
  const fullEvery = opts.fullEvery ?? FULL_EVERY_MS
  const winField = opts.window?.field
  const winFrom = opts.window?.from
  const epoch = opts.epoch

  useEffect(() => {
    if (!enabled || epoch === null) return
    let stopped = false
    const startedAt = Date.now()
    const fail = (err: unknown) => {
      if (stopped) return
      setError({ collection, kind: liveErrorKind(err), startedAt })
      setLoading(false)
    }
    const unsubs: (() => void)[] = []
    let offReturn: (() => void) | null = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const key = resolveCollection(collection, brand) + (winField ? `@${winField}` : '')
    const db = backend.forBrand(brand)
    const held = new Map<string, T>()
    let fullAt = 0
    // Set after a seed from the shadow: the delta must start no later than the shadow's proof.
    let seededThrough: number | null = null
    // A row whose window field has fallen behind the window (last week's ledger) is dropped.
    const keep = (d: T) => winField === undefined || Number((d as Record<string, unknown>)[winField] ?? 0) >= (winFrom ?? 0)
    const prune = () => {
      if (winField === undefined) return
      for (const [id, d] of held) if (!keep(d)) held.delete(id)
    }
    const emit = () => {
      if (!stopped) setData([...held.values()].filter(keep))
    }
    const snapshot = (): Snapshot<T> => ({ v: VERSION, fullAt, cursor: newestStamp(held.values()), docs: [...held.values()], ...(epoch !== undefined ? { epoch } : {}) })
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void saveSnapshot<T>(key, snapshot()), 1500)
    }

    void (async () => {
      const snap = await loadSnapshot<T>(key)
      if (stopped) return
      if (copyIsCurrent(snap, Date.now(), fullEvery, epoch)) {
        for (const d of snap.docs) held.set(d.id, d)
        fullAt = snap.fullAt
        prune()
        emit()
        setLoading(false)
      } else {
        // P1 pilot: a device with no copy (or an old one) may take it from the shadow.
        const entity = collection as SeedEntity
        if (seedTransport && seedCfg?.brands.includes(brand) && winField === undefined && SEED_ENTITIES.includes(entity) && seedMayReplaceFullRead(snap, epoch)) {
          const seeded = await seedFromShadow<T>(seedTransport, brand, entity, Date.now(), epoch)
          if (stopped) return
          noteSeed(`${label}.seed`, seeded.ok ? seeded.docs.length : 0, seeded.ok ? 'used' : seeded.reason)
          if (seeded.ok) {
            for (const d of seeded.docs) held.set(d.id, d)
            seededThrough = seeded.completeThrough
            fullAt = Date.now()
            emit()
            setLoading(false)
            // Not persisted until Firestore's first delta has been folded in.
          }
        }
        if (seededThrough === null) {
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
          } catch (err) {
            // Offline or refused: what was held (nothing) stands; said on screen (C1).
            fail(err)
          }
        }
        setLoading(false)
      }
      const listen = () => {
        for (const field of fields.split(',')) {
          const since = deltaStart(newestOf(held.values() as Iterable<Record<string, unknown>>, field), seededThrough, SKEW_MS)
          let window = new Set<string>()
          unsubs.push(
            db.subscribe<T>(
              collection,
              (docs) => {
                window = mergeDelta(held, window, docs)
                seededThrough = null
                prune()
                emit()
                persist()
                setLoading(false)
                setError(null)
              },
              { since: { field, value: since }, label: `${label}.delta.${field}`, onError: fail },
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
    // `attempt` only re-runs this effect: a retry is a fresh sync from what is held on the device.
  }, [collection, brand, enabled, label, fields, fullEvery, winField, winFrom, epoch, attempt])

  return { data, loading, error, retry }
}
