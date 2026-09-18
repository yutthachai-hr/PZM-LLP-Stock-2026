// Usage rate, reorder suggestion, estimated stock-out and significant adjustments.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { significance } from '../../src/lib/inventoryRules/adjustments'
import { inventoryInsights } from '../../src/lib/inventoryRules/insights'
import { recommend, stockoutSoon } from '../../src/lib/inventoryRules/reorder'
import { bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import { usageAt, usageIndex } from '../../src/lib/inventoryRules/usage'
import type { Product, PurchaseRequest, StockLocation, StockMovement } from '../../src/types'

const NOW = Date.UTC(2026, 8, 18, 3, 0)
const TODAY = bkkDayStart(NOW)
const mv = (over: Partial<StockMovement>): StockMovement => ({
  id: Math.random().toString(36).slice(2), docNo: 'D', type: 'issue', productId: 'p1', productName: 'Cheese', unit: 'KG', qty: 1,
  fromLocationId: 'main', date: TODAY - DAY_MS, byUserId: 'u', byUserName: 'U', createdAt: 1, ...over,
})

describe('usage', () => {
  test('issues, consumption and loss out of a location, over the days of history there', () => {
    const idx = usageIndex(
      [
        mv({ type: 'receive', fromLocationId: undefined, toLocationId: 'main', qty: 100, date: TODAY - 9 * DAY_MS }),
        mv({ qty: 10, date: TODAY - 5 * DAY_MS }),
        mv({ type: 'consume', qty: 5, date: TODAY - 2 * DAY_MS }),
        mv({ type: 'adjust', reason: 'expired', qty: 5, date: TODAY - DAY_MS }),
        // Not demand: a count correction, a voided line, another unit.
        mv({ type: 'adjust', reason: 'count', qty: 50 }),
        mv({ qty: 99, voided: true }),
        mv({ qty: 99, entryUnit: 'Pack' }),
      ],
      NOW,
      30,
    )
    const u = usageAt(idx, 'main', 'p1')!
    expect(u.used).toBe(15)
    expect(u.lost).toBe(5)
    expect(u.days).toBe(10)
    expect(u.avgDaily).toBe(2)
  })

  test('too little history gives no rate rather than a wild one', () => {
    expect(usageAt(usageIndex([mv({ qty: 10 })], NOW, 30), 'main', 'p1')?.avgDaily).toBeNull()
    const recent = [mv({ qty: 10, date: TODAY - 2 * DAY_MS }), mv({ qty: 10, date: TODAY - DAY_MS })]
    expect(usageAt(usageIndex(recent, NOW, 30), 'main', 'p1')?.avgDaily).toBeNull()
  })
})

describe('reorder', () => {
  test('with a rate: at the reorder point, enough for lead time plus cover, plus the safety stock', () => {
    // 2/day, 3 days lead, min 4: reorder point 10. Have 8 + 0 incoming → order 2×(3+7)+4−8 = 16.
    const r = recommend({ onHand: 8, incoming: 0, avgDaily: 2, min: 4, leadTimeDays: 3, coverDays: 7 })!
    expect(r).toMatchObject({ recommendedQty: 16, basis: 'usage', reorderPoint: 10 })
    expect(r.daysLeft).toBe(4)
  })

  test('what is already on order counts; above the point there is nothing to say', () => {
    expect(recommend({ onHand: 8, incoming: 5, avgDaily: 2, min: 4, leadTimeDays: 3, coverDays: 7 })).toBeNull()
  })

  test('without a rate it falls back to the minimum, labelled as such', () => {
    expect(recommend({ onHand: 3, incoming: 0, avgDaily: null, min: 5, coverDays: 7 })).toMatchObject({ recommendedQty: 7, basis: 'minStock' })
    expect(recommend({ onHand: 0, incoming: 0, avgDaily: null, min: 0, coverDays: 7 })).toBeNull()
  })

  test('never below the supplier minimum order', () => {
    expect(recommend({ onHand: 8, incoming: 0, avgDaily: 2, min: 4, leadTimeDays: 3, coverDays: 7, minOrderQty: 50 })?.recommendedQty).toBe(50)
  })

  test('estimated stock-out: gone before a delivery ordered now could land', () => {
    expect(stockoutSoon(4, 0, 2, 3)).toBe(2)
    expect(stockoutSoon(40, 0, 2, 3)).toBeNull()
    expect(stockoutSoon(4, 10, 2, 3)).toBeNull()
    expect(stockoutSoon(0, 0, 2, 3)).toBeNull()
  })
})

describe('significant adjustments', () => {
  const product = { id: 'p1', cost: 100 } as Product
  const settings = { adjustValueBaht: 1000, adjustPct: 20, wasteValueBaht: 500 }
  test('waste by value, adjustment by value or share of what was held', () => {
    expect(significance(mv({ type: 'adjust', reason: 'expired', qty: 6 }), product, 100, settings)?.kind).toBe('waste')
    expect(significance(mv({ type: 'adjust', reason: 'expired', qty: 2 }), product, 100, settings)).toBeNull()
    expect(significance(mv({ type: 'adjust', reason: 'count', qty: 11, fromLocationId: undefined, toLocationId: 'main' }), product, 100, settings)?.kind).toBe('adjustment')
    // 5 out of 20 held is 25%: significant with no cost at all.
    expect(significance(mv({ type: 'adjust', reason: 'count', qty: 5 }), { id: 'p1' } as Product, 15, settings)).toMatchObject({ kind: 'adjustment', value: null })
    expect(significance(mv({ qty: 50 }), product, 0, settings)).toBeNull()
  })
})

describe('insights', () => {
  const loc: StockLocation = { id: 'main', name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 }
  const product: Product = { id: 'p1', sku: 'S1', name: 'Cheese', category: 'c', unit: 'kg', unitType: 'KG', minStock: 5, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }
  const base = {
    products: [product],
    locations: [loc],
    movements: [],
    orders: [],
    suppliers: [],
    settings: { coverDays: 7, usageWindowDays: 30, adjustValueBaht: 1000, adjustPct: 20, wasteValueBaht: 500 },
    qtyAt: () => 2,
    minFor: () => 5,
    tracksProduct: () => true,
    now: NOW,
    adjustmentsSince: TODAY,
  }

  test('a reorder already asked for is marked in progress, never suggested bare', () => {
    const pr = { id: 'r1', docNo: 'PR-1', status: 'pendingApproval', locationId: 'main', items: [{ productId: 'p1', requestedQty: 5 }] } as unknown as PurchaseRequest
    const [r] = inventoryInsights({ ...base, requests: [pr] }).reorders
    expect(r.inProgress).toMatchObject({ kind: 'pr', docNo: 'PR-1' })
  })

  test('a snoozed suggestion stays away until its day', () => {
    const snooze = { id: 'snooze__reorder__p1__main', kind: 'snooze' as const, until: NOW + DAY_MS, by: 'u', byName: 'U', createdAt: 1 }
    expect(inventoryInsights({ ...base, requests: [], snoozes: [snooze] }).reorders).toHaveLength(0)
    expect(inventoryInsights({ ...base, requests: [], snoozes: [{ ...snooze, until: NOW - 1 }] }).reorders).toHaveLength(1)
  })
})
