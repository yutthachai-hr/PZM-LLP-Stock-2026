import { getBrand } from '../brand/brand'

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
  /** Fold a created or changed row into every held range it belongs to, and out of the rest. */
  patch(row: T): void
  remove(id: string): void
  subscribe(fn: () => void): () => void
  clear(): void
}

export function createRangeCache<T extends { id: string }>(opts: {
  fetch: (from: number, to: number) => Promise<T[]>
  /** The field the range is on. */
  atOf: (row: T) => number
  /** Tie-break after the date, for a stable order. */
  compare?: (a: T, b: T) => number
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
        return slice({ rows }, from, to)
      } finally {
        pending.delete(k)
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
      const at = opts.atOf(row)
      for (const [k, r] of held) {
        if (!mine(k)) continue
        const without = r.rows.filter((x) => x.id !== row.id)
        r.rows = at >= r.from && at <= r.to ? sort([...without, row]) : without
      }
      announce()
    },
    remove(id) {
      for (const [k, r] of held) {
        if (mine(k)) r.rows = r.rows.filter((x) => x.id !== id)
      }
      announce()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    clear() {
      held.clear()
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
