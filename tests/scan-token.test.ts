// R18 S4: a wedge scanner is a US keyboard by default; on a Thai (Kedmanee) layout the digit
// row sends Thai glyphs instead of digits. The mapping is literal key-for-key, and only a token
// made entirely of digit-row keys is translated, so real codes and product names never change.
import { describe, expect, test } from 'vitest'
import { normalizeScanToken, resolveBarcode } from '../src/lib/barcode'
import type { Product } from '../src/types'

const p = (id: string, over: Partial<Product> = {}): Product => ({
  id, sku: id, name: id, category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0,
  hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over,
})

const products = [
  p('cheese', { name: 'MOZZARELLA', barcode: '8851111222222' }),
  p('zero', { name: 'ZERO LEADING', barcode: '0123456789012' }),
  p('flour', { name: 'PIZZA FLOUR', barcode: 'ABC-128' }),
  p('thai', { name: 'คุกกี้', barcode: '8851000777777' }),
]

describe('normalizeScanToken', () => {
  test('Thai digit-row glyphs become the digits on those keys', () => {
    // 8 8 5 1 1 1 1 2 2 2 2 2 2 typed on Kedmanee: ค ค ถ ๅ ๅ ๅ ๅ / / / / / /
    expect(normalizeScanToken('คคถๅๅๅๅ//////')).toBe('8851111222222')
    expect(resolveBarcode(products, normalizeScanToken('คคถๅๅๅๅ//////'))).toMatchObject({
      status: 'legacy_unverified',
      product: { id: 'cheese' },
    })
  })

  test('leading zeros survive the mapping', () => {
    // 0 1 2 3 4 5 6 7 8 9 0 1 2 -> จ ๅ / _ ภ ถ ุ ึ ค ต จ ๅ /
    expect(normalizeScanToken('จๅ/_ภถุึคตจๅ/')).toBe('0123456789012')
    expect(resolveBarcode(products, normalizeScanToken('จๅ/_ภถุึคตจๅ/'))).toMatchObject({
      status: 'legacy_unverified',
      product: { id: 'zero' },
    })
  })

  test('a US-typed code keeps its own punctuation', () => {
    // No Thai glyph, so nothing is translated — a real Code 128 with '-' is not a digit row.
    expect(normalizeScanToken('ABC-128')).toBe('ABC-128')
    expect(normalizeScanToken('885-123')).toBe('885-123')
    expect(normalizeScanToken('0123456789012')).toBe('0123456789012')
    expect(resolveBarcode(products, normalizeScanToken('ABC-128'))).toMatchObject({ status: 'legacy_unverified', product: { id: 'flour' } })
  })

  test('Thai product names and mixed tokens are left exactly as typed', () => {
    expect(normalizeScanToken('คุกกี้')).toBe('คุกกี้')
    expect(normalizeScanToken('หมู คคถ')).toBe('หมู คคถ')
    expect(normalizeScanToken('')).toBe('')
  })
})
