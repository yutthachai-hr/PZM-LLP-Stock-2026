import type { Product } from '../types'

/**
 * The product a scan means (spec §3).
 *
 * Exact, not fuzzy: a scanner hands over the number printed on the box, and "close enough"
 * on a stock movement is a wrong balance. Whitespace is trimmed (some readers append a
 * newline) and case ignored, because a Code 128 label may carry letters.
 *
 * Hidden products are not offered — nothing should be filed against them — and a duplicate
 * cannot happen: services/products refuses a barcode another product already carries.
 */
export function findByBarcode(products: readonly Product[], code: string): Product | undefined {
  const needle = code.trim().toLowerCase()
  if (!needle) return undefined
  return products.find((p) => p.active !== false && (p.barcode ?? '').trim().toLowerCase() === needle)
}

/** The fields a product is searched by, including its barcode when it has one. */
export function searchFields(p: Product): (string | undefined)[] {
  return [p.name, p.sku, p.barcode]
}
