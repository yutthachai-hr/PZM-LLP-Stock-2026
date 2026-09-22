// Prices as keyed, costs as the books use them (owner, 22 Sep 2026).
//
//   npm test
//
// A price is stated in whatever unit the invoice says — a carton, a piece, a kilo — with
// the day it applies from. The product's `cost` is always that price brought to one of
// its own unit, and every price ever stated stays readable.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const { costPerUnit, currentCost, setProductCost } = await import('../src/services/productCost')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'u1', name: 'AA' }
const ketchup = { id: 'p1', sku: 'SP-1', name: 'Ketchup 3x100', category: 'Sauce', unit: 'each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, cost: 297.9, unitConversions: [{ label: 'Carton', size: 300 }, { label: 'Pack', size: 100 }] }
const product = () => (raw('products') as Record<string, unknown>[])[0] as { cost?: number; costHistory?: { price: number; unit: string; cost: number; effectiveAt: number }[] }

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seed('products', [ketchup])
})

describe('costPerUnit', () => {
  test('a carton price becomes a price per piece at the product\'s own rate', () => {
    expect(costPerUnit(ketchup, 297.9, 'Carton')).toEqual({ factor: 300, cost: 0.993 })
    expect(costPerUnit(ketchup, 99.3, 'Pack')).toEqual({ factor: 100, cost: 0.993 })
    expect(costPerUnit(ketchup, 1, 'EA')).toEqual({ factor: 1, cost: 1 })
    expect(costPerUnit(ketchup, 1, '')).toEqual({ factor: 1, cost: 1 })
  })
  test('a unit with no rate cannot be priced', () => {
    expect(() => costPerUnit(ketchup, 5, 'Lot')).toThrow(/Lot/)
  })
})

describe('setProductCost', () => {
  test('writes the entry and the cost together; the cost is the newest effective price', async () => {
    await setProductCost({ productId: 'p1', price: 297.9, unit: 'Carton', effectiveAt: 1_000, actor: ACTOR, note: 'invoice 1' })
    expect(product().cost).toBe(0.993)
    expect(product().costHistory).toHaveLength(1)
    expect(product().costHistory![0]).toMatchObject({ price: 297.9, unit: 'Carton', cost: 0.993, effectiveAt: 1_000, by: 'u1', byName: 'AA', note: 'invoice 1' })

    await setProductCost({ productId: 'p1', price: 330, unit: 'Carton', effectiveAt: 2_000, actor: ACTOR })
    expect(product().cost).toBe(1.1)
    expect(product().costHistory!.map((h) => h.cost)).toEqual([0.993, 1.1])
  })

  test('a price dated before the current one is kept as history and does not become the cost', async () => {
    await setProductCost({ productId: 'p1', price: 330, unit: 'Carton', effectiveAt: 2_000, actor: ACTOR })
    await setProductCost({ productId: 'p1', price: 297.9, unit: 'Carton', effectiveAt: 1_000, actor: ACTOR })
    expect(product().cost).toBe(1.1)
    expect(product().costHistory!.map((h) => h.effectiveAt)).toEqual([1_000, 2_000])
  })

  test('refuses a bad price or an unknown unit, and touches nothing', async () => {
    await expect(setProductCost({ productId: 'p1', price: -1, unit: 'EA', effectiveAt: 1, actor: ACTOR })).rejects.toThrow()
    await expect(setProductCost({ productId: 'p1', price: 5, unit: 'Lot', effectiveAt: 1, actor: ACTOR })).rejects.toThrow(/Lot/)
    expect(product().cost).toBe(297.9)
    expect(product().costHistory).toBeUndefined()
  })

  test('currentCost reads the newest effective entry', () => {
    expect(currentCost([{ cost: 1, effectiveAt: 5 }, { cost: 2, effectiveAt: 3 }])).toBe(1)
    expect(currentCost([])).toBeUndefined()
  })
})
