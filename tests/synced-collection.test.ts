import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { mergeDelta, newestStamp } = await import('../src/data/syncedCollection')

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
