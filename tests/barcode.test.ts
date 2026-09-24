// Finding a product from what a scanner read (spec §3).
import { describe, expect, test } from 'vitest'
import { findByBarcode, pickOnEnter, searchFields } from '../src/lib/barcode'
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

test('an exact match, with the newline and the case a reader may add', () => {
  expect(findByBarcode(products, '8851000654321')?.id).toBe('cheese')
  expect(findByBarcode(products, ' 8851000654321\n')?.id).toBe('cheese')
  expect(findByBarcode(products, 'abc-128')?.id).toBe('flour')
})

test('near misses, hidden products and empty scans find nothing', () => {
  expect(findByBarcode(products, '885100065432')).toBeUndefined()
  expect(findByBarcode(products, '88510006543210')).toBeUndefined()
  expect(findByBarcode(products, '9999999999999')).toBeUndefined()
  expect(findByBarcode(products, '   ')).toBeUndefined()
  expect(findByBarcode([], '8851000654321')).toBeUndefined()
})

test('the barcode is one of the fields a product is searched by', () => {
  expect(searchFields(products[0])).toEqual(['MOZZARELLA', 'cheese', '8851000654321'])
  expect(searchFields(products[3])).toEqual(['NO BARCODE', 'plain', undefined])
})

describe('Enter in a search box (a scanner in keyboard mode ends with Enter)', () => {
  const box = (over: Partial<Product>): Product => ({ id: 'x', sku: 'X', name: 'X', category: 'c', unit: 'EA', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over })
  const scanned = box({ id: 'a', sku: 'BEV-01', name: 'COKE', barcode: '8851959132012' })
  const lookalike = box({ id: 'b', sku: 'BEV-02', name: 'PACK 8851959132012 PROMO' })
  const products = [lookalike, scanned]

  test('an exact barcode wins over a loose match that ranks first', () => {
    expect(pickOnEnter(products, '8851959132012\n', [lookalike, scanned])?.id).toBe('a')
  })

  test('then the product code exactly, then the best loose match', () => {
    expect(pickOnEnter(products, 'bev-02', [scanned, lookalike])?.id).toBe('b')
    expect(pickOnEnter(products, 'coke', [scanned])?.id).toBe('a')
    expect(pickOnEnter(products, '   ', [scanned])).toBeUndefined()
  })
})
