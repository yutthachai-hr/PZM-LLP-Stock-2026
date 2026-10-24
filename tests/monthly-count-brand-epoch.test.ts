import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Backend, TxContext } from '../src/backend/types'
import { resolveCollection, setActiveBrand, type BrandId } from '../src/brand/brand'
import { COL, type MonthlyCount, type StockMovement } from '../src/types'
import { createMemoryBackend, memoryBackend, raw, resetMemory, seed } from './helpers/memory-backend'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { postMonthlyCount } = await import('../src/services/monthlyCounts')
const { resetRecentWrites, subscribeRecentWrites } = await import('../src/data/recentWrites')
const brands: BrandId[] = ['pizza', 'lelapin', 'rnd']
const actor = { id: 'manager-fixture', name: 'Manager fixture' }
const locationId = 'loc-main'
const sheetId = 'shared-sheet-id'
const date = Date.UTC(2026, 8, 30)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  resetRecentWrites()
  for (const brand of brands) {
    seed(resolveCollection(COL.products, brand), ['p1', 'p2'].map((id) => ({
      id, sku: id, name: `${brand}-${id}`, category: 'c', unit: 'each', unitType: 'EA',
      minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1,
    })))
    seed(resolveCollection(COL.locations, brand), [{ id: locationId, name: brand, type: 'warehouse', active: true, createdAt: 1 }])
    seed(resolveCollection(COL.monthlyCounts, brand), [{
      id: sheetId, locationId, month: '2026-09', countDate: date, status: 'counting', lines: {},
      createdBy: actor.id, createdByName: actor.name, createdAt: 1, updatedAt: 1,
    }])
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  resetRecentWrites()
})

describe('the regression backend actually pins a namespace', () => {
  test.each(brands)('%s stays pinned when global brand changes, including colliding IDs', async (source) => {
    const db = createMemoryBackend(source)
    setActiveBrand(brands.find((b) => b !== source)!)
    expect(await db.getOne(COL.products, 'p1')).toMatchObject({ name: `${source}-p1` })
    await db.transaction(async (tx) => {
      expect(await tx.get(COL.products, 'p2')).toMatchObject({ name: `${source}-p2` })
      tx.set(COL.counters, 'pin-proof', { value: 7 })
    })
    for (const brand of brands) {
      expect(raw(resolveCollection(COL.counters, brand))).toEqual(brand === source ? [{ id: 'pin-proof', value: 7 }] : [])
    }
  })
})

const cases = [
  ...brands.flatMap((source) => brands.map((target) => ({ source, target, bounce: false }))),
  ...brands.map((source) => ({ source, target: source, bounce: true })),
]
describe('actual multipart monthly posting across brand generations', () => {
  test.each(cases)('$source -> $target (away-and-back=$bounce): origin commits and correct overlay', async ({ source, target, bounce }) => {
    setActiveBrand(source)
    const committed = deferred()
    const release = deferred()
    let transactions = 0
    vi.spyOn(memoryBackend, 'forBrand').mockImplementation((brand) => {
      const pinned = createMemoryBackend(brand)
      const gated: Backend = {
        ...pinned,
        async transaction<R>(run: (tx: TxContext) => Promise<R>): Promise<R> {
          const result = await pinned.transaction(run)
          if (++transactions === 1) {
            // Part one is physically committed; filing has not yet returned to the loop.
            committed.resolve()
            await release.promise
          }
          return result
        },
      }
      return gated
    })
    const seen: StockMovement[][] = []
    const off = subscribeRecentWrites((rows) => seen.push(rows))
    const posting = postMonthlyCount({
      id: sheetId, actor, note: 'synthetic monthly count', results: {},
      parts: [
        [{ productId: 'p1', productName: `${source}-p1`, unit: 'EA', diff: 3, expectedLevel: 0 }],
        [{ productId: 'p2', productName: `${source}-p2`, unit: 'EA', diff: 5, expectedLevel: 0 }],
      ],
    })
    try {
      await Promise.race([
        committed.promise,
        posting.then(() => { throw new Error('Posting finished without reaching transaction gate') }),
      ])
      expect(raw(resolveCollection(COL.movements, source))).toHaveLength(1)
      if (bounce) setActiveBrand(brands.find((b) => b !== source)!)
      setActiveBrand(target)
      release.resolve()
      const docNos = await posting
      expect(docNos).toHaveLength(2)
      expect(new Set(docNos).size).toBe(2)
      expect(transactions).toBe(2)
      for (const brand of brands) {
        const movements = raw(resolveCollection(COL.movements, brand))
        const levels = raw(resolveCollection(COL.stockLevels, brand))
        const sheet = await createMemoryBackend(brand).getOne<MonthlyCount>(COL.monthlyCounts, sheetId)
        if (brand === source) {
          expect(movements.map((m) => [m.productId, m.qty])).toEqual([['p1', 3], ['p2', 5]])
          expect(levels.map((l) => [l.productId, l.qty])).toEqual([['p1', 3], ['p2', 5]])
          expect(sheet).toMatchObject({ status: 'posted', postedIds: ['p1', 'p2'], adjDocNos: docNos })
        } else {
          expect(movements).toEqual([])
          expect(levels).toEqual([])
          expect(sheet).toMatchObject({ status: 'counting' })
          expect(sheet?.postedIds).toBeUndefined()
        }
      }
      // Checked last: overlay failures cannot be hidden by a faulty DB-pinning double.
      if (source === target && !bounce) {
        expect(seen.at(-1)?.map((m) => [m.productId, m.qty])).toEqual([['p1', 3], ['p2', 5]])
      } else {
        expect(seen.flat()).toEqual([])
      }
    } finally {
      release.resolve()
      off()
      await posting.catch(() => {})
    }
  })
})
