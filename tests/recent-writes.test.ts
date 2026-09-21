// A row this device just wrote shows at once, until the listener carries it itself.
//
//   npm test
//
// The stock engine files rows inside transactions, which Firestore does not echo locally;
// the person keying a delivery note saw their line vanish and come back "a while later"
// (owner, 21 Sep 2026). The screen lays the noted rows over the live list meanwhile.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed } = await import('./helpers/memory-backend')
const { noteWritten, overlayRecent, resetRecentWrites, subscribeRecentWrites } = await import('../src/data/recentWrites')
const { editMovement, receiveStock, voidMovement } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')
type Mv = import('../src/types').StockMovement

const ACTOR = { id: 'u1', name: 'AA' }
const MAIN = 'loc-main'
const row = (id: string, over: Partial<Mv> = {}): Mv =>
  ({ id, docNo: 'RC-1', type: 'receive', productId: 'p1', productName: 'P', unit: 'EA', qty: 1, toLocationId: MAIN, date: 1, byUserId: 'x', byUserName: 'x', createdAt: 1, ...over }) as Mv

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  resetRecentWrites()
})

describe('laying noted rows over the live list', () => {
  test('a row the listener has not got yet is added; one it has, and is as new, is not doubled', () => {
    const live = [row('a')]
    expect(overlayRecent(live, [row('b')]).map((m) => m.id)).toEqual(['a', 'b'])
    expect(overlayRecent(live, [row('a')])).toBe(live)
  })

  test('a newer noted version replaces the live one; an older one does not mask a later change', () => {
    const live = [row('a', { qty: 1, updatedAt: 10 })]
    expect(overlayRecent(live, [row('a', { qty: 5, updatedAt: 20 })])[0].qty).toBe(5)
    expect(overlayRecent(live, [row('a', { qty: 5, updatedAt: 5 })])[0].qty).toBe(1)
  })

  test('subscribers hear every note, latest note of an id winning', () => {
    const seen: Mv[][] = []
    const off = subscribeRecentWrites((rows) => seen.push(rows))
    noteWritten([row('a', { qty: 1 })])
    noteWritten([row('a', { qty: 2 }), row('b')])
    off()
    noteWritten([row('c')])
    expect(seen).toHaveLength(2)
    expect(seen[1].map((m) => [m.id, m.qty])).toEqual([['a', 2], ['b', 1]])
  })
})

describe('the stock engine notes what it files', () => {
  beforeEach(() => {
    seed('products', [{ id: 'p1', sku: 'S', name: 'P', category: 'c', unit: 'each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
    seed('locations', [{ id: MAIN, name: 'Main', type: 'warehouse', active: true, createdAt: 1 }])
  })

  test('a receipt, its edit and its void each arrive the moment they commit', async () => {
    const seen: Mv[][] = []
    subscribeRecentWrites((rows) => seen.push(rows))
    const docNo = await receiveStock({ toLocationId: MAIN, lines: [{ productId: 'p1', productName: 'P', unit: 'EA', qty: 3 }], actor: ACTOR, date: Date.now() })
    expect(seen.at(-1)!.map((m) => [m.docNo, m.qty])).toEqual([[docNo, 3]])
    const id = seen.at(-1)![0].id
    await editMovement({ movementId: id, patch: { qty: 4 }, actor: ACTOR })
    expect(seen.at(-1)![0]).toMatchObject({ id, qty: 4, updatedBy: ACTOR.id })
    await voidMovement(id, ACTOR)
    expect(seen.at(-1)![0]).toMatchObject({ id, voided: true })
  })

  test('a failed receipt notes nothing', async () => {
    const seen: Mv[][] = []
    subscribeRecentWrites((rows) => seen.push(rows))
    await expect(receiveStock({ toLocationId: 'nowhere', lines: [{ productId: 'p1', productName: 'P', unit: 'EA', qty: 3 }], actor: ACTOR, date: Date.now() })).rejects.toThrow()
    expect(seen).toEqual([])
  })
})
