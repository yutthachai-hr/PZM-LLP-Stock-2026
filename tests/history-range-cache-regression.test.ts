import { test, expect, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = {
    location: { reload() {} },
    addEventListener() {},
    removeEventListener() {},
  }
})

import { createRangeCache } from '../src/data/rangeCache'
import { setActiveBrand } from '../src/brand/brand'
import { transferCache } from '../src/data/transferCache'
import { orderCache } from '../src/data/orderCache'
import { requestCache } from '../src/data/requestCache'
import { clearEventCache, fetchRange as fetchEventsRange } from '../src/data/eventCache'
import { messageCache } from '../src/services/messages'
import { backend } from '../src/backend'

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

test('transferCache carries its starting brand through the queue even if brand switches before execution', async () => {
  transferCache.clear()
  setActiveBrand('pizza')

  const originalForBrand = backend.forBrand.bind(backend)
  vi.spyOn(backend, 'forBrand').mockImplementation((b: any) => {
    const inst = originalForBrand(b)
    return {
      ...inst,
      getRange: async (_col: any, _field: any, from: number, _to: number) => {
        return [{ id: `tr-${b}`, createdAt: from } as any]
      },
    }
  })

  // Start fetch under 'pizza'
  const p1 = transferCache.fetchRange(100, 200)

  // Switch to 'lelapin' while queued before fetch executes
  setActiveBrand('lelapin')

  const rows = await p1
  vi.restoreAllMocks()

  // Must have fetched pizza data, not lelapin data!
  expect(rows).toEqual([{ id: 'tr-pizza', createdAt: 100 }])
})

test('all non-movement caches (order, request, event, message) carry starting brand through queued fetch', async () => {
  orderCache.clear()
  requestCache.clear()
  clearEventCache()
  messageCache.clear()

  const originalForBrand = backend.forBrand.bind(backend)
  vi.spyOn(backend, 'forBrand').mockImplementation((b: any) => {
    const inst = originalForBrand(b)
    return {
      ...inst,
      getRange: async (_col: any, _field: any, from: number, _to: number) => {
        return [{ id: `row-${b}`, createdAt: from, orderedAt: from, startAt: from, title: 'Event' } as any]
      },
    }
  })

  // Start fetches under 'pizza'
  setActiveBrand('pizza')
  const pOrder = orderCache.fetchRange(100, 200)
  const pRequest = requestCache.fetchRange(100, 200)
  const pEvent = fetchEventsRange(100, 200)
  const pMsg = messageCache.fetchRange(100, 200)

  // Switch to 'lelapin' while queued
  setActiveBrand('lelapin')

  const [orders, requests, events, msgs] = await Promise.all([pOrder, pRequest, pEvent, pMsg])
  vi.restoreAllMocks()

  expect(orders[0].id).toBe('row-pizza')
  expect(requests[0].id).toBe('row-pizza')
  expect(events[0].id).toBe('row-pizza')
  expect(msgs[0].id).toBe('row-pizza')
})
