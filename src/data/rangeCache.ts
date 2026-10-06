import { getBrand, resolveCollection } from '../brand/brand'
import { FULL_EVERY_MS, readCopy, writeCopy } from './deviceStore'

/**
 * A session cache of date-range reads, one per collection the calendar draws from.
 *
 * The calendar, the dashboard's panels, the order list, supplier intelligence and the
 * sidebar all ask for the same collections over overlapping windows. Each answer is a
 * billed query, so every range read is remembered for the session, keyed by brand.
 *
 * Since 6 Oct 2026 (perf/firestore-read-budget) the cache holds one set of rows per brand
 * and the spans it has read. A request reads only the parts of its window not already
 * held — the order list's 90 days after supplier intelligence's 120 costs nothing, and the
 * calendar's next month costs that month — instead of re-reading every overlapping window
 * whole. Measured before: the order list re-read all 130 orders on every visit.
 *
 * What other devices changed arrives through `changedSince` (rows whose `updatedAt` moved),
 * at most once a minute, instead of re-reading the window. A write on this device patches
 * the rows in place.
 */

export interface RangeCache<T extends { id: string }> {
  /** Rows in [from, to], reading only what is not held yet. `force` re-reads the window. */
  fetchRange(from: number, to: number, opts?: { force?: boolean }): Promise<T[]>
  /** What is held for a range right now, without fetching; undefined when not all of it is held. */
  peekRange(from: number, to: number): T[] | undefined
  /** True when the range is wholly held — used to skip a loading state. */
  hasRange(from: number, to: number): boolean
  /** Fold a created or changed row in. */
  patch(row: T): void
  remove(id: string): void
  subscribe(fn: () => void): () => void
  clear(): void
}

type Span = [number, number]

/** The parts of [from, to] the spans do not cover. Spans are sorted and disjoint. */
export function gaps(spans: readonly Span[], from: number, to: number): Span[] {
  const out: Span[] = []
  let at = from
  for (const [a, b] of spans) {
    if (b < at) continue
    if (a > to) break
    if (a > at) out.push([at, Math.min(a - 1, to)])
    at = Math.max(at, b + 1)
    if (at > to) break
  }
  if (at <= to) out.push([at, to])
  return out
}

