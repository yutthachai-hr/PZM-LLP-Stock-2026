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
const { captureFilingScope, editMovement, filing, receiveStock, voidMovement } = await import('../src/services/stock')
const { brandEpoch, setActiveBrand } = await import('../src/brand/brand')
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
    noteWritten([row('a', { qty: 1 })], brandEpoch())
    noteWritten([row('a', { qty: 2 }), row('b')], brandEpoch())
    off()
    noteWritten([row('c')], brandEpoch())
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
    await voidMovement(id, ACTOR, 'test cancellation')
    expect(seen.at(-1)![0]).toMatchObject({ id, voided: true })
  })

  test('a failed receipt notes nothing', async () => {
    const seen: Mv[][] = []
    subscribeRecentWrites((rows) => seen.push(rows))
    await expect(receiveStock({ toLocationId: 'nowhere', lines: [{ productId: 'p1', productName: 'P', unit: 'EA', qty: 3 }], actor: ACTOR, date: Date.now() })).rejects.toThrow()
    expect(seen).toEqual([])
  })
})

describe('brand switching and generation guard', () => {
  test('a row noted under brand A is not delivered to a subscriber after a switch to B', () => {
    setActiveBrand('pizza')
    noteWritten([row('pizza-1')], brandEpoch())

    const seen: Mv[][] = []
    const off = subscribeRecentWrites((rows) => seen.push(rows))

    // Switch to brand B
    setActiveBrand('lelapin')

    // Switching brands must immediately emit the empty list
    expect(seen.at(-1)).toEqual([])

    // Subsequent write in brand B emits only brand B rows
    noteWritten([row('lapin-1')], brandEpoch())
    expect(seen.at(-1)?.map((m) => m.id)).toEqual(['lapin-1'])

    // Live overlay in brand B must not contain brand A's movement
    const live = [row('lapin-live')]
    const overlaid = overlayRecent(live, seen.at(-1)!)
    expect(overlaid.map((m) => m.id)).toEqual(['lapin-live', 'lapin-1'])
    expect(overlaid.map((m) => m.id)).not.toContain('pizza-1')

    off()
  })

  test('a subscriber mounting after brand switch sees no prior brand movements', () => {
    setActiveBrand('pizza')
    noteWritten([row('pizza-prior')], brandEpoch())

    setActiveBrand('lelapin')

    let lapinRecent: Mv[] = []
    const off = subscribeRecentWrites((rows) => {
      lapinRecent = rows
    })

    noteWritten([row('lapin-subsequent')], brandEpoch())

    expect(lapinRecent.map((m) => m.id)).toEqual(['lapin-subsequent'])
    expect(overlayRecent([], lapinRecent).map((m) => m.id)).toEqual(['lapin-subsequent'])

    off()
  })

  test('a late note from a pre-switch transaction is dropped by the generation guard', () => {
    setActiveBrand('pizza')
    const epoch = brandEpoch()

    // Transaction commits late, after brand switch to lelapin
    setActiveBrand('lelapin')

    const seen: Mv[][] = []
    const off = subscribeRecentWrites((rows) => seen.push(rows))

    // Late noteWritten carrying the pre-switch epoch
    noteWritten([row('pizza-late')], epoch)

    // The late note must be ignored: no emissions to brand B subscribers
    expect(seen).toHaveLength(0)

    // Current brand writes still work normally
    noteWritten([row('lapin-1')], brandEpoch())
    expect(seen.at(-1)?.map((m) => m.id)).toEqual(['lapin-1'])

    off()
  })

  test('an in-flight filing from brand A that commits after switch to brand B is dropped', async () => {
    setActiveBrand('pizza')
    let fileFn!: (mv: Omit<Mv, 'id'>) => void
    let resolveTx!: () => void
    const txPromise = new Promise<void>((resolve) => {
      resolveTx = resolve
    })

    const filingPromise = filing(captureFilingScope(), async (_tx, file) => {
      fileFn = file
      await txPromise
    })

    await vi.waitFor(() => expect(fileFn).toBeDefined())
    fileFn({ docNo: 'RC-PIZZA', type: 'receive', productId: 'p1', productName: 'P', unit: 'EA', qty: 5, date: 1 } as any)

    const seen: Mv[][] = []
    const off = subscribeRecentWrites((rows) => seen.push(rows))

    // Switch brand while transaction is pending
    setActiveBrand('lelapin')

    // Now transaction commits
    resolveTx()
    await filingPromise

    // Brand B subscriber received the brand-switch empty reset, but nothing from the brand A filing
    expect(seen.flat()).toHaveLength(0)
    off()
  })
})

