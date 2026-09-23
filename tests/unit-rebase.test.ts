// Changing a product's own unit after history exists (Settings → เปลี่ยนหน่วยหลักของสินค้า).
//
//   npm test
//
// Two ways, per product (owner, 21 Sep 2026): by rate, when a piece has a known weight
// (Mozzarella 2.72 KG a piece); by recount, when it does not (Parma legs). Either way the
// history keeps what was keyed, every row is signed, and nothing is invented.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, failWritesWhere } = await import('./helpers/memory-backend')
const { previewRebase, rebaseProductUnit } = await import('../src/services/unitRebase')
const { findLevelDrift, issueStock, receiveStock } = await import('../src/services/stock')
const { entryFor } = await import('../src/lib/uom')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-admin', name: 'Admin' }
const MAIN = 'loc-main'
const BRANCH = 'loc-branch'
const mv = (id: string, over: Record<string, unknown>) => ({
  id, docNo: 'RC-00000', type: 'receive', productId: 'p1', productName: 'Mozzarella', unit: 'KG', toLocationId: MAIN, date: 1, byUserId: 'old', byUserName: 'Old', createdAt: 1, ...over,
})
const lvl = (loc: string, qty: number, unit?: string) => ({ id: `${loc}__p1${unit ? `#${unit}` : ''}`, productId: 'p1', locationId: loc, ...(unit ? { unit } : {}), qty, updatedAt: 1, updatedBy: 'old' })
const levels = () => raw('stockLevels') as { id: string; qty: number; unit?: string }[]
const qtyFor = (id: string) => levels().find((l) => l.id === id)?.qty ?? 0
const movements = () => raw('stockMovements') as Record<string, unknown>[]
const product = () => (raw('products') as Record<string, unknown>[])[0]

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seed('locations', [
    { id: MAIN, name: 'Main', type: 'warehouse', active: true, createdAt: 1 },
    { id: BRANCH, name: 'Branch', type: 'branch', active: true, createdAt: 1 },
  ])
})

