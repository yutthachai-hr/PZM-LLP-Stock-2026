import { describe, expect, test } from 'vitest'
import { incomingFor, remainingBaseQty } from '../src/lib/inventoryRules/purchasing'
import { inventoryInsights } from '../src/lib/inventoryRules/insights'
import type { PurchaseOrder, PurchaseOrderLine } from '../src/types'

/** Plan A2 (audit D2): incoming is what is still owed, never what was ordered. */

const line = (over: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine => ({ productId: 'p1', productName: 'P', unit: 'KG', orderedQty: 10, ...over })
const order = (lines: PurchaseOrderLine[], over: Partial<PurchaseOrder> = {}) =>
  ({ id: 'o', docNo: 'PO-1', status: 'ordered', supplierId: 's', locationId: 'main', orderedAt: 0, lines, ...over }) as PurchaseOrder
const bag = { unitType: 'KG', unitConversions: [{ label: 'Bag', size: 25 }] }

describe('remainingBaseQty', () => {
  test('nothing received: the whole line', () => {
    expect(remainingBaseQty(line())).toEqual({ qty: 10, estimated: false, unknown: false })
  })
  test('part received: only the rest', () => {
    expect(remainingBaseQty(line({ receivedQty: 6 })).qty).toBe(4)
  })
  test('over-delivered: nothing, never negative', () => {
    expect(remainingBaseQty(line({ receivedQty: 12 })).qty).toBe(0)
  })
  test('another unit: converted at the rate the order was placed at, not today', () => {
    // 4 Bag ordered when a bag was 25 kg (baseQty 100); 1 bag arrived; the rate is now 30.
    const l = line({ entryUnit: 'Bag', orderedQty: 4, baseQty: 100, receivedQty: 1 })
    expect(remainingBaseQty(l, { unitType: 'KG', unitConversions: [{ label: 'Bag', size: 30 }] })).toEqual({ qty: 75, estimated: false, unknown: false })
  })
  test('old line in another unit with no base quantity: estimated at today’s rate, and says so', () => {
    expect(remainingBaseQty(line({ entryUnit: 'Bag', orderedQty: 2 }), bag)).toEqual({ qty: 50, estimated: true, unknown: false })
  })
  test('old line with no rate anywhere: left out, flagged unknown rather than counted as nothing silently', () => {
    expect(remainingBaseQty(line({ entryUnit: 'Crate', orderedQty: 2 }), bag)).toEqual({ qty: 0, estimated: false, unknown: true })
    expect(remainingBaseQty(line({ entryUnit: 'Crate', orderedQty: 2, receivedQty: 2 }), bag).unknown).toBe(false)
  })
  test('fractions keep the ledger’s three decimals', () => {
    expect(remainingBaseQty(line({ orderedQty: 1.2, receivedQty: 0.4 })).qty).toBe(0.8)
  })
})

describe('incomingFor', () => {
  test('a part-delivered order counts only what is still owed (the arrived part is already on hand)', () => {
    expect(incomingFor('p1', 'main', [order([line({ receivedQty: 7 })])])).toBe(3)
  })
  test('closed and cancelled orders count nothing — a closed remainder stops counting', () => {
    const orders = [order([line({ receivedQty: 4 })], { status: 'received' }), order([line()], { status: 'cancelled' }), order([line()], { status: 'draft' })]
    expect(incomingFor('p1', 'main', orders)).toBe(0)
  })
  test('the same product on two lines of one order adds up, each line on its own', () => {
    expect(incomingFor('p1', 'main', [order([line({ receivedQty: 12 }), line({ orderedQty: 5, receivedQty: 1 })])])).toBe(4)
  })
  test('with the product given, an old line in another unit is estimated instead of ignored', () => {
    expect(incomingFor('p1', 'main', [order([line({ entryUnit: 'Bag', orderedQty: 2 })])])).toBe(0)
    expect(incomingFor('p1', 'main', [order([line({ entryUnit: 'Bag', orderedQty: 2 })])], bag)).toBe(50)
  })
})

describe('reorder advice uses what is still owed', () => {
  test('a part-delivered order no longer hides a shortage', () => {
    // 10 on order, 8 arrived (now on hand 8). Min 15. Before A2 incoming read 10 and the
    // shelf looked covered (8 + 10 = 18); really only 2 more are coming (8 + 2 = 10 < 15).
    const product = { id: 'p1', name: 'P', sku: 'P', unitType: 'KG', active: true } as never
    const insights = inventoryInsights({
      now: Date.UTC(2026, 9, 6),
      products: [product],
      locations: [{ id: 'main', name: 'Main' } as never],
      movements: [],
      orders: [order([line({ receivedQty: 8 })])],
      requests: [],
      suppliers: [],
      settings: { coverDays: 7, usageWindowDays: 28 } as never,
      qtyAt: () => 8,
      minFor: () => 15,
      tracksProduct: () => true,
    } as never)
    const r = insights.reorders.find((x) => x.product.id === 'p1')
    expect(r?.incoming).toBe(2)
  })
})
