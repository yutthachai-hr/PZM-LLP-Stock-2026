// The baseQty backfill for old order lines (plan A2): a dry-run plan, never silent.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { classifyPoBaseQty, planPoBaseQtyBackfill } from '../src/lib/poBaseQtyBackfill'
import type { Product, PurchaseOrder } from '../src/types'

const product = (id: string, over: Partial<Product> = {}): Product =>
  ({ id, sku: id, name: id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over }) as Product
const order = (id: string, status: PurchaseOrder['status'], lines: PurchaseOrder['lines']): PurchaseOrder =>
  ({ id, docNo: `PO-${id}`, supplierId: 's', supplierName: 'S', status, locationId: 'wh', orderedAt: 0, lines, createdBy: 'u', createdByName: 'U', createdAt: 0, updatedAt: 0 }) as PurchaseOrder

describe('planPoBaseQtyBackfill', () => {
  const products = [product('cheese', { unitConversions: [{ label: 'Pack', size: 2.5 }] }), product('ham')]

  test('sets an open order line keyed in another unit at today\'s rate', () => {
    const plan = planPoBaseQtyBackfill([order('1', 'ordered', [{ productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', orderedQty: 4 }])], products)
    expect(plan.set).toEqual([expect.objectContaining({ poId: '1', index: 0, factor: 2.5, baseQty: 10 })])
    expect(plan.gaps).toEqual([])
  })

  test('leaves alone: own-unit lines, lines that have it, and orders no longer open', () => {
    const plan = planPoBaseQtyBackfill(
      [
        order('1', 'ordered', [
          { productId: 'ham', productName: 'HAM', unit: 'KG', orderedQty: 3 },
          { productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', orderedQty: 2, baseQty: 5 },
        ]),
        order('2', 'received', [{ productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', orderedQty: 2 }]),
        order('3', 'cancelled', [{ productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', orderedQty: 2 }]),
      ],
      products,
    )
    expect(plan).toMatchObject({ ordersScanned: 1, linesScanned: 2, set: [], gaps: [] })
  })

  test('a line it cannot work out is reported, never skipped quietly', () => {
    const plan = planPoBaseQtyBackfill(
      [
        order('1', 'ordered', [
          { productId: 'ham', productName: 'HAM', unit: 'KG', entryUnit: 'Leg', orderedQty: 2 },
          { productId: 'gone', productName: 'GONE', unit: 'KG', entryUnit: 'Pack', orderedQty: 1 },
        ]),
      ],
      products,
    )
    expect(plan.set).toEqual([])
    expect(plan.gaps.map((g) => [g.productName, g.why])).toEqual([
      ['HAM', 'noRate'],
      ['GONE', 'productMissing'],
    ])
  })
})

describe('classifyPoBaseQty — the release dry-run report', () => {
  const cheese = product('cheese', { unitConversions: [{ label: 'Pack', size: 2.5 }] })
  const flour = product('flour', { unitType: 'Bag', unit: 'Bag', unitConversions: [{ label: 'Pallet', size: 40 }] })
  const line = (productId: string, over: Partial<PurchaseOrder['lines'][number]> = {}) =>
    ({ productId, productName: productId.toUpperCase(), unit: 'KG', entryUnit: 'Pack', orderedQty: 4, ...over }) as PurchaseOrder['lines'][number]

  test('every line lands in exactly one class, and only safe lines would change', () => {
    const r = classifyPoBaseQty(
      [
        order('1', 'ordered', [
          line('cheese', { entryUnit: undefined }), // valid: own unit
          line('cheese', { baseQty: 10 }), // valid: agrees with 2.5
          line('cheese'), // safe: 4 × 2.5
          line('cheese', { baseQty: 12 }), // ambiguous: 3 per Pack ≠ 2.5
          line('cheese', { receivedQty: 1 }), // ambiguous: part received
          line('gone'), // invalid: product missing
          line('cheese', { entryUnit: 'Box' }), // invalid: no rate
          line('cheese', { orderedQty: 0 }), // invalid: bad quantity
          line('flour', { entryUnit: 'Pallet', unit: 'KG' }), // ambiguous: base unit was KG, now Bag
        ]),
        order('2', 'received', [line('cheese')]), // closed
      ],
      [cheese, flour],
    )
    expect(r.totalLines).toBe(10)
    expect(r.counts).toEqual({ valid: 2, safe: 1, ambiguous: 3, invalid: 3, closed: 1 })
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(r.totalLines)
    expect(r.wouldChange).toBe(1)
    expect(r.lines.find((l) => l.class === 'safe')).toMatchObject({ index: 2, proposed: 10, factorToday: 2.5 })
    expect(r.lines.filter((l) => l.class === 'ambiguous').map((l) => l.why)).toEqual([['baseQtyDisagrees'], ['partReceived'], ['baseUnitChanged']])
    expect(r.lines.filter((l) => l.class === 'invalid').map((l) => l.why)).toEqual(['productMissing', 'noRate', 'badQty'])
  })

  test('the ledger converting this product and unit at another rate makes the line ambiguous, not safe', () => {
    const r = classifyPoBaseQty([order('1', 'ordered', [line('cheese')])], [cheese], [
      { productId: 'cheese', entryUnit: 'Pack', entryQty: 2, qty: 6 }, // 3 per Pack in the ledger
      { productId: 'cheese', entryUnit: 'Pack', entryQty: 2, qty: 5 }, // 2.5, today's rate
    ])
    expect(r.counts.ambiguous).toBe(1)
    expect(r.wouldChange).toBe(0)
    expect(r.lines[0]).toMatchObject({ why: ['ledgerRateDiffers'], proposed: 10, ledgerRates: [3, 2.5] })
  })

  test('a filed baseQty that matches an old ledger rate is valid (it was right when placed)', () => {
    const r = classifyPoBaseQty([order('1', 'ordered', [line('cheese', { baseQty: 12 })])], [cheese], [{ productId: 'cheese', entryUnit: 'Pack', entryQty: 1, qty: 3 }])
    expect(r.counts.valid).toBe(1)
  })
})
