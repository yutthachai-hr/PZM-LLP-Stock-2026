import { describe, expect, test } from 'vitest'
import { addSpan, createRangeCache, gaps } from '../src/data/rangeCache'

/** perf/firestore-read-budget: overlapping windows read only what is missing. */
type R = { id: string; at: number; updatedAt?: number }

function world(rows: R[]) {
  const calls: [number, number][] = []
  const deltas: number[] = []
  let clock = 1_000_000
  const cache = createRangeCache<R>({
    fetch: async (from, to) => {
      calls.push([from, to])
      return rows.filter((r) => r.at >= from && r.at <= to)
    },
    atOf: (r) => r.at,
    changedSince: async (since) => {
      deltas.push(since)
      return rows.filter((r) => (r.updatedAt ?? 0) >= since)
    },
    now: () => clock,
  })
  return { cache, calls, deltas, tick: (ms: number) => (clock += ms), rows }
}

describe('range cache spans', () => {
  test('gaps are what the held spans do not cover', () => {
    expect(gaps([], 1, 10)).toEqual([[1, 10]])
    expect(gaps([[3, 5]], 1, 10)).toEqual([[1, 2], [6, 10]])
    expect(gaps([[1, 10]], 2, 9)).toEqual([])
    expect(gaps([[1, 3], [7, 8]], 2, 9)).toEqual([[4, 6], [9, 9]])
  })
  test('spans merge when they touch or overlap', () => {
    expect(addSpan([[1, 3]], [4, 6])).toEqual([[1, 6]])
    expect(addSpan([[1, 3], [8, 9]], [2, 8])).toEqual([[1, 9]])
    expect(addSpan([[5, 6]], [1, 2])).toEqual([[1, 2], [5, 6]])
  })
})

describe('range cache reads', () => {
  const rows: R[] = [1, 5, 10, 20, 30].map((at) => ({ id: `r${at}`, at }))

  test('an overlapping window reads only its uncovered part', async () => {
    const w = world(rows)
    expect((await w.cache.fetchRange(1, 10)).map((r) => r.at)).toEqual([1, 5, 10])
    expect((await w.cache.fetchRange(5, 25)).map((r) => r.at)).toEqual([5, 10, 20])
    expect(w.calls).toEqual([[1, 10], [11, 25]])
  })
  test('a window already held reads nothing', async () => {
    const w = world(rows)
    await w.cache.fetchRange(1, 30)
    await w.cache.fetchRange(5, 20)
    expect(w.calls).toHaveLength(1)
    expect(w.cache.peekRange(5, 20)?.map((r) => r.at)).toEqual([5, 10, 20])
    expect(w.cache.peekRange(5, 40)).toBeUndefined()
  })
  test('two screens asking at once do not read the same gap twice', async () => {
    const w = world(rows)
    await Promise.all([w.cache.fetchRange(1, 30), w.cache.fetchRange(1, 30)])
    expect(w.calls).toHaveLength(1)
  })
  test('changes elsewhere arrive through the cheap refresh, at most once a minute', async () => {
    const w = world(rows.map((r) => ({ ...r })))
    await w.cache.fetchRange(1, 30)
    w.rows[1].updatedAt = 2_000_000
    w.rows[1].at = 6
    await w.cache.fetchRange(1, 30) // within the minute: nothing asked
    expect(w.deltas).toHaveLength(0)
    w.tick(61_000)
    const got = await w.cache.fetchRange(1, 30)
    expect(w.deltas).toHaveLength(1)
    expect(got.find((r) => r.id === 'r5')?.at).toBe(6)
    expect(w.calls).toHaveLength(1)
  })
  test('force re-reads the window and drops rows no longer in it', async () => {
    const w = world(rows.map((r) => ({ ...r })))
    await w.cache.fetchRange(1, 30)
    w.rows.splice(0, 1)
    const got = await w.cache.fetchRange(1, 30, { force: true })
    expect(got.map((r) => r.at)).toEqual([5, 10, 20, 30])
  })
})
