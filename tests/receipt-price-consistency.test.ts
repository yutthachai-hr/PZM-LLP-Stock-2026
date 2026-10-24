import { describe, expect, test } from 'vitest'
import {
  lineAmount,
  receiptTotal,
  resolveReceiptPrice,
} from '../src/lib/receiptPrice'
import { toBase, resolveFactor } from '../src/lib/uom'
import {
  summarise,
  variance,
  type PoLineEntry,
} from '../src/pages/receive/receipt'
import type { Product, PurchaseOrder, PurchaseOrderLine, SupplierItem } from '../src/types'

/**
 * Exactly mirrors how receiving converts an arrived PO line's received quantity
 * into the product's own unit when filing stock movements (src/services/purchaseOrders.ts:608-621).
 */
function filingStockQty(
  line: Pick<PurchaseOrderLine, 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'>,
  product: Pick<Product, 'unitType' | 'unitConversions'> | undefined,
  qty: number,
): number {
  if (!line.entryUnit) {
    return qty
  }
  let factor = line.baseQty !== undefined && line.orderedQty > 0 ? line.baseQty / line.orderedQty : null
  if (factor === null && product) {
    factor = resolveFactor(product, line.entryUnit)
  }
  if (factor === null) {
    throw new Error(`Missing conversion factor for unit ${line.entryUnit}`)
  }
  return toBase(qty, factor)
}

/** 2-decimal satang rounding helper */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