describe('by rate: a KG product becomes an EA product at 2.72 KG a piece', () => {
  beforeEach(() => {
    seed('products', [{ id: 'p1', sku: 'M-1', name: 'Mozzarella', category: 'Cheese', unit: 'kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, unitConversions: [{ label: 'EA', size: 2.72 }, { label: 'Carton', size: 21.76 }] }])
    seed('stockMovements', [
      mv('r1', { qty: 27.2 }), // 10 pieces received by weight
      mv('r2', { qty: 5.44, entryUnit: 'EA', entryQty: 2 }), // 2 pieces keyed as EA under the new rule
      mv('i1', { type: 'issue', docNo: 'IS-00000', qty: 8.16, fromLocationId: MAIN, toLocationId: BRANCH }), // 3 pieces moved, by weight
    ])
    seed('stockLevels', [lvl(MAIN, 24.48), lvl(BRANCH, 8.16)])
  })

  test('the preview says what each site comes to, and whether it is whole', async () => {
    const p = await previewRebase({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72 })
    expect(p.sites).toEqual([
      { locationId: MAIN, locationName: 'Main', oldQty: 24.48, suggested: 9, whole: true },
      { locationId: BRANCH, locationName: 'Branch', oldQty: 8.16, suggested: 3, whole: true },
    ])
    expect(p.movements).toBe(3)
    expect(p.conversions).toEqual([{ label: 'KG', size: 1, per: 2.72 }, { label: 'Carton', size: 8 }])
  })

  test('every row keeps what was keyed and gains the piece count; balances are pieces', async () => {
    const r = await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, actor: ACTOR })
    expect(r).toEqual({ movements: 3, counted: 0, closed: 0 })
    const byId = Object.fromEntries(movements().map((m) => [m.id, m]))
    expect(byId.r1).toMatchObject({ unit: 'EA', entryUnit: 'KG', entryQty: 27.2, qty: 10 })
    expect(byId.r2).toMatchObject({ unit: 'EA', qty: 2 })
    expect(byId.r2.entryUnit).toBeUndefined()
    expect(byId.i1).toMatchObject({ unit: 'EA', entryUnit: 'KG', entryQty: 8.16, qty: 3 })
    expect((byId.r1.edits as { by: string; changes: { from: string; to: string }[] }[])[0]).toMatchObject({ by: ACTOR.id, changes: [{ from: '27.2 KG', to: '27.2 KG (= 10 EA)' }] })
    expect(product()).toMatchObject({ unitType: 'EA', unit: 'each', unitConversions: [{ label: 'KG', size: 1, per: 2.72 }, { label: 'Carton', size: 8 }] })
    expect(qtyFor(`${MAIN}__p1`)).toBe(9)
    expect(qtyFor(`${BRANCH}__p1`)).toBe(3)
    expect(await findLevelDrift()).toEqual([])
  })

  test('afterwards the product is ordinary: issued by the piece, received by the kilo or the carton', async () => {
    await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, actor: ACTOR })
    const p = product() as { unitType: string; unitConversions: { label: string; size: number }[] }
    const line = (q: number, u?: string) => { const e = entryFor({ name: 'Mozzarella', ...p }, q, u); return { productId: 'p1', productName: 'Mozzarella', unit: 'EA', ...(e.entryUnit ? { entryUnit: e.entryUnit, entryQty: e.entryQty } : {}), qty: e.qty } }
    await issueStock({ fromLocationId: MAIN, toLocationId: BRANCH, lines: [line(4)], actor: ACTOR, date: Date.now() })
    await receiveStock({ toLocationId: MAIN, lines: [line(1, 'Carton'), line(5.44, 'KG')], actor: ACTOR, date: Date.now() })
    expect(qtyFor(`${MAIN}__p1`)).toBe(15)
    expect(qtyFor(`${BRANCH}__p1`)).toBe(7)
    expect(await findLevelDrift()).toEqual([])
  })

  test('a balance that does not come to whole pieces needs the owner\'s count, filed as an adjustment', async () => {
    seed('stockMovements', [mv('r3', { qty: 1 })]) // 1 KG more: main is now 25.48 KG = 9.368 EA
    seed('stockLevels', [lvl(MAIN, 25.48)])
    const p = await previewRebase({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72 })
    expect(p.sites[0]).toMatchObject({ suggested: 9.368, whole: false })
    await expect(rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, actor: ACTOR })).rejects.toThrow(/Main/)
    const r = await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, counts: { [MAIN]: 9 }, actor: ACTOR })
    expect(r.counted).toBe(1)
    expect(qtyFor(`${MAIN}__p1`)).toBe(9)
    const count = movements().find((m) => m.reason === 'opening')!
    expect(count).toMatchObject({ type: 'adjust', unit: 'EA', qty: 0.368, fromLocationId: MAIN })
    expect(await findLevelDrift()).toEqual([])
  })

  test('an open order in kilograms follows the product, as a revision', async () => {
    seed('purchaseOrders', [{ id: 'o1', docNo: 'PO-00001', supplierId: 's', supplierName: 'S', status: 'ordered', locationId: MAIN, orderedAt: 1, lines: [{ productId: 'p1', productName: 'Mozzarella', unit: 'KG', orderedQty: 21.76 }, { productId: 'p1', productName: 'Mozzarella', unit: 'KG', entryUnit: 'Carton', orderedQty: 1, baseQty: 21.76 }], createdBy: 'x', createdByName: 'x', createdAt: 1, updatedAt: 1 }])
    await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, actor: ACTOR })
    const o = (raw('purchaseOrders') as Record<string, unknown>[])[0] as { lines: Record<string, unknown>[]; revision: number; revisions: unknown[] }
    expect(o.lines[0]).toMatchObject({ unit: 'EA', entryUnit: 'KG', orderedQty: 21.76, baseQty: 8 })
    expect(o.lines[1]).toMatchObject({ unit: 'EA', entryUnit: 'Carton', orderedQty: 1, baseQty: 8 })
    expect(o.revision).toBe(1)
    expect(o.revisions).toHaveLength(1)
  })

  test('a run that stops halfway is finished by the next, with no row converted twice', async () => {
    failWritesWhere((col, id) => col === 'stockMovements' && id === 'i1')
    await expect(rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, actor: ACTOR })).rejects.toThrow()
    failWritesWhere(() => false)
    expect(product().unitType).toBe('KG') // the product is switched last
    const r = await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 2.72, actor: ACTOR })
    expect(r.movements).toBe(1)
    for (const m of movements()) expect((m.edits as unknown[]).length).toBe(1)
    expect(qtyFor(`${MAIN}__p1`)).toBe(9)
    expect(await findLevelDrift()).toEqual([])
  })

  test('the same unit, or no rate, is refused before anything is written', async () => {
    await expect(previewRebase({ productId: 'p1', to: 'kg', mode: 'rate', factor: 1 })).rejects.toThrow()
    await expect(previewRebase({ productId: 'p1', to: 'EA', mode: 'rate' })).rejects.toThrow()
  })
})

