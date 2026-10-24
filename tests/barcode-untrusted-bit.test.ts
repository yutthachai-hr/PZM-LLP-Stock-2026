import { describe, expect, test } from 'vitest'
import { resolveBarcode } from '../src/lib/barcode'
import { decideScan } from '../src/lib/barcodeSelection'
import type { Product } from '../src/types'

const prod = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id.toUpperCase(),
  name: `Product ${id}`,
  category: 'cat',
  unit: 'Kilogram',
  unitType: 'KG',
  minStock: 0,
  hasImage: false,
  active: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('Barcode safety - untrusted verification bit is ignored, human confirmation required', () => {
  test('forged barcodeVerified: true does not bypass confirmation in resolveBarcode', () => {
    // Untrusted/forged extra bit
    const forged = prod('p1', { barcode: '8851000123456', barcodeVerified: true } as any)
    const res = resolveBarcode([forged], '8851000123456')
    // Must be legacy_unverified requiring confirmation, NOT verified_exact
    expect(res.status).toBe('legacy_unverified')
  })

  test('forged barcodeVerified: true does not auto-select in decideScan', () => {
    const forged = prod('p1', { barcode: '8851000123456', barcodeVerified: true } as any)
    const decision = decideScan([forged], '8851000123456')
    // Must be kind: 'legacy', never kind: 'verified'
    expect(decision.kind).toBe('legacy')
  })
})
