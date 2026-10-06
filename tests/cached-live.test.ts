// Release hardening: the device cache behind the big listeners (data/cachedLive).
import { describe, expect, test, vi } from 'vitest'
import { cachedListen, isFresh, CACHE_MAX_AGE_MS, type CacheRecord, type CachedListenDeps } from '../src/data/cachedLive'
import type { SinceFilter } from '../src/backend/types'

type D = { id: string; updatedAt: number; date?: number; qty?: number }
const NOW = 1_800_000_000_000

function harness(initial?: CacheRecord<D>) {
  let saved = initial
  const subs: { since: SinceFilter | undefined; cb: (d: D[]) => void }[] = []
  const deps: CachedListenDeps<D> = {
    subscribe: (cb, since) => {
      subs.push({ since, cb })
      return () => {}
    },
    load: async () => saved,
    save: async (r) => {
      saved = r
    },
    now: () => NOW,
  }
  return { deps, subs, saved: () => saved }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('cachedListen', () => {
  test('no cache: reads in full, then keeps what it read', async () => {
    const h = harness()
    const got: D[][] = []
    cachedListen(h.deps, { field: 'updatedAt', epoch: 3 }, (d) => got.push(d), () => {})
    await vi.waitFor(() => expect(h.subs).toHaveLength(1))
    expect(h.subs[0].since).toBeUndefined()
    h.subs[0].cb([{ id: 'a', updatedAt: NOW - 10 }, { id: 'b', updatedAt: NOW - 5 }])
    await new Promise((r) => setTimeout(r, 1100)) // saved a second after the last change
    await flush()
    expect(h.saved()).toMatchObject({ epoch: 3, maxField: NOW - 5, docs: [{ id: 'a' }, { id: 'b' }] })
  })

  test('a fresh cache: shown at once, and only what changed since (less the margin) is asked for', async () => {
    const h = harness({ v: 1, epoch: 3, fullAt: NOW - 3_600_000, coverFrom: null, maxField: NOW - 60_000, docs: [{ id: 'a', updatedAt: NOW - 60_000, qty: 1 }] })
    const got: [D[], string][] = []
    cachedListen(h.deps, { field: 'updatedAt', epoch: 3, marginMs: 30_000 }, (d, from) => got.push([d, from]), () => {})
    await vi.waitFor(() => expect(h.subs).toHaveLength(1))
    expect(got[0]).toEqual([[{ id: 'a', updatedAt: NOW - 60_000, qty: 1 }], 'cache'])
    expect(h.subs[0].since).toEqual({ field: 'updatedAt', value: NOW - 90_000 })
    h.subs[0].cb([{ id: 'a', updatedAt: NOW - 1, qty: 7 }, { id: 'c', updatedAt: NOW - 1 }])
    expect(got[1][0].map((d) => [d.id, d.qty])).toEqual([['a', 7], ['c', undefined]])
  })

  test('read in full again when the epoch moved, the cache is a week old, or the window widened', () => {
    const rec: CacheRecord<D> = { v: 1, epoch: 3, fullAt: NOW - 1000, coverFrom: 500, maxField: NOW, docs: [] }
    expect(isFresh(rec, { field: 'updatedAt', epoch: 3, window: { field: 'date', value: 600 } }, NOW)).toBe(true)
    expect(isFresh(rec, { field: 'updatedAt', epoch: 4 }, NOW)).toBe(false)
    expect(isFresh({ ...rec, fullAt: NOW - CACHE_MAX_AGE_MS - 1 }, { field: 'updatedAt', epoch: 3 }, NOW)).toBe(false)
    expect(isFresh(rec, { field: 'updatedAt', epoch: 3, window: { field: 'date', value: 400 } }, NOW)).toBe(false)
    expect(isFresh(undefined, { field: 'updatedAt', epoch: 0 }, NOW)).toBe(false)
  })

  test('a writer clock running ahead cannot push the delta point into the future', async () => {
    const h = harness({ v: 1, epoch: 0, fullAt: NOW, coverFrom: null, maxField: NOW + 86_400_000, docs: [] })
    cachedListen(h.deps, { field: 'updatedAt', epoch: 0, marginMs: 0 }, () => {}, () => {})
    await vi.waitFor(() => expect(h.subs).toHaveLength(1))
    expect(h.subs[0].since?.value).toBe(NOW)
  })

  test('a windowed cache shows and keeps only the window', async () => {
    const h = harness({ v: 1, epoch: 0, fullAt: NOW, coverFrom: 100, maxField: NOW, docs: [{ id: 'old', updatedAt: NOW, date: 50 }, { id: 'in', updatedAt: NOW, date: 200 }] })
    const got: D[][] = []
    cachedListen(h.deps, { field: 'updatedAt', epoch: 0, window: { field: 'date', value: 150 } }, (d) => got.push(d), () => {})
    await vi.waitFor(() => expect(got).toHaveLength(1))
    expect(got[0].map((d) => d.id)).toEqual(['in'])
  })
})
