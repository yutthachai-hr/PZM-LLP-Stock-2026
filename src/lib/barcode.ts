import type { Product } from '../types'

/**
 * Barcode resolution outcome (Workstream A P0 safety contract).
 *
 * Exact verified: exactly one active product with verified barcode.
 * Legacy unverified: single active candidate found, but lacks explicit verification proof; requires confirmation.
 * Duplicate: 2 or more products carry this barcode; fail-closed, requires human choice.
 * Inactive: product is retired/inactive; rejected.
 * Not found: unknown barcode (link request candidate); no fallback to fuzzy/name/SKU.
 * Empty: blank or whitespace-only code.
 */
export type BarcodeResolution =
  | {
      status: 'verified_exact'
      product: Product
      code: string
    }
  | {
      status: 'legacy_unverified'
      product: Product
      code: string
      message?: string
    }
  | {
      status: 'duplicate'
      candidates: Product[]
      code: string
      message?: string
    }
  | {
      status: 'inactive'
      product: Product
      code: string
      message?: string
    }
  | {
      status: 'not_found'
      code: string
      message?: string
    }
  | {
      status: 'empty'
    }

/**
 * Resolves a scanned barcode token against a brand catalogue with full safety fences:
 * 1. Tokens are preserved as-is (leading zeros kept, numeric EAN never parsed to number).
 * 2. Code 128 / Code 39 case-sensitivity preserved; distinct casing never silently merged.
 * 3. Duplicates fail closed (no implicit first match).
 * 4. Inactive products are rejected.
 * 5. Unknown barcodes return not_found without fuzzy or loose fallback.
 */
export function resolveBarcode(products: readonly Product[], code: string): BarcodeResolution {
  const needle = code.trim()
  if (!needle) return { status: 'empty' }

  const active = products.filter((p) => p.active !== false)

  // Step 1: Exact case-sensitive match
  const exactActive = active.filter((p) => (p.barcode ?? '').trim() === needle)
  if (exactActive.length > 1) {
    return { status: 'duplicate', candidates: exactActive, code: needle }
  }

  if (exactActive.length === 1) {
    const product = exactActive[0]
    return product.barcodeVerified === true
      ? { status: 'verified_exact', product, code: needle }
      : { status: 'legacy_unverified', product, code: needle }
  }

  // Step 2: Case-insensitive fallback ONLY if no exact match and no casefold collision
  const lowerNeedle = needle.toLowerCase()
  const casefoldActive = active.filter((p) => (p.barcode ?? '').trim().toLowerCase() === lowerNeedle)
  if (casefoldActive.length > 1) {
    // Distinct Code128 values or duplicate products collide on casefold -> fail closed as duplicate
    return { status: 'duplicate', candidates: casefoldActive, code: needle }
  }

  if (casefoldActive.length === 1) {
    const product = casefoldActive[0]
    return product.barcodeVerified === true
      ? { status: 'verified_exact', product, code: needle }
      : { status: 'legacy_unverified', product, code: needle }
  }

  // Step 3: Check inactive products in catalogue
  const inactive = products.filter(
    (p) =>
      p.active === false &&
      ((p.barcode ?? '').trim() === needle || (p.barcode ?? '').trim().toLowerCase() === lowerNeedle),
  )
  if (inactive.length > 0) {
    return { status: 'inactive', product: inactive[0], code: needle }
  }

  // Step 4: Not found (Unknown)
  return { status: 'not_found', code: needle }
}

/**
 * The product a scan means.
 *
 * Exact, not fuzzy: a scanner hands over the number printed on the box, and "close enough"
 * on a stock movement is a wrong balance.
 *
 * Hidden products are not offered, and duplicates fail closed (returns undefined) to prevent
 * arbitrary movement allocation.
 */
export function findByBarcode(products: readonly Product[], code: string): Product | undefined {
  const res = resolveBarcode(products, code)
  if (res.status === 'verified_exact' || res.status === 'legacy_unverified') {
    return res.product
  }
  return undefined
}

/** The fields a product is searched by, including its barcode when it has one. */
export function searchFields(p: Product): (string | undefined)[] {
  return [p.name, p.sku, p.barcode]
}

/**
 * What Enter in a product search box means.
 *
 * A barcode scanner in keyboard mode ("keyboard wedge") types the code and presses Enter.
 * Fail-closed safety:
 * - Exact unique barcode is tried first.
 * - Exact unique product code (SKU) is tried next.
 * - MUST NOT fall back to matches[0]: search suggestions are not movement authorization.
 */
export function pickOnEnter(
  products: readonly Product[],
  query: string,
  _matches?: readonly Product[],
): Product | undefined {
  const q = query.trim()
  if (!q) return undefined

  // 1. Exact unique barcode
  const barcodeRes = resolveBarcode(products, q)
  if (barcodeRes.status === 'verified_exact' || barcodeRes.status === 'legacy_unverified') {
    return barcodeRes.product
  }

  // 2. Exact unique SKU
  const lowerQ = q.toLowerCase()
  const skuMatches = products.filter((p) => p.active !== false && (p.sku ?? '').trim().toLowerCase() === lowerQ)
  if (skuMatches.length === 1) {
    return skuMatches[0]
  }

  // Fail closed: no loose name or suggestion fallback
  return undefined
}
