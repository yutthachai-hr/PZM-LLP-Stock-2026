// The calendar's derived entries: where orders, requests, cut-offs and shortages land, with
// what status, under ids that cannot collide — and the Bangkok day arithmetic beneath them.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { buildFeed, isTaskOverdue, orderDay } from '../../src/lib/inventoryRules/calendarFeed'
import {
  cutoffInstants,
  daysLate,
  deliveryState,
  expectedDeliveryAt,
  incomingFor,
  isLate,
  openPurchaseFor,
} from '../../src/lib/inventoryRules/purchasing'
import { shortages } from '../../src/lib/inventoryRules/lowStock'
import {
  BKK_OFFSET_MS,
  bkkAtTime,
  bkkDayEnd,
  bkkDayFromKey,
  bkkDayKey,
  bkkDayStart,
  bkkDaysBetween,
  bkkTimeOf,
  bkkWeekday,
  DAY_MS,
} from '../../src/lib/inventoryRules/time'
import type { FeedInput } from '../../src/lib/inventoryRules/types'
import type { Product, PurchaseOrder, PurchaseRequest, StockEvent, StockLocation, Supplier } from '../../src/types'

// 2026-09-17 10:00 Bangkok
const NOW = Date.UTC(2026, 8, 17, 3, 0)
const TODAY = bkkDayStart(NOW)

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, sku: id, name: id.toUpperCase(), category: 'C', unit: 'Kilogram', unitType: 'KG', minStock: 0,
  hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over,
})
const location = (id: string, over: Partial<StockLocation> = {}): StockLocation => ({
  id, name: id, type: 'warehouse', active: true, createdAt: 1, ...over,
})
const supplier = (id: string, over: Partial<Supplier> = {}): Supplier => ({
  id, name: id.toUpperCase(), contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 1, updatedAt: 1, ...over,
})
const order = (id: string, over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id, docNo: `PO-${id}`, supplierId: 's1', supplierName: 'S1', status: 'ordered', locationId: 'main',
  orderedAt: TODAY - 2 * DAY_MS, lines: [{ productId: 'p1', productName: 'P1', unit: 'KG', orderedQty: 5 }],
  createdBy: 'u', createdByName: 'U', createdAt: 1, updatedAt: 1, ...over,
})
const request = (id: string, over: Partial<PurchaseRequest> = {}): PurchaseRequest => ({
  id, docNo: `PR-${id}`, status: 'pendingApproval', revision: 1, locationId: 'main',
  items: [{ idx: 0, productId: 'p1', productName: 'P1', sku: 'p1', unit: 'KG', supplierId: 's1', supplierName: 'S1', supplierChoice: 'primary', requestedQty: 3 }],
  requestedBy: 'u', requestedByName: 'U', submittedAt: TODAY - DAY_MS, history: [], createdBy: 'u', createdByName: 'U',
  createdAt: TODAY - DAY_MS, updatedAt: 1, ...over,
})
const event = (id: string, over: Partial<StockEvent> = {}): StockEvent => ({
  id, title: 'Count', type: 'stockCount', startAt: TODAY + 9 * 3_600_000, status: 'upcoming', priority: 'normal',
  createdBy: 'u', createdAt: 1, updatedAt: 1, ...over,
})

function input(over: Partial<FeedInput> = {}): FeedInput {
  const qty = new Map<string, number>()
  return {
    events: [], orders: [], requests: [], suppliers: [supplier('s1', { leadTimeDays: 2 })],
    products: [product('p1', { minStock: 10 })], locations: [location('main')],
    qtyAt: (l, p) => qty.get(`${l}__${p}`) ?? 0,
    minFor: (p) => p.minStock,
    tracksProduct: () => true,
    range: { from: TODAY - 7 * DAY_MS, to: TODAY + 30 * DAY_MS },
    now: NOW,
    ...over,
  }
}

describe('Bangkok days', () => {
  test('day start, end, key and weekday agree with the fixed offset', () => {
    expect(bkkDayStart(NOW)).toBe(Date.UTC(2026, 8, 16, 17, 0))
    expect(bkkDayEnd(NOW)).toBe(bkkDayStart(NOW) + DAY_MS - 1)
    expect(bkkDayKey(NOW)).toBe('20260917')
    expect(bkkDayFromKey('20260917')).toBe(bkkDayStart(NOW))
    expect(bkkWeekday(NOW)).toBe(4) // a Thursday
    expect(bkkTimeOf(NOW)).toBe('10:00')
    expect(bkkAtTime(NOW, '14:00')).toBe(bkkDayStart(NOW) + 14 * 3_600_000)
    expect(bkkDaysBetween(NOW, NOW + 3 * DAY_MS)).toBe(3)
  })

  test('23:30 Bangkok is still that day, not the next UTC day', () => {
    const late = Date.UTC(2026, 8, 17, 16, 30) // 23:30 BKK on the 17th
    expect(bkkDayKey(late)).toBe('20260917')
    expect(bkkDayKey(late + 3_600_000)).toBe('20260918')
    expect(BKK_OFFSET_MS).toBe(7 * 3_600_000)
  })
})

