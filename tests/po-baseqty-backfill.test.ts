// The baseQty backfill for old order lines (plan A2): a dry-run plan, never silent.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { planPoBaseQtyBackfill } from '../src/lib/poBaseQtyBackfill'
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
