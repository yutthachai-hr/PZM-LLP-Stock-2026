import { getBrand } from '../brand/brand'
import { cacheGet, cacheSet } from './localCache'

/**
 * A session cache of date-range reads, one per collection the calendar draws from.
 *
 * The calendar, the dashboard's "today" and "upcoming" panels and the sidebar badge all
 * ask for the same collections over overlapping windows. Each answer is a billed query,
 * and nothing here is subscribed (see src/services/events.ts for why). So every range
 * fetched is remembered for the session, keyed by brand, and a narrower request is served
 * from any wider range already held — the dashboard's fortnight is inside the calendar's
 * month, so whichever screen opens second pays nothing.
 *
 * A window that only partly overlaps what is held reads just the missing part and joins
 * the pieces into one held range (plan D3'): the calendar moving a month forward reads the
 * new weeks, not the four it already had.
 *
 * A write patches every held range in place; nothing is ever invalidated, because
 * re-reading a month for one changed row is exactly the cost this file exists to avoid.
 */

export interface RangeCache<T extends { id: string }> {
  /** Rows in [from, to], from memory when a covering range has been read before. */
  fetchRange(from: number, to: number, opts?: { force?: boolean }): Promise<T[]>
  /** What is held for a range right now, without fetching; undefined when nothing covers it. */
  peekRange(from: number, to: number): T[] | undefined
  /** True when a held range covers this one — used to skip a loading state. */
  hasRange(from: number, to: number): boolean
  /**
   * Ask only for rows changed since the newest held (persisted caches): what other devices
   * wrote, for the price of the changes. A cache without persistence does nothing here.
   */
  refreshChanged(): Promise<void>
  /** Fold a created or changed row into every held range it belongs to, and out of the rest. */
  patch(row: T): void
  remove(id: string): void
  subscribe(fn: () => void): () => void
  clear(): void
}

/**
 * Kept on the device across sessions (release hardening: Firestore reads). A new tab or a
 * phone opening the app again starts from what was held, asks once for the rows changed
 * since (`fetchChanged`, on a field every write sets), and reads in full again after
 * `maxAgeMs` — which is also how a deleted row (a dropped draft) leaves other devices.
 */
export interface RangePersist<T> {
  /** Storage key, unique per project and brand. Null = do not persist (demo mode). */
  key: () => string | null
  updatedAtOf: (row: T) => number
  fetchChanged: (since: number) => Promise<T[]>
  maxAgeMs?: number
  marginMs?: number
}

interface PersistedRanges<T> {
  v: 1
  fullAt: number
  maxUpdated: number
  ranges: { from: number; to: number }[]
  rows: T[]
}

