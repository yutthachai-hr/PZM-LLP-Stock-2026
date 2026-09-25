// What an AI-read bill fills in on the receiving form (Automation Plan Phase 4, 25 Sep 2026):
// never over what a person typed, only the order's lines, only in the unit they were ordered.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { ocrFill } from '../src/pages/receive/ocrApply'
import { emptyDraft } from '../src/pages/receive/receipt'
import type { OcrMatch } from '../src/lib/billOcr'
import type { Product, PurchaseOrder, Supplier } from '../src/types'

const product = (id: string, unitType = 'KG'): Product => ({ id, sku: id, name: id.toUpperCase(), category: 'c', unit: unitType, unitType, minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0 })
const FLOUR = product('flour')
const MOZ = product('moz', 'EA')
const OLIVA: Supplier = { id: 's1', name: 'OLIVA', contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 0, updatedAt: 0 }

const match: OcrMatch = {
  matched: [
    { product: FLOUR, qty: 5, read: { name: 'Flour 00', qty: 5, unit: 'KG' } },
    { product: MOZ, qty: 16, entryUnit: 'Carton', entryQty: 2, read: { name: 'Mozzarella', qty: 2, unit: 'Carton' } },
  ],
  unmatched: [{ name: 'Mystery sauce', qty: 1 }],
}

describe('filling a hand-keyed receipt', () => {
  test('lines, supplier, bill number and date; what could not be matched is listed', () => {
    const r = ocrFill({ supplier: 'OLIVA CO., LTD.', invoiceNo: 'IV-9', date: '2026-09-25', lines: [] }, match, { draft: emptyDraft(), order: null, suppliers: [OLIVA] })
    expect(r.patch).toMatchObject({ invoiceNo: 'IV-9', docDateStr: '2026-09-25', supplierId: 's1', supplierName: 'OLIVA' })
    expect(r.patch.lines?.map((l) => [l.productId, l.qty, l.entryUnit ?? null])).toEqual([['flour', 5, null], ['moz', 16, 'Carton']])
    expect(r.filled).toBe(2)
    expect(r.skipped).toEqual([{ name: 'Mystery sauce', why: 'noProduct' }])
  })

  test('never over what was typed: the bill number, the supplier, a line already there', () => {
    const draft = { ...emptyDraft(), invoiceNo: 'MINE', supplierName: 'Makro', lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 1 }] }
    const r = ocrFill({ supplier: 'OLIVA', invoiceNo: 'IV-9', lines: [] }, match, { draft, order: null, suppliers: [OLIVA] })
    expect(r.patch.invoiceNo).toBeUndefined()
    expect(r.patch.supplierName).toBeUndefined()
    expect(r.patch.lines?.find((l) => l.productId === 'flour')?.qty).toBe(1)
    expect(r.skipped).toContainEqual({ name: 'Flour 00', why: 'already' })
  })

  test('an unknown supplier is kept as typed by hand', () => {
    const r = ocrFill({ supplier: 'New Farm', lines: [] }, { matched: [], unmatched: [] }, { draft: emptyDraft(), order: null, suppliers: [OLIVA] })
    expect(r.patch).toMatchObject({ supplierId: '__other', supplierName: 'New Farm' })
  })
})

describe('filling a delivery against an order', () => {
  const order = {
    id: 'po1', docNo: 'PO-1', supplierId: 's1', supplierName: 'OLIVA', status: 'ordered', locationId: 'wh', orderedAt: 0,
    lines: [
      { productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 },
      { productId: 'moz', productName: 'MOZ', unit: 'EA', entryUnit: 'Carton', orderedQty: 3, baseQty: 24 },
    ],
    createdBy: 'u', createdByName: 'U', createdAt: 0, updatedAt: 0,
  } as unknown as PurchaseOrder

  test('each order line takes what was read, in the unit it was ordered in', () => {
    const r = ocrFill({ lines: [] }, match, { draft: emptyDraft(), order, suppliers: [] })
    expect(r.patch.entries).toEqual({ flour: { qty: 5, reason: '' }, moz: { qty: 2, reason: '' } })
    expect(r.patch.lines).toBeUndefined()
  })

  test('a product not on the order, or read in another unit, is left for the person', () => {
    const other: OcrMatch = {
      matched: [
        { product: product('basil'), qty: 1, read: { name: 'Basil', qty: 1 } },
        { product: MOZ, qty: 16, read: { name: 'Mozzarella', qty: 16, unit: 'EA' } },
      ],
      unmatched: [],
    }
    const r = ocrFill({ lines: [] }, other, { draft: emptyDraft(), order, suppliers: [] })
    expect(r.skipped).toEqual([{ name: 'Basil', why: 'notOnOrder' }, { name: 'Mozzarella', why: 'unit' }])
    expect(r.filled).toBe(0)
  })
})
