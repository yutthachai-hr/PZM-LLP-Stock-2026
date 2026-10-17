// Tests for P0 Barcode Safety (Workstream A / R4 remediation)
import { describe, expect, test } from 'vitest'
import { resolveBarcode } from '../src/lib/barcode'
import { decideScan, revalidateScan } from '../src/lib/barcodeSelection'
import { brandEpoch, setActiveBrand } from '../src/brand/brand'
import type { Product } from '../src/types'

const p = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id.toUpperCase(),
  name: id.toUpperCase(),
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

describe('Barcode Safety - Normalization & Token Preservation', () => {
  test('preserves leading zeros and treats barcode as exact token, not a number', () => {
    const p1 = p('item1', { barcode: '0012345678901' })
    const products = [p1]

    const res = resolveBarcode(products, '0012345678901')
    expect(res.status).toBe('legacy_unverified')
    if (res.status === 'legacy_unverified') {
      expect(res.product.id).toBe('item1')
      expect(res.code).toBe('0012345678901')
    }

    // Stripping leading zero must not match
    expect(resolveBarcode(products, '12345678901').status).toBe('not_found')
  })

  test('trims whitespace and newlines from scanner wedge without mutating token characters', () => {
    const p1 = p('item1', { barcode: '8851000654321' })
    const products = [p1]

    const res = resolveBarcode(products, '  8851000654321\r\n')
    expect(res.status).toBe('legacy_unverified')
    if (res.status === 'legacy_unverified') {
      expect(res.product.id).toBe('item1')
      expect(res.code).toBe('8851000654321')
    }
  })

  test('distinct Code128 casings resolve exactly and are never merged', () => {
    const codeUpper = p('upper', { barcode: 'ABC-128' })
    const codeLower = p('lower', { barcode: 'abc-128' })
    const products = [codeUpper, codeLower]

    // Exact matches must resolve to their respective distinct products
    expect(resolveBarcode(products, 'ABC-128')).toMatchObject({ status: 'legacy_unverified', product: { id: 'upper' } })
    expect(resolveBarcode(products, 'abc-128')).toMatchObject({ status: 'legacy_unverified', product: { id: 'lower' } })

    // A token that only folds onto both is an unknown code — NOT_FOUND, never the first casefold
    // match and never a duplicate (R3 C1: no casefold fallback at all).
    expect(resolveBarcode(products, 'Abc-128').status).toBe('not_found')
  })
})

describe('Barcode Safety - Duplicate Detection & Fail-Closed', () => {
  test('duplicate active barcodes fail closed and require human confirmation', () => {
    const p1 = p('dup1', { barcode: '8851000999999', name: 'Product 1' })
    const p2 = p('dup2', { barcode: '8851000999999', name: 'Product 2' })
    const products = [p1, p2]

    // No product is picked, and the resolution is terminal duplicate.
    expect(decideScan(products, '8851000999999')).toMatchObject({ kind: 'reject', reason: 'duplicate', duplicateCount: 2 })

    const res = resolveBarcode(products, '8851000999999')
    expect(res.status).toBe('duplicate')
    if (res.status === 'duplicate') {
      expect(res.candidates.map((c) => c.id).sort()).toEqual(['dup1', 'dup2'])
      expect(res.code).toBe('8851000999999')
    }
  })
})

describe('Barcode Safety - Inactive & Unknown Products', () => {
  test('inactive product barcode is rejected', () => {
    const retired = p('old', { barcode: '8851000888888', active: false })
    const products = [retired]

    expect(decideScan(products, '8851000888888')).toMatchObject({ kind: 'reject', reason: 'inactive' })
    const res = resolveBarcode(products, '8851000888888')
    expect(res.status).toBe('inactive')
    if (res.status === 'inactive') {
      expect(res.product.id).toBe('old')
    }
  })

  test('unknown barcode returns not_found without falling back to fuzzy or SKU', () => {
    const p1 = p('coke', { sku: '8851000777777', name: 'COKE 8851000777777' })
    const products = [p1]

    // 8851000777777 is SKU and in name, but NOT in barcode
    const res = resolveBarcode(products, '8851000777777')
    expect(res.status).toBe('not_found')
    expect(decideScan(products, '8851000777777')).toMatchObject({ kind: 'reject', reason: 'not_found' })
  })

  test('empty or whitespace-only barcode returns empty', () => {
    expect(resolveBarcode([], '   ').status).toBe('empty')
    expect(resolveBarcode([], '').status).toBe('empty')
    expect(decideScan([], '   ')).toMatchObject({ kind: 'reject', reason: 'empty' })
  })
})

describe('Barcode Safety - Legacy Barcode Human Confirmation', () => {
  test('all unique active barcodes require legacy confirmation even with untrusted barcodeVerified true', () => {
    const verified = p('v1', { barcode: '8851000123456', barcodeVerified: true } as any)
    const res = resolveBarcode([verified], '8851000123456')
    expect(res.status).toBe('legacy_unverified')
    if (res.status === 'legacy_unverified') {
      expect(res.product.id).toBe('v1')
    }
  })

  test('legacy barcode without verification proof returns legacy_unverified requiring confirmation', () => {
    const legacy = p('leg1', { barcode: '8851000123456' })
    const res = resolveBarcode([legacy], '8851000123456')
    expect(res.status).toBe('legacy_unverified')
    if (res.status === 'legacy_unverified') {
      expect(res.product.id).toBe('leg1')
    }
  })
})