export function createRangeCache<T extends { id: string }>(opts: {
  fetch: (from: number, to: number) => Promise<T[]>
  /** The field the range is on. */
  atOf: (row: T) => number
  /** Tie-break after the date, for a stable order. */
  compare?: (a: T, b: T) => number
  persist?: RangePersist<T>
}): RangeCache<T> {
  const held = new Map<string, { from: number; to: number; rows: T[] }>()
  // Reads in flight, so two screens mounting together do not both query a window one of
  // them is already fetching — the second waits for the first and slices its answer.
  const pending = new Map<string, { from: number; to: number; promise: Promise<T[]> }>()
  const listeners = new Set<() => void>()
  const sort = (rows: T[]) =>
    rows.sort((a, b) => opts.atOf(a) - opts.atOf(b) || (opts.compare ? opts.compare(a, b) : a.id.localeCompare(b.id)))
  const announce = () => {
    for (const fn of listeners) fn()
  }
  const brandKey = (from: number, to: number) => `${getBrand()}|${from}|${to}`
  const mine = (k: string) => k.startsWith(`${getBrand()}|`)

  // ---- persistence (optional) ----
  const hydrated = new Map<string, Promise<void>>()
  const fullAt = new Map<string, number>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function save() {
    const key = opts.persist?.key()
    if (!key || !opts.persist) return
    const p = opts.persist
    const brand = getBrand()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const ranges: { from: number; to: number }[] = []
      const rows = new Map<string, T>()
      for (const [k, r] of held) {
        if (!k.startsWith(`${brand}|`)) continue
        ranges.push({ from: r.from, to: r.to })
        for (const row of r.rows) rows.set(row.id, row)
      }
      let maxUpdated = 0
      for (const row of rows.values()) maxUpdated = Math.max(maxUpdated, p.updatedAtOf(row))
      const rec: PersistedRanges<T> = { v: 1, fullAt: fullAt.get(brand) ?? Date.now(), maxUpdated, ranges, rows: [...rows.values()] }
      void cacheSet(key, rec)
    }, 1000)
  }
  function hydrate(): Promise<void> {
    const brand = getBrand()
    const key = opts.persist?.key()
    if (!key || !opts.persist) return Promise.resolve()
    const p = opts.persist
    let h = hydrated.get(brand)
    if (h) return h
    h = (async () => {
      const rec = await cacheGet<PersistedRanges<T>>(key)
      const now = Date.now()
      if (!rec || rec.v !== 1 || now - rec.fullAt > (p.maxAgeMs ?? 24 * 3_600_000)) {
        fullAt.set(brand, now)
        return
      }
      fullAt.set(brand, rec.fullAt)
      for (const r of rec.ranges) {
        held.set(`${brand}|${r.from}|${r.to}`, { from: r.from, to: r.to, rows: sort(rec.rows.filter((x) => opts.atOf(x) >= r.from && opts.atOf(x) <= r.to)) })
      }
      // What changed since this device last looked, folded in like a write would be.
      try {
        const changed = await p.fetchChanged(Math.max(0, Math.min(rec.maxUpdated, now) - (p.marginMs ?? 30 * 60_000)))
        for (const row of changed) patchHeld(row)
      } catch {
        // Could not ask: forget what was held rather than show it as current.
        for (const k of [...held.keys()]) if (k.startsWith(`${brand}|`)) held.delete(k)
        fullAt.set(brand, now)
      }
      announce()
    })()
    hydrated.set(brand, h)
    return h
  }
  function patchHeld(row: T) {
    const at = opts.atOf(row)
    for (const [k, r] of held) {
      if (!mine(k)) continue
      const without = r.rows.filter((x) => x.id !== row.id)
      r.rows = at >= r.from && at <= r.to ? sort([...without, row]) : without
    }
  }

  function covering(from: number, to: number): { from: number; to: number; rows: T[] } | undefined {
    const exact = held.get(brandKey(from, to))
    if (exact) return exact
    for (const [k, r] of held) {
      if (mine(k) && r.from <= from && r.to >= to) return r
    }
    return undefined
  }

  function slice(r: { rows: T[] }, from: number, to: number): T[] {
    return r.rows.filter((row) => {
      const at = opts.atOf(row)
      return at >= from && at <= to
    })
  }

  return {
    async fetchRange(from, to, o) {
      await hydrate()
      if (!o?.force) {
        const hit = covering(from, to)
        if (hit) return slice(hit, from, to)
        for (const [k, p] of pending) {
          if (mine(k) && p.from <= from && p.to >= to) return slice({ rows: await p.promise }, from, to)
        }
      }
      // What is held that overlaps this window: read only the gaps, then hold one range.
      const overlap = o?.force ? [] : [...held].filter(([key, r]) => mine(key) && r.from <= to && r.to >= from)
      const gaps = gapsIn(from, to, overlap.map(([, r]) => r))
      const span = {
        from: Math.min(from, ...overlap.map(([, r]) => r.from)),
        to: Math.max(to, ...overlap.map(([, r]) => r.to)),
      }
      const k = brandKey(from, to)
      const promise = Promise.all(gaps.map((g) => opts.fetch(g.from, g.to))).then((parts) => {
        const byId = new Map<string, T>()
        for (const [, r] of overlap) for (const row of r.rows) byId.set(row.id, row)
        for (const part of parts) for (const row of part) byId.set(row.id, row)
        return sort([...byId.values()])
      })
      pending.set(k, { from, to, promise })
      try {
        const rows = await promise
        for (const [key] of overlap) held.delete(key)
        held.set(brandKey(span.from, span.to), { ...span, rows })
        announce()
        save()
        return slice({ rows }, from, to)
      } finally {
        pending.delete(k)
      }
    },
    async refreshChanged() {
      const p = opts.persist
      if (!p || !p.key()) return
      await hydrate()
      let newest = 0
      for (const [k, r] of held) if (mine(k)) for (const row of r.rows) newest = Math.max(newest, p.updatedAtOf(row))
      if (!newest) return
      const changed = await p.fetchChanged(Math.max(0, Math.min(newest, Date.now()) - (p.marginMs ?? 30 * 60_000)))
      for (const row of changed) patchHeld(row)
      if (changed.length) {
        announce()
        save()
      }
    },
    peekRange(from, to) {
      const hit = covering(from, to)
      return hit ? slice(hit, from, to) : undefined
    },
    hasRange(from, to) {
      return covering(from, to) !== undefined
    },
    patch(row) {
      patchHeld(row)
      announce()
      save()
    },
    remove(id) {
      for (const [k, r] of held) {
        if (mine(k)) r.rows = r.rows.filter((x) => x.id !== id)
      }
      announce()
      save()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    clear() {
      held.clear()
      hydrated.clear()
      announce()
    },
  }
}

/** The parts of [from, to] no held range covers, in order. Bounds are inclusive ms. */
export function gapsIn(from: number, to: number, ranges: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let at = from
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    if (r.to < at) continue
    if (r.from > at) out.push({ from: at, to: Math.min(to, r.from - 1) })
    at = Math.max(at, r.to + 1)
    if (at > to) break
  }
  if (at <= to) out.push({ from: at, to })
  return out
}