describe('order delivery dates', () => {
  test('the date on the order wins over the lead time, which wins over nothing', () => {
    expect(expectedDeliveryAt(order('a', { expectedAt: TODAY + DAY_MS + 5 }), 2)).toBe(TODAY + DAY_MS)
    expect(expectedDeliveryAt(order('a'), 2)).toBe(TODAY)
    expect(expectedDeliveryAt(order('a'))).toBeUndefined()
  })

  test('late is the day after the due day; without a date, three days after ordering', () => {
    const due = order('a', { expectedAt: TODAY - DAY_MS })
    expect(isLate(due, NOW)).toBe(true)
    expect(daysLate(due, NOW)).toBe(1)
    expect(isLate(order('a', { expectedAt: TODAY }), NOW)).toBe(false)
    expect(isLate(order('a', { orderedAt: TODAY - 3 * DAY_MS }), NOW)).toBe(true)
    expect(isLate(order('a', { orderedAt: TODAY - 2 * DAY_MS }), NOW)).toBe(false)
    expect(isLate(order('a', { status: 'received', expectedAt: TODAY - 5 * DAY_MS }), NOW)).toBe(false)
  })

  test('delivery state: expected, arriving today, delayed, received', () => {
    expect(deliveryState(order('a', { expectedAt: TODAY + DAY_MS }), NOW)).toBe('expected')
    expect(deliveryState(order('a', { expectedAt: TODAY }), NOW)).toBe('arrivingToday')
    expect(deliveryState(order('a', { expectedAt: TODAY - DAY_MS }), NOW)).toBe('delayed')
    expect(deliveryState(order('a', { status: 'received' }), NOW)).toBe('received')
  })

  test('a received order sits on the day it arrived', () => {
    expect(orderDay(order('a', { status: 'received', receivedAt: TODAY - DAY_MS + 100 }), 2)).toBe(TODAY - DAY_MS)
  })
})

describe('open purchases', () => {
  test('an open request for the product at the location is found before an order', () => {
    const hit = openPurchaseFor('p1', 'main', { requests: [request('r1')], orders: [order('o1')] })
    expect(hit).toMatchObject({ kind: 'pr', docNo: 'PR-r1', qty: 3 })
  })
  test('a request at another location does not count; an order anywhere does', () => {
    const hit = openPurchaseFor('p1', 'branch', { requests: [request('r1')], orders: [order('o1')] })
    expect(hit).toMatchObject({ kind: 'po', docNo: 'PO-o1' })
  })
  test('closed requests and received orders are not open', () => {
    expect(
      openPurchaseFor('p1', 'main', {
        requests: [request('r1', { status: 'rejected' }), request('r2', { status: 'poCreated' })],
        orders: [order('o1', { status: 'received' })],
      }),
    ).toBeNull()
  })
  test('incoming sums base-unit lines on placed orders to the location', () => {
    const orders = [
      order('a', { lines: [{ productId: 'p1', productName: 'P', unit: 'KG', orderedQty: 5 }] }),
      order('b', { lines: [{ productId: 'p1', productName: 'P', unit: 'KG', entryUnit: 'Pack', orderedQty: 2 }] }),
      order('c', { status: 'received', lines: [{ productId: 'p1', productName: 'P', unit: 'KG', orderedQty: 9 }] }),
      order('d', { locationId: 'other', lines: [{ productId: 'p1', productName: 'P', unit: 'KG', orderedQty: 4 }] }),
    ]
    expect(incomingFor('p1', 'main', orders)).toBe(5)
  })
})

