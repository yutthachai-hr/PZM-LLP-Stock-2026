// The calendar's read budget, asserted rather than hoped for.
//
//   npm test
//
// Firebase's free plan gives both companies 50,000 document reads a day between them, and
// the shared tablets clear their offline copy on idle sign-out — so nearly every session
// pays full price for whatever the app loads. These tests pin the two properties that keep
// the calendar cheap: a range is read once, and a write never causes a re-read.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, memoryBackend } = await import('./helpers/memory-backend')
const { createEvent, dayBounds, monthGridBounds } = await import('../src/services/events')
const cache = await import('../src/data/eventCache')
const { setActiveBrand } = await import('../src/brand/brand')

const ADMIN = 'uid-admin'
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).getTime()

/** Counts trips to the backend, which is what a Firestore read is billed on. */
function countReads() {
  return vi.spyOn(memoryBackend, 'getRange')
}

beforeEach(() => {
  resetMemory()
  cache.clearEventCache()
  setActiveBrand('pizza')
  vi.restoreAllMocks()
})

const BASE = {
  title: 'นับสต๊อก',
  type: 'stockCount' as const,
  priority: 'normal' as const,
  startAt: at(2026, 8, 15),
}

describe('reading a range', () => {
  test('a range already read is served from memory', async () => {
    await createEvent(BASE, ADMIN)
    const reads = countReads()
    const { from, to } = monthGridBounds(2026, 8)

    await cache.fetchRange(from, to)
    await cache.fetchRange(from, to)
    await cache.fetchRange(from, to)

    expect(reads).toHaveBeenCalledTimes(1)
  })

  test('paging away and back costs one read, not two', async () => {
    await createEvent(BASE, ADMIN)
    const reads = countReads()
    const sep = monthGridBounds(2026, 8)
    const oct = monthGridBounds(2026, 9)

    await cache.fetchRange(sep.from, sep.to)
    await cache.fetchRange(oct.from, oct.to)
    await cache.fetchRange(sep.from, sep.to) // back to September

    expect(reads).toHaveBeenCalledTimes(2)
  })

  test('force re-reads, for the one case that needs it', async () => {
    const reads = countReads()
    const { from, to } = monthGridBounds(2026, 8)
    await cache.fetchRange(from, to)
    await cache.fetchRange(from, to, { force: true })
    expect(reads).toHaveBeenCalledTimes(2)
  })

  test('the other brand is a different cache, never the same answer', async () => {
    await createEvent(BASE, ADMIN)
    const { from, to } = monthGridBounds(2026, 8)
    expect(await cache.fetchRange(from, to)).toHaveLength(1)

    setActiveBrand('lelapin')
    // Must not hand Le Lapin Pizza Mania's plan out of a cache keyed only by date.
    expect(await cache.fetchRange(from, to)).toEqual([])
  })
})

describe('a write does not cause a read', () => {
  test('a new event folds into every cached range it belongs to', async () => {
    const sep = monthGridBounds(2026, 8)
    const oct = monthGridBounds(2026, 9)
    await cache.fetchRange(sep.from, sep.to)
    await cache.fetchRange(oct.from, oct.to)

    const reads = countReads()
    cache.patchEvent({
      ...BASE,
      id: 'e1',
      status: 'upcoming',
      createdBy: ADMIN,
      createdAt: 1,
      updatedAt: 1,
    })

    expect(reads).not.toHaveBeenCalled()
    expect(cache.peekRange(sep.from, sep.to)?.map((e) => e.id)).toEqual(['e1'])
    // September's grid ends before mid-September's event could reach October.
    expect(cache.peekRange(oct.from, oct.to)?.map((e) => e.id)).toEqual([])
  })

  test('moving an event to another month takes it out of the old one', async () => {
    const sep = monthGridBounds(2026, 8)
    const nov = monthGridBounds(2026, 10)
    await cache.fetchRange(sep.from, sep.to)
    await cache.fetchRange(nov.from, nov.to)

    const event = {
      ...BASE,
      id: 'e1',
      status: 'upcoming' as const,
      createdBy: ADMIN,
      createdAt: 1,
      updatedAt: 1,
    }
    cache.patchEvent(event)
    expect(cache.peekRange(sep.from, sep.to)?.map((e) => e.id)).toEqual(['e1'])

    // Rescheduled into November — it must not be listed in both.
    cache.patchEvent({ ...event, startAt: at(2026, 10, 12) })
    expect(cache.peekRange(sep.from, sep.to)?.map((e) => e.id)).toEqual([])
    expect(cache.peekRange(nov.from, nov.to)?.map((e) => e.id)).toEqual(['e1'])
  })

  test('deleting drops it from every range', async () => {
    const sep = monthGridBounds(2026, 8)
    const day = dayBounds(at(2026, 8, 15))
    await cache.fetchRange(sep.from, sep.to)
    await cache.fetchRange(day.from, day.to)

    const event = {
      ...BASE,
      id: 'e1',
      status: 'upcoming' as const,
      createdBy: ADMIN,
      createdAt: 1,
      updatedAt: 1,
    }
    cache.patchEvent(event)
    expect(cache.peekRange(day.from, day.to)?.map((e) => e.id)).toEqual(['e1'])

    cache.removeEvent('e1')
    expect(cache.peekRange(sep.from, sep.to)).toEqual([])
    expect(cache.peekRange(day.from, day.to)).toEqual([])
  })

  test('a patched range stays in date order', async () => {
    const sep = monthGridBounds(2026, 8)
    await cache.fetchRange(sep.from, sep.to)
    const mk = (id: string, day: number) => ({
      ...BASE,
      id,
      startAt: at(2026, 8, day),
      status: 'upcoming' as const,
      createdBy: ADMIN,
      createdAt: 1,
      updatedAt: 1,
    })
    cache.patchEvent(mk('late', 20))
    cache.patchEvent(mk('early', 3))
    expect(cache.peekRange(sep.from, sep.to)?.map((e) => e.id)).toEqual(['early', 'late'])
  })
})

describe('listeners', () => {
  test('a change tells whoever is showing a count, without a read', async () => {
    const { from, to } = dayBounds(at(2026, 8, 15))
    await cache.fetchRange(from, to)

    let fired = 0
    const off = cache.subscribeCache(() => fired++)
    const reads = countReads()

    cache.patchEvent({
      ...BASE,
      id: 'e1',
      status: 'upcoming',
      createdBy: ADMIN,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(fired).toBe(1)
    cache.removeEvent('e1')
    expect(fired).toBe(2)
    expect(reads).not.toHaveBeenCalled()

    off()
    cache.removeEvent('e1')
    expect(fired).toBe(2)
  })
})
