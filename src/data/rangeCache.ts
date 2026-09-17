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
      const k = brandKey(from, to)
      const promise = opts.fetch(from, to).then((rows) => sort(rows))
      pending.set(k, { from, to, promise })
      try {
        const rows = await promise
        held.set(k, { from, to, rows })
        announce()
        return rows
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