describe('supplier cut-offs', () => {
  test('one instant per order day with a cut-off time, inside the window', () => {
    const s = supplier('s1', { orderDays: [1, 3, 5], cutoffTime: '14:00' })
    const from = TODAY
    const to = TODAY + 7 * DAY_MS - 1
    const hits = cutoffInstants(s, { from, to })
    expect(hits).toHaveLength(3)
    expect(hits.every((at) => bkkTimeOf(at) === '14:00')).toBe(true)
    expect(hits.map((at) => bkkWeekday(at))).toEqual([5, 1, 3]) // Thu start → Fri, Mon, Wed
  })
  test('no time or no days means no entries; a hidden supplier has none', () => {
    expect(cutoffInstants(supplier('s', { orderDays: [1] }), { from: TODAY, to: TODAY + 7 * DAY_MS })).toEqual([])
    expect(cutoffInstants(supplier('s', { cutoffTime: '10:00' }), { from: TODAY, to: TODAY + 7 * DAY_MS })).toEqual([])
    expect(
      cutoffInstants(supplier('s', { orderDays: [1], cutoffTime: '10:00', active: false }), { from: TODAY, to: TODAY + 7 * DAY_MS }),
    ).toEqual([])
  })
})

describe('shortages', () => {
  test('low at or under the minimum, out at or under zero, never without a minimum or a history there', () => {
    const qty = new Map([['main__p1', 3], ['main__p2', 0], ['main__p3', 1]])
    const rows = shortages({
      products: [product('p1', { minStock: 10 }), product('p2', { minStock: 5 }), product('p3')],
      locations: [location('main'), location('branch')],
      qtyAt: (l, p) => qty.get(`${l}__${p}`) ?? 0,
      minFor: (p) => p.minStock,
      tracksProduct: (l) => l === 'main',
    })
    expect(rows.map((r) => [r.product.id, r.out])).toEqual([
      ['p1', false],
      ['p2', true],
    ])
  })
})

describe('buildFeed', () => {
  test('every kind lands on its day with a deterministic id, and twice gives the same', () => {
    const feed = input({
      events: [event('e1')],
      orders: [order('o1', { expectedAt: TODAY + DAY_MS }), order('o2', { status: 'draft' })],
      requests: [request('r1')],
      suppliers: [supplier('s1', { leadTimeDays: 2, orderDays: [bkkWeekday(NOW)], cutoffTime: '14:00' })],
      qtyAt: () => 3,
    })
    const a = buildFeed(feed)
    const b = buildFeed(feed)
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length)
    const kinds = a.map((i) => i.kind)
    expect(kinds).toContain('task')
    expect(kinds).toContain('poExpected')
    expect(kinds).toContain('prPending')
    expect(kinds).toContain('cutoff')
    expect(kinds).toContain('lowStock')
    expect(a.find((i) => i.kind === 'poExpected')?.at).toBe(TODAY + DAY_MS)
    expect(a.some((i) => i.sourceId === 'o2')).toBe(false) // drafts are proposals, not deliveries
    expect(a.find((i) => i.kind === 'lowStock')?.priority).toBe('medium')
  })

  test('a delayed order is overdue and high; an out-of-stock line is critical', () => {
    const feed = input({ orders: [order('o1', { expectedAt: TODAY - 2 * DAY_MS })] })
    const po = buildFeed(feed).find((i) => i.kind === 'poExpected')!
    expect(po.status).toBe('overdue')
    expect(po.priority).toBe('high')
    expect(po.meta.kind === 'poExpected' && po.meta.daysLate).toBe(2)
    const out = buildFeed(input({ products: [product('p1', { minStock: 4 })] })).find((i) => i.kind === 'outOfStock')!
    expect(out.priority).toBe('critical')
  })

  test('a task past its due moment is overdue; a done one is not', () => {
    expect(isTaskOverdue(event('e', { startAt: TODAY - DAY_MS }), NOW)).toBe(true)
    expect(isTaskOverdue(event('e', { startAt: TODAY - DAY_MS, dueAt: TODAY + DAY_MS }), NOW)).toBe(false)
    expect(isTaskOverdue(event('e', { startAt: TODAY - DAY_MS, status: 'completed' }), NOW)).toBe(false)
    const item = buildFeed(input({ events: [event('e', { startAt: TODAY - DAY_MS })] })).find((i) => i.kind === 'task')!
    expect(item.status).toBe('overdue')
    expect(item.priority).toBe('high')
  })

  test('shortages only appear when today is in the window', () => {
    const past = input({ range: { from: TODAY - 30 * DAY_MS, to: TODAY - DAY_MS } })
    expect(buildFeed(past).some((i) => i.kind === 'lowStock')).toBe(false)
  })

  test('a request that is not waiting is not on the calendar', () => {
    const feed = input({ requests: [request('r1', { status: 'approved' })] })
    expect(buildFeed(feed).some((i) => i.kind === 'prPending')).toBe(false)
  })
})