describe('R69 AGENT03: Receipt price unit-conversion consistency', () => {
  describe('Synthetic lines: price shown agrees with stock actually filed', () => {
    test('1) own unit: lineAmount === round2(basePrice * filingStockQty)', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-own',
        unit: 'EA',
        orderedQty: 10,
      }
      const supplierItems: Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[] = [
        { supplierId: 'sup-1', productId: 'prod-own', buyingPrice: 50.0, active: true },
      ]
      const price = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        supplierItems,
        asOf: 1000,
      })

      const qty = 7
      const filedQty = filingStockQty(line, undefined, qty)
      expect(filedQty).toBe(7)

      const amount = lineAmount(price, qty)
      const expectedAmount = round2((price.basePrice as number) * filedQty)
      expect(amount).toBe(350.0)
      expect(amount).toBe(expectedAmount)
    })

    test('2) Carton=24 EA via baseQty/orderedQty: lineAmount === round2(basePrice * filingStockQty)', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-carton',
        unit: 'EA',
        entryUnit: 'Carton',
        orderedQty: 5,
        baseQty: 120, // 120 EA / 5 Carton = 24 EA per Carton
      }
      const supplierItems: Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[] = [
        { supplierId: 'sup-1', productId: 'prod-carton', buyingPrice: 12.5, active: true }, // 12.50 THB per EA
      ]
      const price = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        supplierItems,
        asOf: 1000,
      })

      expect(price.unitPrice).toBe(300.0) // 12.50 * 24

      // Whole carton receipt
      const qty1 = 2
      const filedQty1 = filingStockQty(line, undefined, qty1)
      expect(filedQty1).toBe(48) // 48 EA filed into inventory
      const amount1 = lineAmount(price, qty1)
      const expectedAmount1 = round2((price.basePrice as number) * filedQty1)
      expect(amount1).toBe(600.0)
      expect(amount1).toBe(expectedAmount1)

      // Fractional carton receipt (1.5 cartons)
      const qty2 = 1.5
      const filedQty2 = filingStockQty(line, undefined, qty2)
      expect(filedQty2).toBe(36) // 36 EA filed into inventory
      const amount2 = lineAmount(price, qty2)
      const expectedAmount2 = round2((price.basePrice as number) * filedQty2)
      expect(amount2).toBe(450.0)
      expect(amount2).toBe(expectedAmount2)
    })

    test('3) Pack ordered with later-changed product.unitConversions: rate change does NOT alter receipt price or filing', () => {
      // Order placed when 1 Pack = 6 EA
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-pack',
        unit: 'EA',
        entryUnit: 'Pack',
        orderedQty: 10,
        baseQty: 60, // 60 EA / 10 Pack = 6 EA per Pack
      }

      const productBefore: Pick<Product, 'id' | 'cost' | 'unitType' | 'unitConversions'> = {
        id: 'prod-pack',
        unitType: 'EA',
        cost: 15.0,
        unitConversions: [{ label: 'Pack', size: 6, of: 'EA' }],
      }

      // Later: user reconfigures product in settings to 1 Pack = 12 EA
      const productAfter: Pick<Product, 'id' | 'cost' | 'unitType' | 'unitConversions'> = {
        id: 'prod-pack',
        unitType: 'EA',
        cost: 15.0,
        unitConversions: [{ label: 'Pack', size: 12, of: 'EA' }],
      }

      const priceWithBefore = resolveReceiptPrice({
        line,
        supplierId: 'sup-none',
        product: productBefore,
        supplierItems: [],
        asOf: 1000,
      })

      const priceWithAfter = resolveReceiptPrice({
        line,
        supplierId: 'sup-none',
        product: productAfter,
        supplierItems: [],
        asOf: 1000,
      })

      // Price resolver is immune to product.unitConversions changes
      expect(priceWithBefore.unitPrice).toBe(90.0) // 15 * 6
      expect(priceWithAfter.unitPrice).toBe(90.0) // Still 15 * 6, NOT 15 * 12
      expect(priceWithAfter.unitPrice).toBe(priceWithBefore.unitPrice)

      // Received 4 packs
      const qty = 4
      const filedQtyWithAfter = filingStockQty(line, productAfter, qty)
      expect(filedQtyWithAfter).toBe(24) // 24 EA filed, using preserved rate (6), NOT 48 EA

      const amount = lineAmount(priceWithAfter, qty)
      const expectedAmount = round2((priceWithAfter.basePrice as number) * filedQtyWithAfter)
      expect(amount).toBe(360.0)
      expect(amount).toBe(expectedAmount)
    })

    test('4) KG with decimals 2.72: fractional quantities and conversion preserve satang agreement', () => {
      // Subcase 4a: Direct KG product received with decimal quantity 2.72 KG
      const lineDirect: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-kg-direct',
        unit: 'KG',
        orderedQty: 10,
      }
      const priceDirect = resolveReceiptPrice({
        line: lineDirect,
        supplierId: 'sup-1',
        product: { id: 'prod-kg-direct', cost: 125.5 },
        supplierItems: [],
        asOf: 1000,
      })

      const qtyKg = 2.72
      const filedDirect = filingStockQty(lineDirect, undefined, qtyKg)
      expect(filedDirect).toBe(2.72)
      const amountDirect = lineAmount(priceDirect, qtyKg)
      const expectedDirect = round2((priceDirect.basePrice as number) * filedDirect)
      expect(amountDirect).toBe(341.36) // 2.72 * 125.5 = 341.36
      expect(amountDirect).toBe(expectedDirect)

      // Subcase 4b: Cheese block where 1 Block = 2.72 KG
      const lineBlock: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-cheese',
        unit: 'KG',
        entryUnit: 'Block',
        orderedQty: 5,
        baseQty: 13.6, // 13.6 / 5 = 2.72 KG per Block
      }
      const priceBlock = resolveReceiptPrice({
        line: lineBlock,
        supplierId: 'sup-1',
        product: { id: 'prod-cheese', cost: 250.0 }, // 250 THB per KG
        supplierItems: [],
        asOf: 1000,
      })

      expect(priceBlock.unitPrice).toBeCloseTo(680.0, 4) // 250 * 2.72 = 679.9999999999999 float

      const qtyBlocks = 3
      const filedBlocks = filingStockQty(lineBlock, undefined, qtyBlocks)
      expect(filedBlocks).toBe(8.16) // 3 * 2.72 = 8.16 KG filed into stock

      const amountBlock = lineAmount(priceBlock, qtyBlocks)
      const expectedBlock = round2((priceBlock.basePrice as number) * filedBlocks)
      expect(amountBlock).toBe(2040.0) // 3 * 680 = 2040
      expect(expectedBlock).toBe(2040.0) // 250 * 8.16 = 2040
      expect(amountBlock).toBe(expectedBlock)
    })

    test('5) tiny unit price 0.993: maintains precision and matches stock value', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-tiny',
        unit: 'EA',
        orderedQty: 100,
      }
      const price = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        product: { id: 'prod-tiny', cost: 0.993 },
        supplierItems: [],
        asOf: 1000,
      })

      // Single item: 0.993 rounds to 0.99
      const filedQty1 = filingStockQty(line, undefined, 1)
      expect(lineAmount(price, 1)).toBe(0.99)
      expect(lineAmount(price, 1)).toBe(round2((price.basePrice as number) * filedQty1))

      // 10 items: 10 * 0.993 = 9.93
      const filedQty10 = filingStockQty(line, undefined, 10)
      expect(lineAmount(price, 10)).toBe(9.93)
      expect(lineAmount(price, 10)).toBe(round2((price.basePrice as number) * filedQty10))

      // 100 items: 100 * 0.993 = 99.30
      const filedQty100 = filingStockQty(line, undefined, 100)
      expect(lineAmount(price, 100)).toBe(99.3)
      expect(lineAmount(price, 100)).toBe(round2((price.basePrice as number) * filedQty100))
    })
  })

  describe('Post-order product.unitConversions change immunity', () => {
    test('changing or deleting product.unitConversions after order placement leaves line amount unchanged', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-uom',
        unit: 'EA',
        entryUnit: 'Pack',
        orderedQty: 10,
        baseQty: 50, // 5 EA per Pack
      }

      const pOriginal: Pick<Product, 'id' | 'cost' | 'unitType' | 'unitConversions'> = {
        id: 'prod-uom',
        unitType: 'EA',
        cost: 20.0,
        unitConversions: [{ label: 'Pack', size: 5, of: 'EA' }],
      }
      const pModified: Pick<Product, 'id' | 'cost' | 'unitType' | 'unitConversions'> = {
        id: 'prod-uom',
        unitType: 'EA',
        cost: 20.0,
        unitConversions: [{ label: 'Pack', size: 50, of: 'EA' }], // changed 10x
      }
      const pDeleted: Pick<Product, 'id' | 'cost' | 'unitType' | 'unitConversions'> = {
        id: 'prod-uom',
        unitType: 'EA',
        cost: 20.0,
        unitConversions: [], // deleted
      }

      const priceOrig = resolveReceiptPrice({ line, supplierId: 's', product: pOriginal, supplierItems: [], asOf: 100 })
      const priceMod = resolveReceiptPrice({ line, supplierId: 's', product: pModified, supplierItems: [], asOf: 100 })
      const priceDel = resolveReceiptPrice({ line, supplierId: 's', product: pDeleted, supplierItems: [], asOf: 100 })

      expect(lineAmount(priceOrig, 3)).toBe(300.0) // 3 packs * (20 * 5) = 300
      expect(lineAmount(priceMod, 3)).toBe(300.0)
      expect(lineAmount(priceDel, 3)).toBe(300.0)
    })
  })

  describe('Partial receipts across two rounds sum to full quantity amount within 0.01 per round', () => {
    test('Carton line (24 EA) split across two rounds sums to full quantity amount exactly', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-c',
        unit: 'EA',
        entryUnit: 'Carton',
        orderedQty: 10,
        baseQty: 240, // 24 EA per carton
      }
      const price = resolveReceiptPrice({
        line,
        supplierId: 's',
        product: { id: 'prod-c', cost: 10.0 }, // 10 EA -> 240 Carton
        supplierItems: [],
        asOf: 100,
      })

      const fullAmount = lineAmount(price, 10)! // 2400.00
      const round1Amount = lineAmount(price, 4)! // 960.00
      const round2Amount = lineAmount(price, 6)! // 1440.00

      const sumRounds = round2(round1Amount + round2Amount)
      expect(Math.abs(sumRounds - fullAmount)).toBeLessThanOrEqual(0.01 * 2)
      expect(sumRounds).toBe(fullAmount)
    })

    test('tiny price 0.993 split across two rounds sums within 0.01 per round', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-tiny',
        unit: 'EA',
        orderedQty: 10,
      }
      const price = resolveReceiptPrice({
        line,
        supplierId: 's',
        product: { id: 'prod-tiny', cost: 0.993 },
        supplierItems: [],
        asOf: 100,
      })

      const fullAmount = lineAmount(price, 10)! // 9.93
      const round1Amount = lineAmount(price, 3)! // 3 * 0.993 = 2.979 -> 2.98
      const round2Amount = lineAmount(price, 7)! // 7 * 0.993 = 6.951 -> 6.95

      const sumRounds = round2(round1Amount + round2Amount) // 2.98 + 6.95 = 9.93
      expect(Math.abs(sumRounds - fullAmount)).toBeLessThanOrEqual(0.01 * 2)
      expect(sumRounds).toBe(fullAmount)
    })

    test('half-satang price 10.005 exhibits at most 0.01 satang delta between split and single receipt', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-half',
        unit: 'EA',
        orderedQty: 2,
      }
      const price = resolveReceiptPrice({
        line,
        supplierId: 's',
        product: { id: 'prod-half', cost: 10.005 },
        supplierItems: [],
        asOf: 100,
      })

      const fullAmount = lineAmount(price, 2)! // 2 * 10.005 = 20.01
      const round1Amount = lineAmount(price, 1)! // 10.005 -> 10.01
      const round2Amount = lineAmount(price, 1)! // 10.005 -> 10.01

      const sumRounds = round2(round1Amount + round2Amount) // 20.02
      const diff = round2(Math.abs(sumRounds - fullAmount))
      expect(diff).toBe(0.01)
      expect(diff).toBeLessThanOrEqual(0.01 * 2) // within 0.01 per round
    })

    test('KG decimals 2.72 split across two rounds sums within 0.01 per round', () => {
      const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-cheese',
        unit: 'KG',
        orderedQty: 5.44, // 2 blocks of 2.72 KG
      }
      const price = resolveReceiptPrice({
        line,
        supplierId: 's',
        product: { id: 'prod-cheese', cost: 123.45 },
        supplierItems: [],
        asOf: 100,
      })

      const fullAmount = lineAmount(price, 5.44)! // 5.44 * 123.45 = 671.568 -> 671.57
      const round1Amount = lineAmount(price, 2.72)! // 2.72 * 123.45 = 335.784 -> 335.78
      const round2Amount = lineAmount(price, 2.72)! // 335.78

      const sumRounds = round2(round1Amount + round2Amount) // 671.56
      const diff = round2(Math.abs(sumRounds - fullAmount))
      expect(diff).toBe(0.01)
      expect(diff).toBeLessThanOrEqual(0.01 * 2)
    })
  })

  describe('Zero price → amount 0, missing → null', () => {
    const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
      productId: 'prod-z',
      unit: 'EA',
      orderedQty: 5,
    }

    test('zero price yields amount 0 for any non-negative entered quantity', () => {
      const zeroSupplierPrice = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        supplierItems: [{ supplierId: 'sup-1', productId: 'prod-z', buyingPrice: 0, active: true }],
        asOf: 100,
      })
      expect(zeroSupplierPrice.unitPrice).toBe(0)
      expect(lineAmount(zeroSupplierPrice, 5)).toBe(0)
      expect(lineAmount(zeroSupplierPrice, 0)).toBe(0)

      const zeroCostLatest = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        product: { id: 'prod-z', cost: 0 },
        supplierItems: [],
        asOf: 100,
      })
      expect(zeroCostLatest.unitPrice).toBe(0)
      expect(lineAmount(zeroCostLatest, 5)).toBe(0)
    })

    test('missing price yields null for any quantity', () => {
      const missingPrice = resolveReceiptPrice({
        line,
        supplierId: 'sup-1',
        product: undefined,
        supplierItems: [],
        asOf: 100,
      })
      expect(missingPrice.source).toBe('missing')
      expect(missingPrice.unitPrice).toBeNull()
      expect(lineAmount(missingPrice, 5)).toBeNull()
      expect(lineAmount(missingPrice, 0)).toBeNull()
      expect(lineAmount(missingPrice, null)).toBeNull()
    })
  })

  describe('Workflow harmony: summarise(), variance(), and receipt totals', () => {
    test('receiptTotal aligns with summarise line statuses on partial delivery', () => {
      const order: Pick<PurchaseOrder, 'lines'> = {
        lines: [
          { productId: 'p1', productName: 'Line 1 (Carton)', unit: 'EA', entryUnit: 'Carton', orderedQty: 5, baseQty: 120 },
          { productId: 'p2', productName: 'Line 2 (Direct EA)', unit: 'EA', orderedQty: 10 },
          { productId: 'p3', productName: 'Line 3 (Unentered)', unit: 'KG', orderedQty: 2 },
        ] as PurchaseOrderLine[],
      }

      // Screen entries: Line 1 short (3/5), Line 2 match (10/10), Line 3 unentered (null)
      const entries: Record<string, PoLineEntry> = {
        p1: { qty: 3, reason: 'supplier short' },
        p2: { qty: 10, reason: '' },
        p3: { qty: null, reason: '' },
      }

      // Check receive screen arithmetic
      expect(variance(5, entries.p1.qty)).toBe('short')
      expect(variance(10, entries.p2.qty)).toBe('match')
      expect(variance(2, entries.p3.qty)).toBe('pending')

      const summary = summarise(order, entries)
      expect(summary).toMatchObject({
        items: 3,
        matched: 1,
        short: 1,
        over: 0,
        pending: 1,
        unexplained: 0,
        arriving: 2,
      })

      // Check receipt price resolver integration
      const price1 = resolveReceiptPrice({
        line: order.lines[0],
        supplierId: 's',
        product: { id: 'p1', cost: 10 }, // 10 EA * 24 = 240/Carton
        supplierItems: [],
        asOf: 100,
      })
      const price2 = resolveReceiptPrice({
        line: order.lines[1],
        supplierId: 's',
        product: { id: 'p2', cost: 15 }, // 15/EA
        supplierItems: [],
        asOf: 100,
      })
      const price3 = resolveReceiptPrice({
        line: order.lines[2],
        supplierId: 's',
        product: { id: 'p3', cost: 100 },
        supplierItems: [],
        asOf: 100,
      })

      const rows = [
        { price: price1, qty: entries.p1.qty }, // 3 * 240 = 720
        { price: price2, qty: entries.p2.qty }, // 10 * 15 = 150
        { price: price3, qty: entries.p3.qty }, // null -> unentered
      ]

      const totals = receiptTotal(rows)
      expect(totals.total).toBe(870.0) // 720 + 150
      expect(totals.pricedLines).toBe(2)
      expect(totals.missingLines).toBe(0)
      expect(totals.unenteredLines).toBe(1)
    })
  })

  test('documents 3dp stock rounding versus an entry-quantity price estimate for a fractional block', () => {
    const line = { productId: 'fractional-block', unit: 'KG', entryUnit: 'Block', orderedQty: 5, baseQty: 13.6 }
    const price = resolveReceiptPrice({
      line,
      supplierId: 'sup-1',
      supplierItems: [{ supplierId: 'sup-1', productId: line.productId, buyingPrice: 1000, active: true }],
      asOf: 1000,
    })
    const filedQty = filingStockQty(line, undefined, 0.333)
    expect(filedQty).toBe(0.906)
    expect(lineAmount(price, 0.333)).toBe(905.76)
    expect(round2((price.basePrice as number) * filedQty)).toBe(906)
    // This estimate prices entered units; it is not a valuation of 3dp-rounded stock.
  })

  describe('Finding documentation: legacy lines without baseQty', () => {
    test('documents difference when baseQty is absent: resolver treats alternate unit without preserved rate as missing (null), while filing falls back to resolveFactor', () => {
      // Line created before baseQty was saved on PO line (legacy PO)
      const legacyLine: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
        productId: 'prod-legacy',
        unit: 'EA',
        entryUnit: 'Pack',
        orderedQty: 5,
        baseQty: undefined, // missing on legacy order
      }

      const product: Pick<Product, 'id' | 'cost' | 'unitType' | 'unitConversions'> = {
        id: 'prod-legacy',
        unitType: 'EA',
        cost: 20.0,
        unitConversions: [{ label: 'Pack', size: 6, of: 'EA' }],
      }

      // Resolver (pure, no dynamic lookup per contract §3.2; alternate unit without preserved rate returns missing/null):
      const res = resolveReceiptPrice({
        line: legacyLine,
        supplierId: 's',
        product,
        supplierItems: [],
        asOf: 100,
      })
      expect(res.source).toBe('missing')
      expect(res.unitPrice).toBeNull()
      expect(res.basePrice).toBeNull()

      // Filing code (src/services/purchaseOrders.ts:614) queries product and uses resolveFactor:
      const filingQty = filingStockQty(legacyLine, product, 2)
      expect(filingQty).toBe(12) // 2 packs * 6 = 12 EA

      // When baseQty is present (modern orders placed since preserved rate was added), both strictly agree:
      const modernLine = { ...legacyLine, baseQty: 30 } // 30 EA / 5 Pack = 6 EA/Pack
      const modernPrice = resolveReceiptPrice({
        line: modernLine,
        supplierId: 's',
        product,
        supplierItems: [],
        asOf: 100,
      })
      expect(modernPrice.unitPrice).toBe(120.0) // 20 * 6
      expect(lineAmount(modernPrice, 2)).toBe(240.0)
      expect(round2((modernPrice.basePrice as number) * filingStockQty(modernLine, product, 2))).toBe(240.0)
    })
  })
})