describe('Barcode Safety - Confirm-time revalidation against the live catalog', () => {
  const code = '8851000777777'

  test('accepts the expected product when the catalog is unchanged, refuses otherwise', () => {
    expect(revalidateScan([p('P1', { barcode: code })], code, 'P1')?.id).toBe('P1')
    // deactivated while the dialog was open
    expect(revalidateScan([p('P1', { barcode: code, active: false })], code, 'P1')).toBeNull()
    // rebound to another code inside the same brand
    expect(revalidateScan([p('P1', { barcode: 'DIFFERENT-CODE' })], code, 'P1')).toBeNull()
    // a duplicate registration appeared after the prompt opened
    expect(revalidateScan([p('P1', { barcode: code }), p('P2', { barcode: code })], code, 'P1')).toBeNull()
    // the code now names a different product id
    expect(revalidateScan([p('P9', { barcode: code })], code, 'P1')).toBeNull()
  })
})

describe('Barcode Safety - Search Input Intent & the shared scan gate', () => {
  const p1 = p('item1', { sku: 'BEV-01', name: 'COKE CAN', barcode: '8851959132012' })
  const p2 = p('item2', { sku: 'BEV-02', name: 'COKE BOTTLE' })
  const products = [p1, p2]

  test('a scan/Enter resolves exact barcode to legacy confirmation; SKU is terminal reject', () => {
    expect(decideScan(products, '8851959132012')).toMatchObject({ kind: 'legacy', product: { id: 'item1' } })
    expect(decideScan(products, '  8851959132012\n')).toMatchObject({ kind: 'legacy', product: { id: 'item1' } })

    // legacy barcode: a candidate, but with confirmation attached — never an auto-add
    const legacyProd = p('leg1', { barcode: '8851000123456' })
    expect(decideScan([legacyProd], '8851000123456')).toMatchObject({ kind: 'legacy', product: { id: 'leg1' } })

    // sharedinputunknownmatchingSKU: a wedge or typed SKU must NOT resolve to a product
    expect(decideScan(products, 'bev-02').kind).toBe('reject')
    expect(decideScan(products, 'BEV-01').kind).toBe('reject')
  })

  test('3parentcases: casefold verified, duplicate barcode with third SKU, inactive barcode with third SKU', () => {
    // Parent case 1: AbC128 queried with abc128 is NOT_FOUND (exact-only, no casefold candidate)
    expect(resolveBarcode([p('case', { barcode: 'AbC128' })], 'abc128').status).toBe('not_found')

    // Parent case 2: Duplicate barcode DUP with third product having SKU DUP -> terminal reject
    const dup = [p('one', { barcode: 'DUP' }), p('two', { barcode: 'DUP' }), p('third', { sku: 'DUP', barcode: 'OTHER' })]
    expect(decideScan(dup, 'DUP')).toMatchObject({ kind: 'reject', reason: 'duplicate' })

    // Parent case 3: Inactive barcode OLD with third product having SKU OLD -> terminal reject
    const inactive = [p('retired', { barcode: 'OLD', active: false }), p('third', { sku: 'OLD', barcode: 'OTHER' })]
    expect(decideScan(inactive, 'OLD')).toMatchObject({ kind: 'reject', reason: 'inactive' })
  })

  test('duplicateoutsideTransferdoc: resolves full brand catalog first so duplicate outside doc fails closed', () => {
    // Transfer doc only contains inDoc, but brand catalog contains outsideDoc with identical barcode
    const inDoc = p('item-in-transfer', { barcode: 'SHARED-BC-123' })
    const outsideDoc = p('item-outside-transfer', { barcode: 'SHARED-BC-123' })
    const fullBrandCatalog = [inDoc, outsideDoc]

    // Checking only transfer doc lines would falsely show 1 match
    expect(resolveBarcode([inDoc], 'SHARED-BC-123').status).not.toBe('duplicate')

    // Resolving FULL brand catalog correctly fails closed as duplicate
    const fullRes = resolveBarcode(fullBrandCatalog, 'SHARED-BC-123')
    expect(fullRes.status).toBe('duplicate')
  })

  test('a loose search or name query never resolves to a product (no matches[0] fallback)', () => {
    expect(decideScan(products, 'coke').kind).toBe('reject')
    expect(decideScan(products, 'can').kind).toBe('reject')
  })

  test('fails closed if multiple products share SKU or barcode', () => {
    const dupSku1 = p('d1', { sku: 'SAME-SKU' })
    const dupSku2 = p('d2', { sku: 'SAME-SKU' })
    expect(decideScan([dupSku1, dupSku2], 'SAME-SKU').kind).toBe('reject')
  })
})

describe('Barcode Safety - Lifecycle, Epoch Fences & Latching', () => {
  test('camera/manuallatchbrandchange+pendingconfirmation: brand epoch fence and pending confirmation invalidation', () => {
    const startEpoch = brandEpoch()
    setActiveBrand('lelapin')
    const lelapinEpoch = brandEpoch()
    expect(lelapinEpoch).toBeGreaterThan(startEpoch)

    // A confirmation or scan latch started under startEpoch is invalidated when epoch advances
    const isConfirmationValid = (epochAtPrompt: number) => brandEpoch() === epochAtPrompt
    expect(isConfirmationValid(startEpoch)).toBe(false)
    expect(isConfirmationValid(lelapinEpoch)).toBe(true)

    // Switching back advances epoch again (never resets or rewinds)
    setActiveBrand('pizza')
    expect(brandEpoch()).toBeGreaterThan(lelapinEpoch)
    expect(isConfirmationValid(lelapinEpoch)).toBe(false)
  })
})