describe('by recount: legs that each weigh differently', () => {
  beforeEach(() => {
    seed('products', [{ id: 'p1', sku: 'P-1', name: 'Parma', category: 'Meat', unit: 'kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
    seed('stockMovements', [
      mv('r1', { productName: 'Parma', qty: 75.21 }), // received by weight
      mv('a1', { productName: 'Parma', type: 'adjust', docNo: 'ADJ-00000', qty: 3, entryUnit: 'EA', reason: 'opening' }), // an old per-unit count row
    ])
    seed('stockLevels', [lvl(MAIN, 75.21), lvl(MAIN, 3, 'EA')])
  })

  test('the preview offers the piece rows already there; the count is the owner\'s to give', async () => {
    const p = await previewRebase({ productId: 'p1', to: 'EA', mode: 'recount' })
    expect(p.sites).toEqual([{ locationId: MAIN, locationName: 'Main', oldQty: 75.21, suggested: 3, whole: true }])
    await expect(rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'recount', actor: ACTOR })).rejects.toThrow(/Main/)
  })

  test('the weight stays readable on its own closed balance; the new balance is the count', async () => {
    const r = await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'recount', counts: { [MAIN]: 12 }, actor: ACTOR })
    expect(r).toEqual({ movements: 2, counted: 1, closed: 1 })
    const byId = Object.fromEntries(movements().map((m) => [m.id, m]))
    // The weight row is now a legacy row in KG on the KG balance — not a count.
    expect(byId.r1).toMatchObject({ unit: 'EA', entryUnit: 'KG', qty: 75.21 })
    expect(byId.r1.entryQty).toBeUndefined()
    // The old count row is simply 3 EA now.
    expect(byId.a1).toMatchObject({ unit: 'EA', qty: 3 })
    expect(byId.a1.entryUnit).toBeUndefined()
    // The KG balance was closed by a signed adjustment; the EA balance is the count.
    const closing = movements().find((m) => m.type === 'adjust' && m.entryUnit === 'KG' && m.reason === 'count')!
    expect(closing).toMatchObject({ qty: 75.21, fromLocationId: MAIN, byUserId: ACTOR.id })
    expect(qtyFor(`${MAIN}__p1#KG`)).toBe(0)
    expect(qtyFor(`${MAIN}__p1`)).toBe(12)
    expect(movements().find((m) => m.reason === 'opening' && m.unit === 'EA' && m.qty === 9)).toBeTruthy()
    expect(product()).toMatchObject({ unitType: 'EA' })
    expect(product().unitConversions).toBeUndefined()
    expect(await findLevelDrift()).toEqual([])
  })

  test('an open order in the old unit blocks a recount', async () => {
    seed('purchaseOrders', [{ id: 'o1', docNo: 'PO-00007', supplierId: 's', supplierName: 'S', status: 'ordered', locationId: MAIN, orderedAt: 1, lines: [{ productId: 'p1', productName: 'Parma', unit: 'KG', orderedQty: 13 }], createdBy: 'x', createdByName: 'x', createdAt: 1, updatedAt: 1 }])
    await expect(rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'recount', counts: { [MAIN]: 12 }, actor: ACTOR })).rejects.toThrow(/PO-00007/)
    expect(product().unitType).toBe('KG')
  })
})

// 23 Sep 2026: a carton of hand towels priced at ฿1,190 was rebased from Carton to EA and
// kept the ฿1,190 — per piece. The stock of it was then valued at twenty-four times what it
// was worth, which is the same fault that valued ketchup sachets at 3.4 million in
// September ("หน่วยเพี้ยน"). What the invoice said never changes; what it comes to per unit
// of stock does.
describe('what it costs, after its unit changes', () => {
  const towels = {
    id: 'p1', sku: 'M-1', name: 'Hand towels', category: 'Office Supply', unit: 'carton',
    unitType: 'Carton', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1,
    unitConversions: [{ label: 'EA', size: 1, per: 24 }],
    cost: 1190,
    costHistory: [
      { price: 1190, unit: 'Carton', factor: 1, cost: 1190, effectiveAt: 1, at: 1, by: 'u', byName: 'Owner' },
    ],
  }

  beforeEach(() => {
    resetMemory()
    seed('locations', [{ id: MAIN, name: 'Main', type: 'warehouse', active: true, createdAt: 1 }])
    seed('products', [towels])
    seed('stockMovements', [mv('m1', { productName: 'Hand towels', unit: 'Carton', qty: 2, docNo: 'RC-1' })])
    seed('stockLevels', [lvl(MAIN, 2)])
  })

  test('a price per carton becomes a price per piece at the same rate as the quantities', async () => {
    // 1 EA is 1/24 of a Carton: two cartons become 48 pieces.
    await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 1 / 24, actor: ACTOR })
    const p = product() as { unitType: string; cost: number; costHistory: { price: number; unit: string; cost: number }[] }
    expect(p.unitType).toBe('EA')
    expect(qtyFor(`${MAIN}__p1`)).toBe(48)
    expect(p.cost).toBeCloseTo(49.5833, 3)
    // The invoice still says ฿1,190 a carton; only what that comes to per piece is restated.
    expect(p.costHistory[0].price).toBe(1190)
    expect(p.costHistory[0].unit).toBe('Carton')
    expect(p.costHistory[0].cost).toBeCloseTo(49.5833, 3)
  })

  test('a recount has no rate to restate a price with, so the price is left alone', async () => {
    await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'recount', counts: { [MAIN]: 40 }, actor: ACTOR })
    const p = product() as { unitType: string; cost: number }
    expect(p.unitType).toBe('EA')
    expect(p.cost).toBe(1190)
  })

  test('a product with no cost at all is left without one', async () => {
    seed('products', [{ ...towels, cost: undefined, costHistory: undefined }])
    await rebaseProductUnit({ productId: 'p1', to: 'EA', mode: 'rate', factor: 1 / 24, actor: ACTOR })
    const p = product() as { cost?: number; costHistory?: unknown[] }
    expect(p.cost).toBeUndefined()
    expect(p.costHistory).toBeUndefined()
  })
})
