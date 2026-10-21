// R23/R29: Tab is both a keyboard user's navigation key and a wedge scanner's terminator.
import { describe, expect, test } from 'vitest'
import { shouldScanOnTab } from '../src/lib/barcodeSelection'
import type { Product } from '../src/types'

const p = (id: string, over: Partial<Product> = {}): Product => ({
  id, sku: id.toUpperCase(), name: id.toUpperCase(), category: 'cat', unit: 'Kilogram',
  unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over,
})
const CODE = '8851111222222'
const products = [p('cheese', { name: 'MOZZARELLA CHEESE', sku: 'DAI-01-001', barcode: CODE }), p('flour', { name: 'PIZZA FLOUR', sku: 'DRY-01-001' })]

describe('shouldScanOnTab', () => {
  test('a known code ending in Tab is a scan, even with suggestions open', () => {
    expect(shouldScanOnTab(products, CODE, true)).toBe(true)
  })
  test('the same digits typed on a Thai layout still count as that code (tests/scan-token.test.ts)', () => {
    expect(shouldScanOnTab(products, 'คคถๅๅๅๅ//////', true)).toBe(true)
  })
  test('a partial name or SKU with suggestions is navigation, not a scan', () => {
    expect(shouldScanOnTab(products, 'PIZZA', true)).toBe(false)
    expect(shouldScanOnTab(products, 'DRY-01', true)).toBe(false)
  })
  test('with no suggestion list Tab keeps its scan meaning (the gate refuses unknowns)', () => {
    expect(shouldScanOnTab(products, 'PIZZA', false)).toBe(true)
  })
  test('inactive and duplicate claims still go to the fail-closed gate', () => {
    expect(shouldScanOnTab([...products, p('old', { barcode: '8858888000000', active: false })], '8858888000000', true)).toBe(true)
    expect(shouldScanOnTab([...products, p('twin', { barcode: CODE })], CODE, true)).toBe(true)
  })
})
