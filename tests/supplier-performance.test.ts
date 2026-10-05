// Supplier performance and the Supplier Score (Supplier Intelligence S2): rates with their
// raw counts, delay statistics over late deliveries only, item-level lateness, confidence,
// and a score whose breakdown adds up.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { deliveryOutcome } from '../src/lib/deliveryMetrics'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import { confidenceFor, inWindow, performanceBySupplier, performanceSummary, quantile, supplierStats } from '../src/lib/supplierPerformance'
import { gradeFor, SUPPLIER_SCORE_CONFIG, supplierScore } from '../src/lib/supplierScore'
import type { PurchaseOrder } from '../src/types'

const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 6, 3)), '12:00')
const D = bkkDayStart(NOW)
const at = (n: number) => bkkAtTime(D + n * DAY_MS, '10:00')

let seq = 0
/** A received order: due `dueIn` days from today-minus-`age`, delivered `late` days after due. */
function delivered(opts: { supplier?: string; age?: number; late?: number; product?: string; qty?: number; got?: number; requested?: number } = {}): PurchaseOrder {
  const id = `po${++seq}`
  const due = D - (opts.age ?? 10) * DAY_MS
  const late = opts.late ?? 0
  const qty = opts.qty ?? 10
  const got = opts.got ?? qty
  return {
    id,
    docNo: id,
    supplierId: opts.supplier ?? 's1',
    supplierName: (opts.supplier ?? 's1').toUpperCase(),
    status: 'received',
    locationId: 'main',
    orderedAt: due - 3 * DAY_MS,
    expectedAt: due,
    requestedDeliveryDate: opts.requested ?? due,
    confirmedDeliveryDate: due,
    lines: [{ productId: opts.product ?? 'fries', productName: opts.product ?? 'fries', unit: 'ctn', orderedQty: qty, receivedQty: got }],
    receipts: [{ docNo: `R${id}`, date: due + late * DAY_MS + 3_600_000, invoiceNo: 'i', byId: 'u', byName: 'u', lines: [{ productId: opts.product ?? 'fries', qty: got }] }],
    ...(got < qty ? { closedShortAt: due + late * DAY_MS, closedShortReason: 'short' } : {}),
    createdBy: 'u',
    createdByName: 'u',
    createdAt: due - 3 * DAY_MS,
    updatedAt: due,
  }
}

describe('the rates and delays', () => {
  const orders = [
    delivered({ late: 0 }),
    delivered({ late: -1 }),
    delivered({ late: 1 }),
    delivered({ late: 2 }),
    delivered({ late: 9 }),
    delivered({ late: 0, qty: 10, got: 6 }),
  ]
  const s = performanceBySupplier(orders, 'all', NOW)[0]

  test('on time counts early and on-time; late and closed short are misses', () => {
    expect(s.onTime).toEqual({ hits: 2, n: 6, rate: 2 / 6 })
  })
  test('average, median, P90 and max are over late deliveries only', () => {
    expect(s.delay).toMatchObject({ lateCount: 3, avg: 4, median: 2, p90: 9, max: 9 })
  })
  test('fill rate over everything delivered', () => {
    expect(s.fill.rate).toBeCloseTo(56 / 60)
  })
  test('requested-date acceptance is separate from on time', () => {
    const t = supplierStats('s', 'S', [delivered({ requested: D - 12 * DAY_MS }), delivered()].map(deliveryOutcome), NOW)
    expect(t.requestedAcceptance).toEqual({ hits: 1, n: 2, rate: 0.5 })
    expect(t.onTime.rate).toBe(1)
  })
  test('nearest-rank quantiles', () => {
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
    expect(quantile([], 0.5)).toBeNull()
  })
})

describe('what counts and what does not', () => {
  test('cancelled orders are a reliability fact, not a late delivery', () => {
    const cancelled = { ...delivered(), id: 'c1', status: 'cancelled' as const, receipts: undefined, cancelReason: 'x', cancelledBy: 'u', cancelledAt: NOW }
    const s = supplierStats('s', 'S', [delivered(), cancelled].map(deliveryOutcome), NOW)
    expect(s).toMatchObject({ placed: 2, completed: 2, delivered: 1, cancelled: 1 })
    expect(s.onTime.n).toBe(1)
    expect(s.cancellation).toEqual({ hits: 1, n: 2, rate: 0.5 })
  })
  test('open orders and orders without a due date are not judged on time', () => {
    const open = { ...delivered(), id: 'o1', status: 'ordered' as const, receipts: [], lines: [{ productId: 'fries', productName: 'f', unit: 'ctn', orderedQty: 10 }] }
    const undated = { ...delivered(), id: 'u1', expectedAt: undefined, confirmedDeliveryDate: undefined, requestedDeliveryDate: undefined }
    const s = supplierStats('s', 'S', [open, undated, delivered()].map(deliveryOutcome), NOW)
    expect(s.onTime.n).toBe(1)
    expect(s.open).toBe(1)
  })
  test('windows by order date', () => {
    const orders = [delivered({ age: 5 }), delivered({ age: 50 }), delivered({ age: 200 }), delivered({ age: 500 })]
    expect(inWindow(orders, '30d', NOW)).toHaveLength(1)
    expect(inWindow(orders, '90d', NOW)).toHaveLength(2)
    expect(inWindow(orders, '12m', NOW)).toHaveLength(3)
    expect(inWindow(orders, 'all', NOW)).toHaveLength(4)
  })
  test('no orders for a supplier: no stats row at all', () => {
    expect(performanceBySupplier([], 'all', NOW)).toEqual([])
  })
})

