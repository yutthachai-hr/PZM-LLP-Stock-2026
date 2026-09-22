// One adjustment document, many lines (spec §2.5 — the owner's mock-up 04 counts a shelf
// and corrects every product on it in one go). Each line is still its own `adjust` movement,
// all under one document number.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const { receiveStock, adjustStockLines } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'

function balance(productId: string): number {
  const doc = raw('stockLevels').find((d) => d.id === `${MAIN}__${productId}`)
  return (doc?.qty as number) ?? 0
}

beforeEach(async () => {
  setActiveBrand('pizza')
  resetMemory()
  seed('products', [
    { id: 'p1', sku: 'A-1', name: 'Bacon', category: 'Meat', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'p2', sku: 'A-2', name: 'Mozzarella', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'p3', sku: 'A-3', name: 'Tomato', category: 'Sauce', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  ])
  seed('locations', [{ id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 }])
  await receiveStock({
    lines: [
      { productId: 'p1', productName: 'Bacon', unit: 'KG', qty: 10 },
      { productId: 'p2', productName: 'Mozzarella', unit: 'KG', qty: 5 },
      { productId: 'p3', productName: 'Tomato', unit: 'KG', qty: 20 },
    ],
    toLocationId: MAIN,
    date: Date.now(),
    actor: ACTOR,
  })
})

const adjustments = () => raw('stockMovements').filter((m) => m.type === 'adjust')

describe('adjustStockLines', () => {
  test('files every line under one document number, each with its own reason', async () => {
    const docNo = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      note: 'monthly count',
      lines: [
        { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 2, reason: 'damage' },
        { productId: 'p2', productName: 'Mozzarella', unit: 'KG', direction: 'in', qty: 1, reason: 'found' },
        { productId: 'p3', productName: 'Tomato', unit: 'KG', direction: 'out', qty: 2, reason: 'expired', note: 'bent cans' },
      ],
    })
    expect(docNo).toMatch(/^ADJ-\d{5}$/)
    const rows = adjustments()
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.docNo))).toEqual(new Set([docNo]))
    expect(rows.map((r) => [r.productId, r.reason])).toEqual([
      ['p1', 'damage'],
      ['p2', 'found'],
      ['p3', 'expired'],
    ])
    // The line's own note wins; otherwise the document's.
    expect(rows.find((r) => r.productId === 'p3')?.note).toBe('bent cans')
    expect(rows.find((r) => r.productId === 'p1')?.note).toBe('monthly count')
    // Direction is where the stock went, as on a single adjustment.
    expect(rows.find((r) => r.productId === 'p1')).toMatchObject({ fromLocationId: MAIN })
    expect(rows.find((r) => r.productId === 'p2')).toMatchObject({ toLocationId: MAIN })
  })

  test('leaves every balance where the lines say', async () => {
    await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [
        { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 2, reason: 'damage' },
        { productId: 'p2', productName: 'Mozzarella', unit: 'KG', direction: 'in', qty: 1, reason: 'found' },
      ],
    })
    expect(balance('p1')).toBe(8)
    expect(balance('p2')).toBe(6)
    expect(balance('p3')).toBe(20)
  })

  test('one line that would go below zero refuses the whole document', async () => {
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 2, reason: 'damage' },
          { productId: 'p2', productName: 'Mozzarella', unit: 'KG', direction: 'out', qty: 9, reason: 'lost' },
        ],
      }),
    ).rejects.toThrow()
    expect(adjustments()).toHaveLength(0)
    expect(balance('p1')).toBe(10)
    expect(balance('p2')).toBe(5)
  })

  test('the same product twice in one document is refused, not netted', async () => {
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 2, reason: 'damage' },
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 1, reason: 'found' },
        ],
      }),
    ).rejects.toThrow()
    expect(adjustments()).toHaveLength(0)
  })

  test('an unknown reason and an empty document are refused', async () => {
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 1, reason: 'because' }],
      }),
    ).rejects.toThrow()
    await expect(adjustStockLines({ locationId: MAIN, date: Date.now(), actor: ACTOR, lines: [] })).rejects.toThrow()
  })

  test('two documents get consecutive numbers', async () => {
    const a = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 1, reason: 'lost' }],
    })
    const b = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [{ productId: 'p2', productName: 'Mozzarella', unit: 'KG', direction: 'out', qty: 1, reason: 'lost' }],
    })
    expect(Number(b.slice(4))).toBe(Number(a.slice(4)) + 1)
  })
})
