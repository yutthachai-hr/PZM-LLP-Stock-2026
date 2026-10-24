import type { Product } from '../types'

/**
 * Barcode resolution outcome (Workstream A P0 safety contract).
 *
 * Legacy unverified: single active candidate found; all exact matches currently resolve as legacy unverified and require human confirmation.
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

/**
 * What a Thai keyboard layout turns the digit row into (Kedmanee, unshifted), measured on the
 * installed Windows layout HKL 0x41e041e with GetKeyboardLayoutList + MapVirtualKeyExW +
 * ToUnicodeEx: 0=จ 1=ๅ 2=/ 3=- 4=ภ 5=ถ 6=ุ 7=ึ 8=ค 9=ต. A keyboard-wedge scanner reports key
 * positions as if it were a US keyboard, so on a Thai layout the digits arrive as these glyphs
 * and every scan misses.
 *
 * Only the digit row is mapped, key for key — there is no attempt to guess words out of Thai
 * text. A token is translated only when it contains at least one of the measured Thai glyphs
 * AND every character is one of these keys; so an ASCII code keeps its own `-`, `/` and digits,
 * and `_` (not a key on the measured layout) is never translated. Anything else stays literal.
 */
const THAI_DIGIT_ROW: Record<string, string> = {
  'จ': '0', 'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9',
}
const THAI_DIGIT_ROW_GLYPH = /[จๅภถุึคต]/
const THAI_DIGIT_ROW_ONLY = /^[0-9จๅ/ภถุึคต-]+$/

/** The exact text a scanner meant, whatever keyboard layout it typed through. */
export function normalizeScanToken(raw: string): string {
  const s = raw.trim()
  if (!THAI_DIGIT_ROW_GLYPH.test(s) || !THAI_DIGIT_ROW_ONLY.test(s)) return s
  return s.replace(/[จๅ/ภถุึคต-]/g, (c) => THAI_DIGIT_ROW[c] ?? c)
}

/** The fields a product is searched by, including its barcode when it has one. */
export function searchFields(p: Product): (string | undefined)[] {
  return [p.name, p.sku, p.barcode]
}
