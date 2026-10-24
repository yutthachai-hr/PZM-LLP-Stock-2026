/**
 * Receipt Price Resolver (R69 AGENT03)
 *
 * Resolves receipt item prices according to the Owner's precedence rules:
 * 1) Active SupplierItem for (supplierId, productId) with finite buyingPrice >= 0 -> 'supplierPrice'
 * 2) Latest costHistory entry with effectiveAt <= asOf -> 'costAsOf' (with effectiveAt)
 * 3) product.cost (or newest history entry when all entries are after asOf) -> 'costLatest'
 * 4) Missing (unitPrice null - never 0) -> 'missing'
 *
 * FACT: PurchaseOrderLine has NO agreed-price snapshot field. Do not invent or add one;
 * never label any price as the PO's agreed price.
 *
 * Brand scoping: The caller passes the current brand's data (product, supplierItems, line).
 * This module is pure and does not query or write to backend or services.
 */

import type { CostEntry, Product, PurchaseOrderLine, SupplierItem } from '../types'

export type PriceSource = 'supplierPrice' | 'costAsOf' | 'costLatest' | 'missing'

export interface ReceiptPrice {
  source: PriceSource
  /** Per ONE displayed unit = line.entryUnit ?? line.unit */
  unitPrice: number | null
  unit: string
  /** Per product own unit */
  basePrice: number | null
  /** Present for costAsOf only */
  effectiveAt?: number
}

/**
 * Resolves unit price and base price for a received PO line.
 * Brand scoping: Caller passes brand-scoped line, product, and supplierItems.
 */
export function resolveReceiptPrice(p: {
  line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'>
  supplierId: string
  product?: Pick<Product, 'id' | 'cost' | 'costHistory'>
  supplierItems: readonly Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[]
  asOf: number
}): ReceiptPrice {
  const { line, supplierId, product, supplierItems, asOf } = p
  const displayedUnit = line.entryUnit ?? line.unit

  // Displayed-unit conversion uses the PO's preserved rate (baseQty / orderedQty)
  // ONLY when entryUnit is set and baseQty is a finite number and orderedQty > 0, else factor 1.
  // Note: do NOT use current product.unitConversions - later rate changes must not reprice placed orders.
  const hasPreservedRate =
    typeof line.entryUnit === 'string' &&
    line.entryUnit.trim() !== '' &&
    typeof line.baseQty === 'number' &&
    Number.isFinite(line.baseQty) &&
    typeof line.orderedQty === 'number' &&
    Number.isFinite(line.orderedQty) &&
    line.orderedQty > 0

  const factor = hasPreservedRate ? (line.baseQty as number) / line.orderedQty : 1

  // 1) Active SupplierItem of THIS supplierId + productId with finite buyingPrice >= 0
  const matchedSupplierItem = supplierItems.find(
    (item) =>
      item.active &&
      item.supplierId === supplierId &&
      item.productId === line.productId &&
      typeof item.buyingPrice === 'number' &&
      Number.isFinite(item.buyingPrice) &&
      item.buyingPrice >= 0,
  )

  if (matchedSupplierItem) {
    const basePrice = matchedSupplierItem.buyingPrice as number
    return {
      source: 'supplierPrice',
      basePrice,
      unitPrice: basePrice * factor,
      unit: displayedUnit,
    }
  }

  // Filter valid costHistory entries
  const validHistory = (product?.costHistory ?? []).filter(
    (entry): entry is CostEntry =>
      typeof entry.cost === 'number' &&
      Number.isFinite(entry.cost) &&
      entry.cost >= 0 &&
      typeof entry.effectiveAt === 'number' &&
      Number.isFinite(entry.effectiveAt),
  )

  // 2) Latest costHistory entry with effectiveAt <= asOf (boundary included)
  let bestAsOf: CostEntry | undefined
  for (const entry of validHistory) {
    if (entry.effectiveAt <= asOf) {
      if (!bestAsOf || entry.effectiveAt >= bestAsOf.effectiveAt) {
        bestAsOf = entry
      }
    }
  }

  if (bestAsOf) {
    const basePrice = bestAsOf.cost
    return {
      source: 'costAsOf',
      basePrice,
      unitPrice: basePrice * factor,
      unit: displayedUnit,
      effectiveAt: bestAsOf.effectiveAt,
    }
  }

  // 3) product.cost (or newest history when all entries are after asOf) -> 'costLatest'
  let newestHistory: CostEntry | undefined
  for (const entry of validHistory) {
    if (!newestHistory || entry.effectiveAt >= newestHistory.effectiveAt) {
      newestHistory = entry
    }
  }

  const latestCost =
    newestHistory !== undefined
      ? newestHistory.cost
      : typeof product?.cost === 'number' && Number.isFinite(product.cost) && product.cost >= 0
        ? product.cost
        : undefined

  if (latestCost !== undefined) {
    return {
      source: 'costLatest',
      basePrice: latestCost,
      unitPrice: latestCost * factor,
      unit: displayedUnit,
    }
  }

  // 4) Missing (unitPrice null - never 0)
  return {
    source: 'missing',
    basePrice: null,
    unitPrice: null,
    unit: displayedUnit,
  }
}

/**
 * Calculates line amount for entered quantity rounded to 2 decimal places (satang).
 * Returns null when qty is null (not entered), invalid, or price is missing.
 */
export function lineAmount(price: ReceiptPrice, qty: number | null): number | null {
  if (qty === null || typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
    return null
  }
  if (
    price.unitPrice === null ||
    typeof price.unitPrice !== 'number' ||
    !Number.isFinite(price.unitPrice) ||
    price.unitPrice < 0
  ) {
    return null
  }

  const raw = qty * price.unitPrice
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * Calculates receipt total and line status counts.
 * Total is the sum of rounded line amounts of priced + entered rows only.
 */
export function receiptTotal(rows: readonly { price: ReceiptPrice; qty: number | null }[]): {
  total: number
  pricedLines: number
  missingLines: number
  unenteredLines: number
} {
  let total = 0
  let pricedLines = 0
  let missingLines = 0
  let unenteredLines = 0

  for (const row of rows) {
    if (row.qty === null || typeof row.qty !== 'number' || !Number.isFinite(row.qty)) {
      unenteredLines++
    } else {
      const amt = lineAmount(row.price, row.qty)
      if (amt !== null) {
        pricedLines++
        total += amt
      } else {
        missingLines++
      }
    }
  }

  return {
    total: Math.round((total + Number.EPSILON) * 100) / 100,
    pricedLines,
    missingLines,
    unenteredLines,
  }
}
