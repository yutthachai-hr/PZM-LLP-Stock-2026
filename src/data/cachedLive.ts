import type { SinceFilter } from '../backend/types'

/**
 * A live listener that remembers what it saw (release hardening: Firestore reads).
 *
 * Firestore bills every document a listener delivers when it starts — and a listener that
 * has been away more than 30 minutes starts again, which is every time a phone opens the
 * app from its home screen. The products, the balances, the ledger window and the week of
 * notifications came to ~2,800 documents an open (e2e/read-benchmark.spec.ts).
 *
 * So the set is kept on the device. On open it is shown at once from there, and the
 * listener asks only for what changed since: `field >= newest seen − margin` (the margin
 * covers writers whose clocks run a little behind). Everything is read again — and the
 * cache rebuilt — when there is no cache, it is older than `maxAgeMs`, the window now
 * starts earlier than the cache covers, or the brand's cache epoch moved: an admin action
 * that deletes or rewrites history (a void, an edit, a restore, a unit change) bumps it,
 * because a change listener cannot see a deletion.
 */

export interface CacheRecord<T> {
  v: 1
  epoch: number
  /** When everything was last read in full. */
  fullAt: number
  /** The window's lower bound the full read covered (null = no window). */
  coverFrom: number | null
  /** The newest `field` value seen. */
  maxField: number
  docs: T[]
}

export interface CachedListenDeps<T> {
  subscribe(cb: (docs: T[]) => void, since: SinceFilter | undefined, onError: (e: unknown) => void): () => void
  load(): Promise<CacheRecord<T> | undefined>
  save(rec: CacheRecord<T>): Promise<void>
  now(): number
}

export interface CachedListenOptions {
  /** A number field every write sets: updatedAt, or createdAt for immutable rows. */
  field: string
  epoch: number
  marginMs?: number
  maxAgeMs?: number
  /** A lower bound on another field the screens want (the ledger's date window). */
  window?: SinceFilter
}

export const CACHE_MARGIN_MS = 30 * 60_000
export const CACHE_MAX_AGE_MS = 7 * 24 * 3_600_000

type Doc = { id: string } & Record<string, unknown>

export function isFresh<T>(rec: CacheRecord<T> | undefined, opts: CachedListenOptions, now: number): rec is CacheRecord<T> {
  if (!rec || rec.v !== 1) return false
  if (rec.epoch !== opts.epoch) return false
  if (now - rec.fullAt > (opts.maxAgeMs ?? CACHE_MAX_AGE_MS)) return false
  if (opts.window && (rec.coverFrom === null || opts.window.value < rec.coverFrom)) return false
  return true
}

export function cachedListen<T extends Doc>(
  deps: CachedListenDeps<T>,
  opts: CachedListenOptions,
  deliver: (docs: T[], from: 'cache' | 'full' | 'delta') => void,
  onError: (e: unknown) => void,
): () => void {
  let stopped = false
  let unsub: (() => void) | null = null
  let rec: CacheRecord<T> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const map = new Map<string, T>()
  const fieldOf = (d: T) => {
    const v = d[opts.field]
    return typeof v === 'number' ? v : 0
  }
  const inWindow = (d: T) => !opts.window || (typeof d[opts.window.field] === 'number' && (d[opts.window.field] as number) >= opts.window.value)
  const shown = () => [...map.values()].filter(inWindow)
  // What is kept: the window's rows only (a row that fell out of it is not needed again
  // unless the window widens, which reads in full).
  const save = () => {
    if (!rec) return
    const docs = [...map.values()].filter(inWindow)
    void deps.save({ ...rec, coverFrom: opts.window ? Math.max(rec.coverFrom ?? opts.window.value, opts.window.value) : null, docs })
  }
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 1000)
  }

  void deps.load().then((cached) => {
    if (stopped) return
    const now = deps.now()
    if (isFresh(cached, opts, now)) {
      rec = cached
      for (const d of cached.docs) map.set(d.id, d)
      deliver(shown(), 'cache')
      unsub = deps.subscribe(
        (docs) => {
          for (const d of docs) {
            map.set(d.id, d)
            if (rec && fieldOf(d) > rec.maxField) rec.maxField = fieldOf(d)
          }
          deliver(shown(), 'delta')
          persist()
        },
        // Never later than now: one writer with a clock running ahead must not hide every
        // change until its time comes round.
        { field: opts.field, value: Math.max(0, Math.min(cached.maxField, now) - (opts.marginMs ?? CACHE_MARGIN_MS)) },
        onError,
      )
      return
    }
    // In full: the window's set (or the whole collection), and the cache rebuilt from it.
    unsub = deps.subscribe(
      (docs) => {
        map.clear()
        let max = 0
        for (const d of docs) {
          map.set(d.id, d)
          max = Math.max(max, fieldOf(d))
        }
        rec = { v: 1, epoch: opts.epoch, fullAt: rec?.fullAt ?? deps.now(), coverFrom: opts.window?.value ?? null, maxField: max, docs: [] }
        deliver(shown(), 'full')
        persist()
      },
      opts.window,
      onError,
    )
  })

  return () => {
    stopped = true
    if (saveTimer) {
      clearTimeout(saveTimer)
      save()
    }
    unsub?.()
  }
}
