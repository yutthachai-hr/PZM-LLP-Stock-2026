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

  // Step 1: Exact case-sensitive match
  const exactActive = products.filter((p) => p.active !== false && (p.barcode ?? '').trim() === needle)
  if (exactActive.length > 1) {
    return { status: 'duplicate', candidates: exactActive, code: needle }
  }

  // Exact inactive match
  const exactInactive = products.filter((p) => p.active === false && (p.barcode ?? '').trim() === needle)
  if (exactInactive.length > 0) {
    if (exactActive.length > 0) {
      return { status: 'duplicate', candidates: [...exactActive, ...exactInactive], code: needle }
    }
    return { status: 'inactive', product: exactInactive[0], code: needle }
  }

  if (exactActive.length === 1) {
    const product = exactActive[0]
    return product.barcodeVerified === true
      ? { status: 'verified_exact', product, code: needle }
      : { status: 'legacy_unverified', product, code: needle }
  }

  // Step 2: Case-insensitive fallback ONLY if no exact match and no casefold collision
  const lowerNeedle = needle.toLowerCase()
  const casefoldActive = products.filter(
    (p) => p.active !== false && (p.barcode ?? '').trim().toLowerCase() === lowerNeedle,
  )
  if (casefoldActive.length > 1) {
    // Distinct Code128 values or duplicate products collide on casefold -> fail closed as duplicate
    return { status: 'duplicate', candidates: casefoldActive, code: needle }
  }

  const casefoldInactive = products.filter(
    (p) => p.active === false && (p.barcode ?? '').trim().toLowerCase() === lowerNeedle,
  )
  if (casefoldInactive.length > 0) {
    if (casefoldActive.length > 0) {
      return { status: 'duplicate', candidates: [...casefoldActive, ...casefoldInactive], code: needle }
    }
    return { status: 'inactive', product: casefoldInactive[0], code: needle }
  }

  if (casefoldActive.length === 1) {
    // SAFETY INVARIANT: Case-mismatched fallback MUST NEVER be authorized as verified_exact.
    // Even when product.barcodeVerified === true, distinct casing in Code 128 requires confirmation.
    return { status: 'legacy_unverified', product: casefoldActive[0], code: needle }
  }

  // Step 3: Not found (Unknown)
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
 * Design decision for shared search (P0 Safety Remediation R2):
 * A barcode scanner in keyboard mode ("keyboard wedge") types characters and ends with Enter.
 * Because hardware wedge input cannot be reliably distinguished from human typing,
 * default search Enter MUST NOT automatically select SKU, name, or legacy unverified barcode.
 * Only verified exact barcodes may auto-authorize on Enter.
 * All barcode bad states (duplicate, inactive, legacy_unverified, not_found) reject terminal
 * on Enter without falling back to SKU.
 */
export function pickOnEnter(
  products: readonly Product[],
  query: string,
  _matches?: readonly Product[],
): Product | undefined {
  const q = query.trim()
  if (!q) return undefined

  // 1. Exact unique verified barcode only
  const barcodeRes = resolveBarcode(products, q)
  if (barcodeRes.status === 'verified_exact') {
    return barcodeRes.product
  }

  // Fail closed: duplicate, inactive, legacy unverified, and non-barcode queries
  // MUST NOT automatically select or fall back to SKU on default Enter.
  return undefined
}
