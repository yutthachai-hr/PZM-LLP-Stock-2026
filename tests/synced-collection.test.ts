import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { mergeDelta, newestStamp, copyIsCurrent } = await import('../src/data/syncedCollection')

/** The delta merge behind useSynced (products, stock balances): perf/firestore-read-budget. */
type D = { id: string; updatedAt?: number; qty?: number }

describe('synced collection merge', () => {
  test('changed documents replace the held copy; untouched ones stay', () => {
    const held = new Map<string, D>([['a', { id: 'a', updatedAt: 1, qty: 1 }], ['b', { id: 'b', updatedAt: 2, qty: 2 }]])
    mergeDelta(held, new Set(), [{ id: 'b', updatedAt: 9, qty: 5 }])
    expect([...held.values()]).toEqual([{ id: 'a', updatedAt: 1, qty: 1 }, { id: 'b', updatedAt: 9, qty: 5 }])
  })
  test('a new document joins', () => {
    const held = new Map<string, D>()
    mergeDelta(held, new Set(), [{ id: 'c', updatedAt: 3 }])
    expect(held.has('c')).toBe(true)
  })
  test('a document that leaves the window was deleted and goes; one never in it is kept', () => {
    const held = new Map<string, D>([['old', { id: 'old', updatedAt: 1 }]])
    let win = mergeDelta(held, new Set(), [{ id: 'x', updatedAt: 5 }, { id: 'y', updatedAt: 6 }])
    win = mergeDelta(held, win, [{ id: 'y', updatedAt: 6 }])
    expect(held.has('x')).toBe(false)
    expect(held.has('old')).toBe(true)
    expect([...win]).toEqual(['y'])
  })
  test('the cursor is the newest stamp held; unstamped documents do not move it', () => {
    expect(newestStamp([{ id: 'a', updatedAt: 4 }, { id: 'b' }, { id: 'c', updatedAt: 9 }])).toBe(9)
    expect(newestStamp([])).toBe(0)
  })
})

// Integration (8 Oct 2026): main's device copies follow the brand's cache epoch, so an admin's
// restore, delete or correction (which moves no timestamp) is read whole again everywhere.
describe('device copy: when it may be used as it is', () => {
  const DAYMS = 86_400_000
  test('fresh enough and no epoch followed: used', () => {
    expect(copyIsCurrent({ fullAt: 1000 }, 1000 + DAYMS - 1, DAYMS, undefined)).toBe(true)
  })
  test('too old: read whole', () => {
    expect(copyIsCurrent({ fullAt: 1000 }, 1000 + DAYMS, DAYMS, undefined)).toBe(false)
  })
  test('no copy: read whole', () => {
    expect(copyIsCurrent(null, 1, DAYMS, undefined)).toBe(false)
  })
  test('read under another epoch (an admin restored or deleted since): read whole', () => {
    expect(copyIsCurrent({ fullAt: 1000, epoch: 3 }, 2000, DAYMS, 4)).toBe(false)
    expect(copyIsCurrent({ fullAt: 1000 }, 2000, DAYMS, 0)).toBe(false)
    expect(copyIsCurrent({ fullAt: 1000, epoch: 4 }, 2000, DAYMS, 4)).toBe(true)
  })
})
