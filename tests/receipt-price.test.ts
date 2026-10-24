import { describe, expect, test } from 'vitest'
import {
  lineAmount,
  receiptTotal,
  resolveReceiptPrice,
  type ReceiptPrice,
} from '../src/lib/receiptPrice'
import type { Product, PurchaseOrderLine, SupplierItem } from '../src/types'

describe('R69 AGENT03: Receipt price resolver', () => {
  const baseLine: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
    productId: 'prod-1',
    unit: 'EA',
    orderedQty: 10,
  }

  describe('Precedence and Price Sources', () => {
    test('1) active SupplierItem of this supplierId + productId with finite buyingPrice >= 0 -> supplierPrice', () => {
      const supplierItems: Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[] = [
        { supplierId: 'sup-1', productId: 'prod-1', buyingPrice: 45.5, active: true },
      ]
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        cost: 50,
        costHistory: [{ price: 50, unit: 'EA', factor: 1, cost: 50, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' }],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems,
        asOf: 2000,
      })

      expect(res.source).toBe('supplierPrice')
      expect(res.unitPrice).toBe(45.5)
      expect(res.basePrice).toBe(45.5)
      expect(res.unit).toBe('EA')
      expect(res.effectiveAt).toBeUndefined()
    })

    test('2) latest costHistory entry with effectiveAt <= asOf -> costAsOf (with effectiveAt)', () => {
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        cost: 60,
        costHistory: [
          { price: 40, unit: 'EA', factor: 1, cost: 40, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' },
          { price: 50, unit: 'EA', factor: 1, cost: 50, effectiveAt: 1500, at: 1500, by: 'u', byName: 'U' },
          { price: 60, unit: 'EA', factor: 1, cost: 60, effectiveAt: 2500, at: 2500, by: 'u', byName: 'U' },
        ],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.source).toBe('costAsOf')
      expect(res.unitPrice).toBe(50)
      expect(res.basePrice).toBe(50)
      expect(res.unit).toBe('EA')
      expect(res.effectiveAt).toBe(1500)
    })

    test('3) product.cost when no costHistory matches asOf -> costLatest', () => {
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        cost: 75,
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.source).toBe('costLatest')
      expect(res.unitPrice).toBe(75)
      expect(res.basePrice).toBe(75)
      expect(res.unit).toBe('EA')
      expect(res.effectiveAt).toBeUndefined()
    })

    test('3b) all history entries after asOf -> costLatest (newest history entry used, without effectiveAt)', () => {
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        costHistory: [
          { price: 80, unit: 'EA', factor: 1, cost: 80, effectiveAt: 3000, at: 3000, by: 'u', byName: 'U' },
          { price: 90, unit: 'EA', factor: 1, cost: 90, effectiveAt: 4000, at: 4000, by: 'u', byName: 'U' },
        ],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.source).toBe('costLatest')
      expect(res.unitPrice).toBe(90)
      expect(res.basePrice).toBe(90)
      expect(res.unit).toBe('EA')
      expect(res.effectiveAt).toBeUndefined()
    })

    test('4) missing when no supplier price and no product cost -> missing (unitPrice null, never 0)', () => {
      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: undefined,
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.source).toBe('missing')
      expect(res.unitPrice).toBeNull()
      expect(res.basePrice).toBeNull()
      expect(res.unit).toBe('EA')
      expect(res.effectiveAt).toBeUndefined()
    })

    test('precedence order: supplierPrice beats costAsOf and costLatest', () => {
      const supplierItems: Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[] = [
        { supplierId: 'sup-1', productId: 'prod-1', buyingPrice: 30, active: true },
      ]
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        cost: 60,
        costHistory: [{ price: 50, unit: 'EA', factor: 1, cost: 50, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' }],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems,
        asOf: 2000,
      })

      expect(res.source).toBe('supplierPrice')
      expect(res.unitPrice).toBe(30)
    })

    test('precedence order: costAsOf beats costLatest when costHistory has entry <= asOf', () => {
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        cost: 70, // current latest
        costHistory: [{ price: 45, unit: 'EA', factor: 1, cost: 45, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' }],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems: [],
        asOf: 1200,
      })

      expect(res.source).toBe('costAsOf')
      expect(res.unitPrice).toBe(45)
      expect(res.effectiveAt).toBe(1000)
    })
  })

  describe('Zero vs Missing and Invalid Value Handling', () => {
    test('zero is a real price, distinct from missing (0 must stay 0)', () => {
      // 0 in supplierPrice
      const resSup = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: undefined,
        supplierItems: [{ supplierId: 'sup-1', productId: 'prod-1', buyingPrice: 0, active: true }],
        asOf: 2000,
      })
      expect(resSup.source).toBe('supplierPrice')
      expect(resSup.unitPrice).toBe(0)
      expect(resSup.basePrice).toBe(0)

      // 0 in costAsOf
      const resCostAsOf = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: {
          id: 'prod-1',
          costHistory: [{ price: 0, unit: 'EA', factor: 1, cost: 0, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' }],
        },
        supplierItems: [],
        asOf: 2000,
      })
      expect(resCostAsOf.source).toBe('costAsOf')
      expect(resCostAsOf.unitPrice).toBe(0)
      expect(resCostAsOf.basePrice).toBe(0)

      // 0 in costLatest
      const resCostLatest = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: { id: 'prod-1', cost: 0 },
        supplierItems: [],
        asOf: 2000,
      })
      expect(resCostLatest.source).toBe('costLatest')
      expect(resCostLatest.unitPrice).toBe(0)
      expect(resCostLatest.basePrice).toBe(0)
    })

    test('ignores inactive supplier items', () => {
      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: { id: 'prod-1', cost: 25 },
        supplierItems: [{ supplierId: 'sup-1', productId: 'prod-1', buyingPrice: 15, active: false }],
        asOf: 2000,
      })
      expect(res.source).toBe('costLatest')
      expect(res.unitPrice).toBe(25)
    })

    test('ignores supplier items from other suppliers or other products', () => {
      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: { id: 'prod-1', cost: 25 },
        supplierItems: [
          { supplierId: 'other-sup', productId: 'prod-1', buyingPrice: 10, active: true },
          { supplierId: 'sup-1', productId: 'other-prod', buyingPrice: 12, active: true },
        ],
        asOf: 2000,
      })
      expect(res.source).toBe('costLatest')
      expect(res.unitPrice).toBe(25)
    })

    test('ignores NaN, negative, non-number buyingPrice in supplier items', () => {
      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: { id: 'prod-1', cost: 33 },
        supplierItems: [
          { supplierId: 'sup-1', productId: 'prod-1', buyingPrice: NaN, active: true },
          { supplierId: 'sup-1', productId: 'prod-1', buyingPrice: -5, active: true },
          { supplierId: 'sup-1', productId: 'prod-1', buyingPrice: undefined as unknown as number, active: true },
        ],
        asOf: 2000,
      })
      expect(res.source).toBe('costLatest')
      expect(res.unitPrice).toBe(33)
    })

    test('ignores negative or NaN costs in costHistory and product.cost', () => {
      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product: {
          id: 'prod-1',
          cost: NaN,
          costHistory: [
            { price: -10, unit: 'EA', factor: 1, cost: -10, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' },
            { price: NaN, unit: 'EA', factor: 1, cost: NaN, effectiveAt: 1500, at: 1500, by: 'u', byName: 'U' },
          ],
        },
        supplierItems: [],
        asOf: 2000,
      })
      expect(res.source).toBe('missing')
      expect(res.unitPrice).toBeNull()
      expect(res.basePrice).toBeNull()
    })
  })

  describe('As-Of Boundary Handling', () => {
    test('effectiveAt equal to asOf is included in costAsOf', () => {
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        cost: 60,
        costHistory: [
          { price: 40, unit: 'EA', factor: 1, cost: 40, effectiveAt: 1000, at: 1000, by: 'u', byName: 'U' },
          { price: 55, unit: 'EA', factor: 1, cost: 55, effectiveAt: 2000, at: 2000, by: 'u', byName: 'U' },
        ],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems: [],
        asOf: 2000, // exact match
      })

      expect(res.source).toBe('costAsOf')
      expect(res.unitPrice).toBe(55)
      expect(res.effectiveAt).toBe(2000)
    })

    test('latest effectiveAt <= asOf chosen when multiple qualify', () => {
      const product: Pick<Product, 'id' | 'cost' | 'costHistory'> = {
        id: 'prod-1',
        costHistory: [
          { price: 10, unit: 'EA', factor: 1, cost: 10, effectiveAt: 100, at: 100, by: 'u', byName: 'U' },
          { price: 20, unit: 'EA', factor: 1, cost: 20, effectiveAt: 500, at: 500, by: 'u', byName: 'U' },
          { price: 15, unit: 'EA', factor: 1, cost: 15, effectiveAt: 300, at: 300, by: 'u', byName: 'U' },
        ],
      }

      const res = resolveReceiptPrice({
        line: baseLine,
        supplierId: 'sup-1',
        product,
        supplierItems: [],
        asOf: 400,
      })

      expect(res.source).toBe('costAsOf')
      expect(res.unitPrice).toBe(15)
      expect(res.effectiveAt).toBe(300)
    })
  })

  describe('Unit Conversions via PO Preserved Rate (baseQty / orderedQty)', () => {
    test('Carton(24 EA) line converts basePrice to unitPrice for displayed unit', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-c',
        unit: 'EA', // product own unit
        entryUnit: 'Carton', // displayed unit
        orderedQty: 2, // 2 Cartons ordered
        baseQty: 48, // 48 EA in total (24 EA per Carton)
      }

      const res = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        product: { id: 'prod-c', cost: 10 }, // 10 baht per EA
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.source).toBe('costLatest')
      expect(res.basePrice).toBe(10)
      expect(res.unitPrice).toBe(240) // 10 * 24
      expect(res.unit).toBe('Carton')
    })

    test('falls back to factor 1 when entryUnit is absent or same', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-ea',
        unit: 'EA',
        orderedQty: 5,
        baseQty: 5,
      }

      const res = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        product: { id: 'prod-ea', cost: 12 },
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.unitPrice).toBe(12)
      expect(res.basePrice).toBe(12)
      expect(res.unit).toBe('EA')
    })

    test('falls back to factor 1 when baseQty is not a number or orderedQty <= 0', () => {
      const lineNoBaseQty: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-x',
        unit: 'EA',
        entryUnit: 'Pack',
        orderedQty: 5,
        baseQty: undefined,
      }

      const res1 = resolveReceiptPrice({
        line: lineNoBaseQty,
        supplierId: 'sup-1',
        product: { id: 'prod-x', cost: 20 },
        supplierItems: [],
        asOf: 2000,
      })
      expect(res1.unitPrice).toBe(20)
      expect(res1.unit).toBe('Pack')

      const lineZeroOrdered: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-x',
        unit: 'EA',
        entryUnit: 'Pack',
        orderedQty: 0,
        baseQty: 24,
      }

      const res2 = resolveReceiptPrice({
        line: lineZeroOrdered,
        supplierId: 'sup-1',
        product: { id: 'prod-x', cost: 20 },
        supplierItems: [],
        asOf: 2000,
      })
      expect(res2.unitPrice).toBe(20)
    })

    test('KG decimal products maintain full precision', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-kg',
        unit: 'KG',
        orderedQty: 2.5,
      }

      const res = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        product: { id: 'prod-kg', cost: 120.5 },
        supplierItems: [],
        asOf: 2000,
      })

      expect(res.unitPrice).toBe(120.5)
      expect(res.unit).toBe('KG')
    })
  })

  describe('lineAmount calculation and satang rounding', () => {
    const priced: ReceiptPrice = {
      source: 'supplierPrice',
      unitPrice: 100,
      unit: 'EA',
      basePrice: 100,
    }
    const missing: ReceiptPrice = {
      source: 'missing',
      unitPrice: null,
      unit: 'EA',
      basePrice: null,
    }

    test('null when qty is null (not entered) or price is missing', () => {
      expect(lineAmount(priced, null)).toBeNull()
      expect(lineAmount(missing, 5)).toBeNull()
      expect(lineAmount(missing, null)).toBeNull()
    })

    test('qty 0 entered -> amount 0 (a priced, entered line)', () => {
      expect(lineAmount(priced, 0)).toBe(0)
    })

    test('zero price with entered qty -> amount 0', () => {
      const zeroPrice: ReceiptPrice = { source: 'costLatest', unitPrice: 0, unit: 'EA', basePrice: 0 }
      expect(lineAmount(zeroPrice, 5)).toBe(0)
      expect(lineAmount(zeroPrice, 0)).toBe(0)
    })

    test('rounds to 2 dp (satang) using Math.round((x + Number.EPSILON) * 100) / 100', () => {
      const p1: ReceiptPrice = { source: 'costLatest', unitPrice: 10.005, unit: 'EA', basePrice: 10.005 }
      expect(lineAmount(p1, 1)).toBe(10.01)

      const p2: ReceiptPrice = { source: 'costLatest', unitPrice: 10.004, unit: 'EA', basePrice: 10.004 }
      expect(lineAmount(p2, 1)).toBe(10.00)

      // 0.005 alone
      const p3: ReceiptPrice = { source: 'costLatest', unitPrice: 0.005, unit: 'EA', basePrice: 0.005 }
      expect(lineAmount(p3, 1)).toBe(0.01)

      // decimal KG quantity
      const pKg: ReceiptPrice = { source: 'supplierPrice', unitPrice: 125.75, unit: 'KG', basePrice: 125.75 }
      expect(lineAmount(pKg, 1.25)).toBe(157.19) // 125.75 * 1.25 = 157.1875 -> 157.19
    })

    test('keeps full precision internally, rounding only final line amount', () => {
      // 10 / 3 per unit = 3.3333333333333335
      const pFractional: ReceiptPrice = {
        source: 'supplierPrice',
        unitPrice: 10 / 3,
        unit: 'EA',
        basePrice: 10 / 3,
      }
      expect(lineAmount(pFractional, 3)).toBe(10) // (10/3) * 3 = 10, not (3.33 * 3 = 9.99)
    })
  })

  describe('Multiple Rounds and Partial Receipt Qty', () => {
    const priceA: ReceiptPrice = { source: 'supplierPrice', unitPrice: 50, unit: 'EA', basePrice: 50 }
    const priceB: ReceiptPrice = { source: 'costLatest', unitPrice: 20, unit: 'EA', basePrice: 20 }

    test('partial receipt qty prices by entered qty, not orderedQty', () => {
      // Ordered was 10, but only 3 arrived
      expect(lineAmount(priceA, 3)).toBe(150)
    })

    test('multiple rounds: each receipt is priced by its own entered qty', () => {
      // Delivery 1 (round 1): 4 EA arrived
      const round1 = receiptTotal([
        { price: priceA, qty: 4 },
        { price: priceB, qty: null }, // line B not arriving on this delivery
      ])
      expect(round1.total).toBe(200)
      expect(round1.pricedLines).toBe(1)
      expect(round1.unenteredLines).toBe(1)

      // Delivery 2 (round 2): line A remaining 6 EA arrives, line B 5 EA arrives
      const round2 = receiptTotal([
        { price: priceA, qty: 6 },
        { price: priceB, qty: 5 },
      ])
      expect(round2.total).toBe(400) // (6 * 50) + (5 * 20) = 300 + 100 = 400
      expect(round2.pricedLines).toBe(2)
      expect(round2.unenteredLines).toBe(0)
    })
  })

  describe('receiptTotal counts and floating point summation', () => {
    const priced1: ReceiptPrice = { source: 'supplierPrice', unitPrice: 10, unit: 'EA', basePrice: 10 }
    const priced2: ReceiptPrice = { source: 'costLatest', unitPrice: 20, unit: 'EA', basePrice: 20 }
    const missing: ReceiptPrice = { source: 'missing', unitPrice: null, unit: 'EA', basePrice: null }

    test('accurately partitions and counts total, pricedLines, missingLines, unenteredLines', () => {
      const rows = [
        { price: priced1, qty: 2 }, // entered & priced: 20.00
        { price: priced2, qty: 0 }, // entered (0) & priced: 0.00 (priced line)
        { price: missing, qty: 3 }, // entered & missing price: null (missing line)
        { price: priced1, qty: null }, // unentered qty: null (unentered line)
        { price: missing, qty: null }, // unentered qty: null (unentered line)
      ]

      const res = receiptTotal(rows)

      expect(res.total).toBe(20.00)
      expect(res.pricedLines).toBe(2)
      expect(res.missingLines).toBe(1)
      expect(res.unenteredLines).toBe(2)
    })

    test('handles 0.1 + 0.2 floating point sum without float noise', () => {
      const p1: ReceiptPrice = { source: 'supplierPrice', unitPrice: 0.1, unit: 'EA', basePrice: 0.1 }
      const p2: ReceiptPrice = { source: 'supplierPrice', unitPrice: 0.2, unit: 'EA', basePrice: 0.2 }

      const res = receiptTotal([
        { price: p1, qty: 1 },
        { price: p2, qty: 1 },
      ])

      expect(res.total).toBe(0.3)
      expect(res.pricedLines).toBe(2)
      expect(res.missingLines).toBe(0)
      expect(res.unenteredLines).toBe(0)
    })

    test('empty rows return zeros', () => {
      const res = receiptTotal([])
      expect(res).toEqual({
        total: 0,
        pricedLines: 0,
        missingLines: 0,
        unenteredLines: 0,
      })
    })
  })
})
