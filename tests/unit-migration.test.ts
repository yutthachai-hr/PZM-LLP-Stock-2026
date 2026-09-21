// Folding the old per-unit balances into the product's own unit (Settings → ดูแลข้อมูล).
//
//   npm test
//
// Rows filed under the rule of 13–20 Sep 2026 sit on their own `#Unit` balance. Once the
// owner states the rate, the tool converts them one product at a time, signs each row,
// and rebuilds the product's balances. Nothing is guessed; running twice changes nothing.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, memoryBackend, failWritesWhere } = await import('./helpers/memory-backend')
const { listUnitMigration, migrateProductUnits } = await import('../src/services/unitMigration')
const { findLevelDrift, receiveStock, issueStock } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-admin', name: 'Admin' }
const MAIN = 'loc-main'
const BRANCH = 'loc-branch'

function legacyMovement(id: string, qty: number, entryUnit: string, over: Record<string, unknown> = {}) {
  return { id, docNo: 'RC-00000', type: 'receive', productId: 'p1', productName: 'Prawn', unit: 'KG', ...(entryUnit ? { entryUnit } : {}), qty, toLocationId: MAIN, date: 1, byUserId: 'old', byUserName: 'Old', createdAt: 1, ...over }
}
const level = (id: string, locationId: string, qty: number, unit?: string) => ({ id, productId: 'p1', locationId, ...(unit ? { unit } : {}), qty, updatedAt: 1, updatedBy: 'old' })
const levels = () => raw('stockLevels') as { id: string; qty: number }[]
const qtyFor = (id: string) => levels().find((l) => l.id === id)?.qty ?? 0
const movements = () => raw('stockMovements') as Record<string, unknown>[]

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seed('products', [{ id: 'p1', sku: 'A-1', name: 'Prawn', category: 'Seafood', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
  seed('locations', [
    { id: MAIN, name: 'Main', type: 'warehouse', active: true, createdAt: 1 },
    { id: BRANCH, name: 'Branch', type: 'branch', active: true, createdAt: 1 },
  ])
  // 10 Pack received, 3 Pack sent to the branch — the books as the old rule left them.
  seed('stockMovements', [
    legacyMovement('m0', 4, ''),
    legacyMovement('m1', 10, 'Pack'),
    legacyMovement('m2', 3, 'Pack', { type: 'issue', docNo: 'IS-00000', fromLocationId: MAIN, toLocationId: BRANCH }),
  ])
  seed('stockLevels', [level(`${MAIN}__p1#Pack`, MAIN, 7, 'Pack'), level(`${BRANCH}__p1#Pack`, BRANCH, 3, 'Pack'), level(`${MAIN}__p1`, MAIN, 4)])
})

describe('finding what is left to convert', () => {
  test('lists the product, its legacy balances, and that the rate is missing', async () => {
    const [c] = await listUnitMigration()
    expect(c).toMatchObject({ productId: 'p1', unitType: 'KG', legacyMovements: 2, blockedUnits: ['Pack'] })
    expect(c.rows).toEqual(expect.arrayContaining([{ locationId: MAIN, unit: 'Pack', qty: 7 }, { locationId: BRANCH, unit: 'Pack', qty: 3 }]))
    expect(c.factors).toEqual({ Pack: null })
  })

  test('converting without a rate is refused by name', async () => {
    await expect(migrateProductUnits({ productId: 'p1', actor: ACTOR })).rejects.toThrow(/Pack/)
    expect(qtyFor(`${MAIN}__p1#Pack`)).toBe(7)
  })
})

describe('converting once the rate is stated', () => {
  beforeEach(async () => {
    await memoryBackend.update('products', 'p1', { unitConversions: [{ label: 'Pack', size: 2 }] })
  })

  test('every legacy row gets its base quantity and a signed edit; the balances fold into KG', async () => {
    expect((await listUnitMigration())[0].factors).toEqual({ Pack: 2 })
    const r = await migrateProductUnits({ productId: 'p1', actor: ACTOR })
    expect(r.converted).toBe(2)
    const m1 = movements().find((m) => m.id === 'm1')!
    expect(m1).toMatchObject({ entryUnit: 'Pack', entryQty: 10, qty: 20 })
    const [edit] = m1.edits as { by: string; changes: { field: string; from: string; to: string }[] }[]
    expect(edit.by).toBe(ACTOR.id)
    expect(edit.changes).toEqual([{ field: 'entryQty', from: '10 Pack', to: '10 Pack (= 20 KG)' }])
    // 4 KG already on the base row + (10 − 3) Pack × 2 = 18 at main; 3 Pack × 2 = 6 at the branch.
    expect(qtyFor(`${MAIN}__p1`)).toBe(18)
    expect(qtyFor(`${BRANCH}__p1`)).toBe(6)
    expect(qtyFor(`${MAIN}__p1#Pack`)).toBe(0)
    expect(qtyFor(`${BRANCH}__p1#Pack`)).toBe(0)
    expect(await findLevelDrift()).toEqual([])
    expect(await listUnitMigration()).toEqual([])
  })

  test('running it again converts nothing and adds no edits', async () => {
    await migrateProductUnits({ productId: 'p1', actor: ACTOR })
    const r = await migrateProductUnits({ productId: 'p1', actor: ACTOR })
    expect(r.converted).toBe(0)
    expect((movements().find((m) => m.id === 'm1')!.edits as unknown[]).length).toBe(1)
    expect(qtyFor(`${MAIN}__p1`)).toBe(18)
  })

  test('a run that stops halfway is finished by the next one, with no row converted twice', async () => {
    // The second legacy row's write fails; the first has already been converted.
    failWritesWhere((col, id) => col === 'stockMovements' && id === 'm2')
    await expect(migrateProductUnits({ productId: 'p1', actor: ACTOR })).rejects.toThrow()
    failWritesWhere(() => false)
    const r = await migrateProductUnits({ productId: 'p1', actor: ACTOR })
    expect(r.converted).toBe(1)
    for (const id of ['m1', 'm2']) {
      const m = movements().find((x) => x.id === id)!
      expect((m.edits as unknown[]).length).toBe(1)
      expect(m.entryQty).toBeDefined()
    }
    expect(qtyFor(`${MAIN}__p1`)).toBe(18)
    expect(await findLevelDrift()).toEqual([])
  })

  test('the converted stock is ordinary KG afterwards: it can be issued in KG or in Pack', async () => {
    await migrateProductUnits({ productId: 'p1', actor: ACTOR })
    await issueStock({ fromLocationId: MAIN, toLocationId: BRANCH, lines: [{ productId: 'p1', productName: 'Prawn', unit: 'KG', qty: 5 }], actor: ACTOR, date: Date.now() })
    await receiveStock({ toLocationId: MAIN, lines: [{ productId: 'p1', productName: 'Prawn', unit: 'KG', entryUnit: 'Pack', entryQty: 1, qty: 2 }], actor: ACTOR, date: Date.now() })
    expect(qtyFor(`${MAIN}__p1`)).toBe(15)
    expect(qtyFor(`${BRANCH}__p1`)).toBe(11)
    expect(await findLevelDrift()).toEqual([])
  })
})
