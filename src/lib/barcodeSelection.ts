import type { Product } from '../types'
import { resolveBarcode } from './barcode'

/**
 * The one place a scanned/typed token is turned into an action, shared by every screen that
 * reads a barcode (R4: LineBuilder, Adjust, TransferReceivePage). The three screens used to
 * re-implement the same switch against a stale render-scope array; keeping it here means the
 * fail-closed rules are stated once and the tests drive the code the UI runs.
 *
 * Origin is deliberately NOT a parameter: a keyboard-wedge scanner and a human typing into
 * the same box are indistinguishable, so every scan/Enter goes through the exact resolver.
 * A human choosing a product does it by clicking it — never by pressing Enter on loose text.
 */
export type ScanRejectReason = 'duplicate' | 'inactive' | 'not_found' | 'empty'

export type ScanDecision =
  | { kind: 'verified'; product: Product; code: string }
  | { kind: 'legacy'; product: Product; code: string }
  | {
      kind: 'reject'
      reason: ScanRejectReason
      code: string
      /** How many products carry the code, for the duplicate message. */
      duplicateCount?: number
      /** The retired product's name, for the inactive message. */
      inactiveName?: string
    }

/** What a scan means right now, against the catalog as it is. */
export function decideScan(products: readonly Product[], code: string): ScanDecision {
  const res = resolveBarcode(products, code)
  switch (res.status) {
    case 'verified_exact':
      return { kind: 'verified', product: res.product, code: res.code }
    case 'legacy_unverified':
      return { kind: 'legacy', product: res.product, code: res.code }
    case 'duplicate':
      return { kind: 'reject', reason: 'duplicate', code: res.code, duplicateCount: res.candidates.length }
    case 'inactive':
      return { kind: 'reject', reason: 'inactive', code: res.code, inactiveName: res.product.name }
    case 'not_found':
      return { kind: 'reject', reason: 'not_found', code: res.code }
    default:
      return { kind: 'reject', reason: 'empty', code: '' }
  }
}

/**
 * Re-run the exact resolution when the person answers the confirmation, against the catalog
 * as it is THEN — not the array captured when the dialog opened.
 *
 * The old `products.find(p => p.id === prodId && p.active !== false)` could not tell that the
 * product had been deactivated, that its barcode had been rebound to another code, or that a
 * second product had since claimed the same code: the stale array still showed the first
 * product, active, with the old barcode (R3 C2). Requiring a fresh `verified_exact` /
 * `legacy_unverified` for the SAME product id and the SAME code, against the live catalog,
 * refuses every one of those.
 *
 * A non-null result is the fresh product to add; the caller must re-derive its unit from this
 * object (and the balance/scope it is being added to stays the caller's own check).
 */
export function revalidateScan(products: readonly Product[], code: string, expectedProductId: string): Product | null {
  const res = resolveBarcode(products, code)
  if (res.status !== 'verified_exact' && res.status !== 'legacy_unverified') return null
  return res.product.id === expectedProductId ? res.product : null
}
