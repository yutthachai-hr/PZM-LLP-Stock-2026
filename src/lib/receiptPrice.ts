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

import { sameUnit } from './units'
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

function normalizeZero(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null
  return Object.is(n, -0) ? 0 : n
}

function isBetterCostEntry(candidate: CostEntry, current: CostEntry): boolean {
  if (candidate.effectiveAt > current.effectiveAt) return true
  if (candidate.effectiveAt < current.effectiveAt) return false
  const candAt = typeof candidate.at === 'number' && Number.isFinite(candidate.at) ? candidate.at : -Infinity
  const currAt = typeof current.at === 'number' && Number.isFinite(current.at) ? current.at : -Infinity
  return candAt > currAt
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

  const cleanEntryUnit =
    typeof line.entryUnit === 'string' && line.entryUnit.trim() !== ''
      ? line.entryUnit.trim()
      : undefined
  const displayedUnit = cleanEntryUnit ?? line.unit

  const isAlternateUnit = cleanEntryUnit !== undefined && !sameUnit(cleanEntryUnit, line.unit)

  const hasPreservedRate =
    typeof line.baseQty === 'number' &&
    Number.isFinite(line.baseQty) &&
    line.baseQty > 0 &&
    typeof line.orderedQty === 'number' &&
    Number.isFinite(line.orderedQty) &&
    line.orderedQty > 0

  if (isAlternateUnit && !hasPreservedRate) {
    return {
      source: 'missing',
      basePrice: null,
      unitPrice: null,
      unit: displayedUnit,
    }
  }

  const factor = hasPreservedRate ? (line.baseQty as number) / line.orderedQty : 1
  if (!Number.isFinite(factor) || factor <= 0) {
    return {
      source: 'missing',
      basePrice: null,
      unitPrice: null,
      unit: displayedUnit,
    }
  }

  // 1) Active SupplierItem of THIS supplierId + productId with finite buyingPrice >= 0
  const activeMatchingSupplierItems = supplierItems.filter(
    (item) =>
      item.active &&
      item.supplierId === supplierId &&
      item.productId === line.productId &&
      typeof item.buyingPrice === 'number' &&
      Number.isFinite(item.buyingPrice) &&
      item.buyingPrice >= 0,
  )

  if (activeMatchingSupplierItems.length > 0) {
    const firstPrice = activeMatchingSupplierItems[0].buyingPrice
    const allSamePrice = activeMatchingSupplierItems.every((item) => item.buyingPrice === firstPrice)
    if (allSamePrice) {
      const basePrice = normalizeZero(firstPrice) as number
      const unitPrice = normalizeZero(basePrice * factor)
      if (unitPrice !== null && Number.isFinite(unitPrice) && unitPrice >= 0) {
        return {
          source: 'supplierPrice',
          basePrice,
          unitPrice,
          unit: displayedUnit,
        }
      }
    }
    // Conflicting active supplier items: skip ambiguous supplier source, proceed to product fallback
  }

  // Only use product cost and history when product.id === line.productId
  const matchingProduct =
    product && typeof line.productId === 'string' && line.productId !== '' && product.id === line.productId
      ? product
      : undefined

  // Filter valid costHistory entries
  const validHistory = (matchingProduct?.costHistory ?? []).filter(
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
      if (!bestAsOf || isBetterCostEntry(entry, bestAsOf)) {
        bestAsOf = entry
      }
    }
  }

  if (bestAsOf) {
    const basePrice = normalizeZero(bestAsOf.cost) as number
    const unitPrice = normalizeZero(basePrice * factor)
    if (unitPrice !== null && Number.isFinite(unitPrice) && unitPrice >= 0) {
      return {
        source: 'costAsOf',
        basePrice,
        unitPrice,
        unit: displayedUnit,
        effectiveAt: bestAsOf.effectiveAt,
      }
    }
  }

  // 3) product.cost (or newest history when all entries are after asOf) -> 'costLatest'
  // Prefer valid product.cost before newest future history if both exist
  const hasProductCost =
    typeof matchingProduct?.cost === 'number' &&
    Number.isFinite(matchingProduct.cost) &&
    matchingProduct.cost >= 0

  let newestHistory: CostEntry | undefined
  if (!hasProductCost) {
    for (const entry of validHistory) {
      if (!newestHistory || isBetterCostEntry(entry, newestHistory)) {
        newestHistory = entry
      }
    }
  }

  const latestCost = hasProductCost
    ? matchingProduct!.cost
    : newestHistory !== undefined
      ? newestHistory.cost
      : undefined

  if (latestCost !== undefined) {
    const basePrice = normalizeZero(latestCost) as number
    const unitPrice = normalizeZero(basePrice * factor)
    if (unitPrice !== null && Number.isFinite(unitPrice) && unitPrice >= 0) {
      return {
        source: 'costLatest',
        basePrice,
        unitPrice,
        unit: displayedUnit,
      }
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
 * Returns null when qty is null (not entered), invalid, overflow, or price is missing.
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
  if (!Number.isFinite(raw) || raw < 0) {
    return null
  }
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100
  if (!Number.isFinite(rounded) || rounded < 0) {
    return null
  }
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
    if (row.qty === null || typeof row.qty !== 'number' || !Number.isFinite(row.qty) || row.qty < 0) {
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

  const roundedTotal = Math.round((total + Number.EPSILON) * 100) / 100
  return {
    total: Object.is(roundedTotal, -0) || !Number.isFinite(roundedTotal) ? 0 : roundedTotal,
    pricedLines,
    missingLines,
    unenteredLines,
  }
}
