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
 * 2. Only the EXACT token may ever produce a candidate. There is no case fold and no fuzzy
 *    match: Code 128 is case-significant, so a case-mismatched token is not_found (R3 C1).
 * 3. Duplicates fail closed (no implicit first match).
 * 4. Inactive products are rejected.
 * 5. Unknown barcodes return not_found without any fallback to name, SKU or loose match.
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
    return { status: 'legacy_unverified', product, code: needle }
  }

  // Unknown token. There is deliberately NO case-insensitive fallback: Code 128 keeps its
  // case, so `abc128` is a different code from `AbC128`, and treating the fold as "probably
  // this product" is exactly the fuzzy guess the Owner forbade (R3 C1). A wrong-case token
  // is an unknown code and gets the same answer as any other unknown: NOT_FOUND.
  return { status: 'not_found', code: needle }
}

/** The fields a product is searched by, including its barcode when it has one. */
export function searchFields(p: Product): (string | undefined)[] {
  return [p.name, p.sku, p.barcode]
}
