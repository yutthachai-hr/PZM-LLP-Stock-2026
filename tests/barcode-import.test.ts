// Barcodes from a spreadsheet: what will be written, and what cannot be (spec §3).
import { describe, expect, test } from 'vitest'
import { findColumns, planBarcodeImport } from '../src/services/barcodeImport'
import type { Product } from '../src/types'

const p = (sku: string, over: Partial<Product> = {}): Product => ({
  id: sku, sku, name: sku, category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0,
  hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over,
})
const products = [p('CHS-01'), p('VGT-02', { barcode: '111' }), p('BAK-03', { barcode: '222' })]

test('the two columns are found under the names a Thai or English sheet uses', () => {
  expect(findColumns(['SKU', 'ชื่อสินค้า', 'Barcode'])).toEqual({ sku: 0, barcode: 2 })
  expect(findColumns(['รหัสสินค้า', ' บาร์โค้ด '])).toEqual({ sku: 0, barcode: 1 })
  expect(findColumns(['Name', 'Qty'])).toEqual({ sku: -1, barcode: -1 })
})

describe('planning', () => {
  test('writes the new ones, counts the ones already right, and keeps the old value', () => {
    const plan = planBarcodeImport(
      [
        { sku: 'CHS-01', barcode: '8851000654321' },
        { sku: 'VGT-02', barcode: '111' },
        { sku: 'BAK-03', barcode: '999' },
      ],
      products,
    )
    expect(plan.changes.map((c) => [c.product.sku, c.barcode, c.was])).toEqual([
      ['CHS-01', '8851000654321', undefined],
      ['BAK-03', '999', '222'],
    ])
    expect(plan.unchanged).toBe(1)
    expect(plan.problems).toEqual([])
  })

  test('an unknown SKU is reported, never created — the workbook is the catalogue', () => {
    const plan = planBarcodeImport([{ sku: 'NOPE-99', barcode: '123' }], products)
    expect(plan.changes).toEqual([])
    expect(plan.problems).toEqual([{ row: { sku: 'NOPE-99', barcode: '123' }, issue: 'unknownSku' }])
  })

  test('one barcode cannot land on two products — in the file or against the catalogue', () => {
    const plan = planBarcodeImport(
      [
        { sku: 'CHS-01', barcode: '555' },
        { sku: 'BAK-03', barcode: '555' },
        { sku: 'CHS-01', barcode: '111' },
      ],
      products,
    )
    expect(plan.changes.map((c) => c.product.sku)).toEqual(['CHS-01'])
    expect(plan.problems.map((x) => x.issue)).toEqual(['duplicateInFile', 'takenByOther'])
    expect(plan.problems[1].detail).toBe('VGT-02')
  })

  test('blank rows are skipped; a half-filled row is reported', () => {
    const plan = planBarcodeImport([{ sku: '', barcode: '' }, { sku: 'CHS-01', barcode: '  ' }], products)
    expect(plan.changes).toEqual([])
    expect(plan.problems.map((x) => x.issue)).toEqual(['blank'])
  })
})
