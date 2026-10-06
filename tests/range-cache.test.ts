// Plan D3': a window that partly overlaps what is held reads only the missing part.
import { describe, expect, test, vi } from 'vitest'
import { createRangeCache, gapsIn } from '../src/data/rangeCache'

vi.mock('../src/brand/brand', () => ({ getBrand: () => 'pizza' }))

const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, at: i }))

function cache() {
  const calls: [number, number][] = []
  const c = createRangeCache<{ id: string; at: number }>({
    atOf: (r) => r.at,
    fetch: async (from, to) => {
      calls.push([from, to])
      return rows.filter((r) => r.at >= from && r.at <= to)
    },
  })
  return { c, calls }
}

describe('gaps in a window', () => {
  test('what no held range covers, in order', () => {
    expect(gapsIn(0, 30, [])).toEqual([{ from: 0, to: 30 }])
    expect(gapsIn(0, 30, [{ from: 10, to: 20 }])).toEqual([{ from: 0, to: 9 }, { from: 21, to: 30 }])
    expect(gapsIn(0, 30, [{ from: 0, to: 30 }])).toEqual([])
    expect(gapsIn(10, 30, [{ from: 0, to: 15 }, { from: 25, to: 40 }])).toEqual([{ from: 16, to: 24 }])
  })
})

describe('the range cache', () => {
  test('moving the window forward reads only the new part, and answers in full', async () => {
    const { c, calls } = cache()
    expect((await c.fetchRange(0, 29)).length).toBe(30)
    const next = await c.fetchRange(10, 39)
    expect(calls).toEqual([[0, 29], [30, 39]])
    expect(next.map((r) => r.at)).toEqual(Array.from({ length: 30 }, (_, i) => i + 10))
    // The pieces are now one range: anything inside 0–39 is free.
    await c.fetchRange(5, 35)
    expect(calls).toHaveLength(2)
    expect(c.hasRange(0, 39)).toBe(true)
  })

  test('two held ranges with a hole between: only the hole is read', async () => {
    const { c, calls } = cache()
    await c.fetchRange(0, 9)
    await c.fetchRange(20, 29)
    const all = await c.fetchRange(0, 29)
    expect(calls).toEqual([[0, 9], [20, 29], [10, 19]])
    expect(all).toHaveLength(30)
  })

  test('force reads the whole window again', async () => {
    const { c, calls } = cache()
    await c.fetchRange(0, 9)
    await c.fetchRange(0, 9, { force: true })
    expect(calls).toEqual([[0, 9], [0, 9]])
  })
})