/** Add a span, merging what touches or overlaps. */
export function addSpan(spans: readonly Span[], s: Span): Span[] {
  const all = [...spans, s].sort((x, y) => x[0] - y[0])
  const out: Span[] = []
  for (const [a, b] of all) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** How often rows changed elsewhere are asked for, at most. */
export const DELTA_EVERY_MS = 60_000
/** Margin for device clocks that disagree. */
const DELTA_SKEW_MS = 5 * 60_000

interface Held<T> {
  rows: Map<string, T>
  spans: Span[]
  /** When the held spans were last read whole; a day later they are read whole again. */
  fullAt: number
  /** The device copy has been folded in (persisted caches). */
  hydrated: boolean
  /** When `changedSince` last ran (or the first read finished). */
  syncedAt: number
  /** Serialises reads so two screens asking at once do not read the same gap twice. */
  queue: Promise<unknown>
}

export function createRangeCache<T extends { id: string }>(opts: {
  fetch: (from: number, to: number) => Promise<T[]>
  /** The field the range is on. */
  atOf: (row: T) => number
  /** Tie-break after the date, for a stable order. */
  compare?: (a: T, b: T) => number
  /** Rows whose `updatedAt` is at or after `since`, any date — what other devices changed. */
  changedSince?: (since: number) => Promise<T[]>
  /**
   * Keep what was read on this device between sessions (deviceStore), under this collection
   * name: the next open reads only what changed (`changedSince`), and the whole of any span
   * once a day. Needs `changedSince`.
   */
  persist?: string
  now?: () => number
}): RangeCache<T> {
  const byBrand = new Map<string, Held<T>>()
  const listeners = new Set<() => void>()
  const now = opts.now ?? Date.now
  const sort = (rows: T[]) =>
    rows.sort((a, b) => opts.atOf(a) - opts.atOf(b) || (opts.compare ? opts.compare(a, b) : a.id.localeCompare(b.id)))
  const announce = () => {
    for (const fn of listeners) fn()
  }
  const mine = (): Held<T> => {
    const b = getBrand()
    let h = byBrand.get(b)
    if (!h) {
      h = { rows: new Map(), spans: [], syncedAt: 0, fullAt: 0, hydrated: !opts.persist, queue: Promise.resolve() }
      byBrand.set(b, h)
    }
    return h
  }
  const within = (h: Held<T>, from: number, to: number) =>
    sort(
      [...h.rows.values()].filter((row) => {
        const at = opts.atOf(row)
        return at >= from && at <= to
      }),
    )

  const copyKey = () => `range:${resolveCollection(opts.persist ?? '', getBrand())}`
  interface Copy {
    v: 1
    spans: Span[]
    rows: T[]
    syncedAt: number
    fullAt: number
  }
  async function hydrate(h: Held<T>): Promise<void> {
    if (h.hydrated) return
    h.hydrated = true
    const c = await readCopy<Copy>(copyKey())
    if (!c || c.v !== 1 || now() - c.fullAt >= FULL_EVERY_MS) return
    for (const row of c.rows) if (!h.rows.has(row.id)) h.rows.set(row.id, row)
    for (const sp of c.spans) h.spans = addSpan(h.spans, sp)
    h.syncedAt = c.syncedAt
    h.fullAt = c.fullAt
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function save(h: Held<T>): void {
    if (!opts.persist) return
    if (saveTimer) clearTimeout(saveTimer)
    const key = copyKey()
    saveTimer = setTimeout(() => {
      void writeCopy<Copy>(key, { v: 1, spans: h.spans, rows: [...h.rows.values()], syncedAt: h.syncedAt, fullAt: h.fullAt })
    }, 1500)
  }

  async function catchUp(h: Held<T>): Promise<void> {
    if (!opts.changedSince || !h.spans.length || now() - h.syncedAt < DELTA_EVERY_MS) return
    const since = h.syncedAt - DELTA_SKEW_MS
    h.syncedAt = now()
    const changed = await opts.changedSince(since)
    for (const row of changed) h.rows.set(row.id, row)
    if (changed.length) announce()
  }

  return {
    fetchRange(from, to, o) {
      const h = mine()
      const run = h.queue.then(async () => {
        await hydrate(h)
        if (o?.force) {
          const rows = await opts.fetch(from, to)
          for (const [id, row] of h.rows) {
            const at = opts.atOf(row)
            if (at >= from && at <= to) h.rows.delete(id)
          }
          for (const row of rows) h.rows.set(row.id, row)
          h.spans = addSpan(h.spans, [from, to])
          if (!h.syncedAt) h.syncedAt = now()
          if (!h.fullAt) h.fullAt = now()
          save(h)
          announce()
        } else {
          const missing = gaps(h.spans, from, to)
          const fresh = !h.spans.length
          for (const [a, b] of missing) {
            const rows = await opts.fetch(a, b)
            for (const row of rows) h.rows.set(row.id, row)
            h.spans = addSpan(h.spans, [a, b])
          }
          if (fresh) {
            h.syncedAt = now()
            h.fullAt = now()
          } else await catchUp(h)
          if (missing.length) announce()
          save(h)
        }
        return within(h, from, to)
      })
      h.queue = run.catch(() => undefined)
      return run
    },
    peekRange(from, to) {
      const h = mine()
      return gaps(h.spans, from, to).length ? undefined : within(h, from, to)
    },
    hasRange(from, to) {
      return gaps(mine().spans, from, to).length === 0
    },
    patch(row) {
      const h = mine()
      h.rows.set(row.id, row)
      save(h)
      announce()
    },
    remove(id) {
      const h = mine()
      h.rows.delete(id)
      save(h)
      announce()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    clear() {
      byBrand.clear()
      announce()
    },
  }
}
