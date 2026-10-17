import { test, expect } from 'vitest'
import { createRangeCache } from '../src/data/rangeCache'
import { setActiveBrand } from '../src/brand/brand'

test('a queued historical range fetch carries its starting brand through the queue', async () => {
  setActiveBrand('pizza')
  const brands: unknown[] = []
  const cache = createRangeCache<{ id: string; date: number }>({
    fetch: async (...args: unknown[]) => { brands.push(args[2]); return [] },
    atOf: r => r.date,
  })
  const pending = cache.fetchRange(1, 2)
  setActiveBrand('lelapin')
  await pending
  expect(brands).toEqual(['pizza'])
})

test('a failed historical delta read does not advance the success watermark', async () => {
  let now = 1_000
  let calls = 0
  const cache = createRangeCache<{ id: string; date: number }>({
    now: () => now,
    fetch: async () => [],
    atOf: r => r.date,
    changedSince: async () => { calls++; if (calls === 1) throw new Error('offline'); return [{ id: 'edited', date: 1 }] },
  })
  await cache.fetchRange(0, 10)
  now += 61_000
  await expect(cache.fetchRange(0, 10)).rejects.toThrow('offline')
  expect(await cache.fetchRange(0, 10)).toEqual([{ id: 'edited', date: 1 }])
  expect(calls).toBe(2)
})
