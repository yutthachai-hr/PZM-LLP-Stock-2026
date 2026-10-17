// Tests for P0 Barcode Safety (Workstream A)
import { describe, expect, test } from 'vitest'
import { findByBarcode, pickOnEnter, resolveBarcode } from '../src/lib/barcode'
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
    const p1 = p('item1', { barcode: '8851000654321', barcodeVerified: true })
    const products = [p1]

    const res = resolveBarcode(products, '  8851000654321\r\n')
    expect(res.status).toBe('verified_exact')
    if (res.status === 'verified_exact') {
      expect(res.product.id).toBe('item1')
      expect(res.code).toBe('8851000654321')
    }
  })

  test('does not silently merge distinct Code128 values or pick first casefold duplicate', () => {
    const codeUpper = p('upper', { barcode: 'ABC-128', barcodeVerified: true })
    const codeLower = p('lower', { barcode: 'abc-128', barcodeVerified: true })
    const products = [codeUpper, codeLower]

    // Exact matches must resolve to their respective distinct products
    const resUpper = resolveBarcode(products, 'ABC-128')
    expect(resUpper.status).toBe('verified_exact')
    if (resUpper.status === 'verified_exact') {
      expect(resUpper.product.id).toBe('upper')
    }

    const resLower = resolveBarcode(products, 'abc-128')
    expect(resLower.status).toBe('verified_exact')
    if (resLower.status === 'verified_exact') {
      expect(resLower.product.id).toBe('lower')
    }

    // findByBarcode must resolve exact case when distinct Code128 exist
    expect(findByBarcode(products, 'ABC-128')?.id).toBe('upper')
    expect(findByBarcode(products, 'abc-128')?.id).toBe('lower')

    // An ambiguous casefold query that clashes between both must not pick the first one
    const resAmbiguous = resolveBarcode(products, 'Abc-128')
    expect(resAmbiguous.status).toBe('duplicate')
    expect(findByBarcode(products, 'Abc-128')).toBeUndefined()
  })
})

describe('Barcode Safety - Duplicate Detection & Fail-Closed', () => {
  test('duplicate active barcodes fail closed and require human confirmation', () => {
    const p1 = p('dup1', { barcode: '8851000999999', name: 'Product 1' })
    const p2 = p('dup2', { barcode: '8851000999999', name: 'Product 2' })
    const products = [p1, p2]

    // findByBarcode must NOT arbitrarily return the first product
    expect(findByBarcode(products, '8851000999999')).toBeUndefined()

    // resolveBarcode must return duplicate status with all candidates
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

    expect(findByBarcode(products, '8851000888888')).toBeUndefined()
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
    expect(findByBarcode(products, '8851000777777')).toBeUndefined()
  })

  test('empty or whitespace-only barcode returns empty', () => {
    expect(resolveBarcode([], '   ').status).toBe('empty')
    expect(resolveBarcode([], '').status).toBe('empty')
    expect(findByBarcode([], '   ')).toBeUndefined()
  })
})

describe('Barcode Safety - Legacy vs Verified Barcode Provenance', () => {
  test('explicitly verified barcode returns verified_exact', () => {
    const verified = p('v1', { barcode: '8851000123456', barcodeVerified: true })
    const res = resolveBarcode([verified], '8851000123456')
    expect(res.status).toBe('verified_exact')
    if (res.status === 'verified_exact') {
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

describe('Barcode Safety - Search Input Intent & pickOnEnter', () => {
  const p1 = p('item1', { sku: 'BEV-01', name: 'COKE CAN', barcode: '8851959132012', barcodeVerified: true })
  const p2 = p('item2', { sku: 'BEV-02', name: 'COKE BOTTLE' })
  const products = [p1, p2]

  test('pickOnEnter resolves exact barcode', () => {
    expect(pickOnEnter(products, '8851959132012', [p1, p2])?.id).toBe('item1')
    expect(pickOnEnter(products, '  8851959132012\n', [p1, p2])?.id).toBe('item1')
  })

  test('pickOnEnter resolves exact unique SKU', () => {
    expect(pickOnEnter(products, 'bev-02', [p2])?.id).toBe('item2')
    expect(pickOnEnter(products, 'BEV-01', [p1])?.id).toBe('item1')
  })

  test('pickOnEnter MUST NOT fall back to matches[0] on loose search or name query', () => {
    // Typing 'coke' matches both in search, but neither has barcode 'coke' or sku 'coke'
    // It must return undefined to prevent unauthorized movement from search suggestions
    expect(pickOnEnter(products, 'coke', [p1, p2])).toBeUndefined()
    expect(pickOnEnter(products, 'can', [p1])).toBeUndefined()
  })

  test('pickOnEnter fails closed if multiple products share SKU or barcode', () => {
    const dupSku1 = p('d1', { sku: 'SAME-SKU' })
    const dupSku2 = p('d2', { sku: 'SAME-SKU' })
    expect(pickOnEnter([dupSku1, dupSku2], 'SAME-SKU', [dupSku1, dupSku2])).toBeUndefined()
  })
})
