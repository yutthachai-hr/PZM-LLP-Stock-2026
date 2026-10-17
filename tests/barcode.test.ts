// Finding a product from what a scanner read (spec §3).
import { describe, expect, test } from 'vitest'
import { resolveBarcode, searchFields } from '../src/lib/barcode'
import { decideScan } from '../src/lib/barcodeSelection'
import type { Product } from '../src/types'

const p = (id: string, over: Partial<Product> = {}): Product => ({
  id, sku: id, name: id, category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0,
  hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over,
})

const products = [
  p('cheese', { name: 'MOZZARELLA', barcode: '8851000654321' }),
  p('flour', { name: 'PIZZA FLOUR', barcode: 'ABC-128' }),
  p('old', { name: 'RETIRED', barcode: '9999999999999', active: false }),
  p('plain', { name: 'NO BARCODE' }),
]

test('an exact match, with the newline a reader may add', () => {
  expect(resolveBarcode(products, '8851000654321')).toMatchObject({ status: 'legacy_unverified', product: { id: 'cheese' } })
  expect(resolveBarcode(products, ' 8851000654321\n')).toMatchObject({ status: 'legacy_unverified', product: { id: 'cheese' } })
  // Code 128 is case-significant: a lowercased token is a different code, never a match.
  expect(resolveBarcode(products, 'abc-128').status).toBe('not_found')
  expect(resolveBarcode(products, 'ABC-128')).toMatchObject({ status: 'legacy_unverified', product: { id: 'flour' } })
})

test('near misses, hidden products and empty scans find nothing', () => {
  expect(resolveBarcode(products, '885100065432').status).toBe('not_found')
  expect(resolveBarcode(products, '88510006543210').status).toBe('not_found')
  expect(resolveBarcode(products, '9999999999999')).toMatchObject({ status: 'inactive', product: { id: 'old' } })
  expect(resolveBarcode(products, '   ').status).toBe('empty')
  expect(resolveBarcode([], '8851000654321').status).toBe('not_found')
})

test('the barcode is one of the fields a product is searched by', () => {
  expect(searchFields(products[0])).toEqual(['MOZZARELLA', 'cheese', '8851000654321'])
  expect(searchFields(products[3])).toEqual(['NO BARCODE', 'plain', undefined])
})

describe('Enter in a search box (a scanner in keyboard mode ends with Enter)', () => {
  const box = (over: Partial<Product>): Product => ({ id: 'x', sku: 'X', name: 'X', category: 'c', unit: 'EA', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over })
  const scanned = box({ id: 'a', sku: 'BEV-01', name: 'COKE', barcode: '8851959132012', barcodeVerified: true })
  const lookalike = box({ id: 'b', sku: 'BEV-02', name: 'PACK 8851959132012 PROMO' })
  const products = [lookalike, scanned]

  test('an exact verified barcode is the only thing Enter adds, even against a better-ranked loose match', () => {
    expect(decideScan(products, '8851959132012\n')).toMatchObject({ kind: 'verified', product: { id: 'a' } })
  })

  test('default Enter never authorizes an SKU or a loose suggestion', () => {
    expect(decideScan(products, 'bev-02')).toMatchObject({ kind: 'reject', reason: 'not_found' })
    expect(decideScan(products, 'coke')).toMatchObject({ kind: 'reject', reason: 'not_found' })
    expect(decideScan(products, '   ')).toMatchObject({ kind: 'reject', reason: 'empty' })
  })
})