describe('items: a reliable supplier can still be late on one SKU', () => {
  test('fries late 3 of 4, nuggets never', () => {
    const orders = [
      delivered({ product: 'fries', late: 1 }),
      delivered({ product: 'fries', late: 2 }),
      delivered({ product: 'fries', late: 3 }),
      delivered({ product: 'fries', late: 0 }),
      ...Array.from({ length: 6 }, () => delivered({ product: 'nuggets', late: 0 })),
    ]
    const s = performanceBySupplier(orders, 'all', NOW)[0]
    const fries = s.items.find((i) => i.productId === 'fries')!
    const nuggets = s.items.find((i) => i.productId === 'nuggets')!
    expect(fries).toMatchObject({ deliveries: 4, late: 3, lateRate: 0.75, avgDelayWhenLate: 2 })
    expect(nuggets).toMatchObject({ deliveries: 6, late: 0, lateRate: 0 })
    expect(s.onTime.rate).toBe(0.7)
  })
})

describe('confidence and the score', () => {
  test('confidence bands', () => {
    expect([0, 4, 5, 19, 20, 49, 50].map((n) => confidenceFor(n))).toEqual(['insufficient', 'insufficient', 'low', 'low', 'medium', 'medium', 'high'])
  })
  test('grade boundaries', () => {
    expect([100, 95, 94.9, 90, 89.9, 80, 79.9, 70, 69.9, 60, 59.9, 0].map((s) => gradeFor(s))).toEqual(['A+', 'A+', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'F', 'F'])
  })
  test('a tiny sample gets a score but no grade', () => {
    const s = supplierStats('s', 'S', [delivered(), delivered()].map(deliveryOutcome), NOW)
    const sc = supplierScore(s)
    expect(s.confidence).toBe('insufficient')
    expect(sc.score).not.toBeNull()
    expect(sc.grade).toBeNull()
  })
  test('a perfect record without supplier links: response is dropped, the rest scaled to 100', () => {
    const s = supplierStats('s', 'S', Array.from({ length: 6 }, () => deliveryOutcome(delivered())), NOW)
    const sc = supplierScore(s)
    expect(sc.score).toBe(100)
    expect(sc.grade).toBe('A+')
    const response = sc.components.find((c) => c.key === 'response')!
    expect(response).toMatchObject({ value: null, effectiveWeight: 0, points: 0 })
    expect(sc.components.reduce((a, c) => a + c.effectiveWeight, 0)).toBeCloseTo(100)
  })
  test('the breakdown adds up to the score', () => {
    const s = performanceBySupplier(
      [delivered({ late: 0 }), delivered({ late: 2 }), delivered({ late: 1, got: 8 }), delivered(), delivered({ requested: D - 30 * DAY_MS })],
      'all',
      NOW,
    )[0]
    const sc = supplierScore(s)
    expect(sc.components.reduce((a, c) => a + c.points, 0)).toBeCloseTo(sc.score!, 0)
    expect(sc.components.find((c) => c.key === 'onTime')!.basis).toEqual({ hits: 3, n: 5 })
  })
  test('weights come from the config', () => {
    const cfg = { ...SUPPLIER_SCORE_CONFIG, weights: { onTime: 100, fill: 0, delaySeverity: 0, acceptance: 0, response: 0, reliability: 0 } }
    const s = supplierStats('s', 'S', [delivered({ late: 1 }), ...Array.from({ length: 4 }, () => delivered())].map(deliveryOutcome), NOW, cfg)
    expect(supplierScore(s, cfg).score).toBe(80)
  })
  test('nothing delivered yet: no score', () => {
    const open = { ...delivered(), status: 'ordered' as const, receipts: [], lines: [{ productId: 'f', productName: 'f', unit: 'ctn', orderedQty: 1 }] }
    expect(supplierScore(supplierStats('s', 'S', [deliveryOutcome(open)], NOW)).score).toBeNull()
  })
})

describe('summary and trend', () => {
  test('at risk: open and past the confirmed day, or waiting on a date decision', () => {
    const overdue = { ...delivered({ age: 2 }), status: 'ordered' as const, receipts: [], lines: [{ productId: 'f', productName: 'f', unit: 'ctn', orderedQty: 1 }] }
    const waiting = { ...overdue, id: 'w', expectedAt: D + 5 * DAY_MS, confirmedDeliveryDate: undefined, supplierConfirmationStatus: 'pending_date_approval' as const }
    const fine = { ...overdue, id: 'f', expectedAt: D + 5 * DAY_MS, confirmedDeliveryDate: D + 5 * DAY_MS }
    const stats = performanceBySupplier([overdue, waiting, fine, delivered()], 'all', NOW)
    expect(performanceSummary(stats, NOW)).toMatchObject({ suppliers: 1, atRisk: 2, completed: 1 })
  })
  test('trend needs enough deliveries on both sides', () => {
    const recentLate = Array.from({ length: 5 }, () => delivered({ age: 10, late: 1 }))
    const olderOnTime = Array.from({ length: 5 }, () => delivered({ age: 45 }))
    const s = performanceBySupplier([...recentLate, ...olderOnTime], 'all', NOW)[0]
    expect(s.trend.direction).toBe('down')
    expect(performanceBySupplier(recentLate, 'all', NOW)[0].trend.direction).toBeNull()
    expect(at(0)).toBeGreaterThan(D)
  })
})
