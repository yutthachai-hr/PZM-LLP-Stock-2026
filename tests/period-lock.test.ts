// The period lock (plan B1, 6 Oct 2026): once a location's monthly count is posted, its month
// is closed there. Stock is not filed into it; an admin's correction needs a reason.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const stock = await import('../src/services/stock')
const { countDayOf } = await import('../src/lib/monthlyCount')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'u', name: 'U' }
const SEPT = countDayOf('2026-09')
const OCT = SEPT + 5 * 86_400_000
const flour = (qty: number) => ({ productId: 'flour', productName: 'FLOUR', unit: 'KG', qty })

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
  seed('products', [{ id: 'flour', sku: 'F', name: 'FLOUR', category: 'c', unit: 'KG', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
  seed('locations', [
    { id: 'wh', name: 'Main', type: 'warehouse', active: true, createdAt: 1 },
    { id: 'br', name: 'Branch', type: 'branch', active: true, createdAt: 1 },
  ])
})

const close = (location: string, month: string) =>
  seed('monthlyCounts', [{ id: `${location}__${month}`, locationId: location, month, countDate: SEPT, status: 'posted', lines: {}, createdBy: 'u', createdByName: 'U', createdAt: 1, updatedAt: 1 }])

describe('a closed month', () => {
  test('nothing is filed into it at that location — receive, issue, use, adjust', async () => {
    await stock.receiveStock({ lines: [flour(10)], toLocationId: 'wh', date: SEPT - 86_400_000, actor: ACTOR })
    close('wh', '2026-09')
    await expect(stock.receiveStock({ lines: [flour(1)], toLocationId: 'wh', date: SEPT, actor: ACTOR })).rejects.toThrow(/2026-09/)
    await expect(stock.consumeStock({ lines: [flour(1)], fromLocationId: 'wh', date: SEPT, actor: ACTOR })).rejects.toThrow()
    await expect(stock.adjustStockLines({ lines: [{ ...flour(1), direction: 'out', reason: 'broken' }], locationId: 'wh', date: SEPT, actor: ACTOR })).rejects.toThrow()
    await expect(stock.issueStock({ lines: [flour(1)], fromLocationId: 'wh', toLocationId: 'br', date: SEPT, actor: ACTOR })).rejects.toThrow()
    expect(raw('stockMovements')).toHaveLength(1)
  })

  test('the next month, and other locations, are open', async () => {
    close('wh', '2026-09')
    await stock.receiveStock({ lines: [flour(3)], toLocationId: 'wh', date: OCT, actor: ACTOR })
    await stock.receiveStock({ lines: [flour(2)], toLocationId: 'br', date: SEPT, actor: ACTOR })
    expect(raw('stockMovements')).toHaveLength(2)
  })

  test("an admin's correction of a row in it needs a reason, which stays on the row", async () => {
    await stock.receiveStock({ lines: [flour(10)], toLocationId: 'wh', date: SEPT, actor: ACTOR })
    close('wh', '2026-09')
    const id = raw('stockMovements')[0].id as string
    await expect(stock.editMovement({ movementId: id, patch: { qty: 9 }, actor: ACTOR })).rejects.toThrow()
    await stock.editMovement({ movementId: id, patch: { qty: 9, overrideReason: 'invoice said 9' }, actor: ACTOR })
    const row = raw('stockMovements')[0] as { qty: number; edits: { periodOverride?: string }[] }
    expect(row.qty).toBe(9)
    expect(row.edits.at(-1)?.periodOverride).toBe('invoice said 9')
  })

  test('moving a row from an open month into a closed one also needs a reason', async () => {
    await stock.receiveStock({ lines: [flour(10)], toLocationId: 'wh', date: OCT, actor: ACTOR })
    close('wh', '2026-09')
    const id = raw('stockMovements')[0].id as string
    await expect(stock.editMovement({ movementId: id, patch: { date: SEPT }, actor: ACTOR })).rejects.toThrow()
  })
})
