// A supplier's bill read by AI (Automation Plan Phase 4, 25 Sep 2026): the model's answer is
// untrusted — cleaned here, never taken as the product, and nothing is filed without a person.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { cleanOcr, convertReadLine, ocrCandidates } from '../src/lib/billOcr'
import type { Product } from '../src/types'

const product = (id: string, name: string, over: Partial<Product> = {}): Product => ({
  id, sku: id.toUpperCase(), name, category: 'c', unit: 'KG', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over,
})
const products = [
  product('moz', 'MOZZARELLA WHOLE MILK (FOODGALLERY)', { unitType: 'EA', unit: 'EA', unitConversions: [{ label: 'Carton', size: 8 }] }),
  product('flour', 'FLOUR 00 (OLIVA)'),
]

describe('cleaning what the model said', () => {
  test('keeps well-formed fields, drops the rest, never throws', () => {
    const bill = cleanOcr({
      supplier: ' FOODGALLERY ', invoiceNo: 12345, date: '2026-09-25',
      lines: [{ name: 'FLOUR 00 (OLIVA)', qty: '1,000', unit: 'KG' }, { name: '', qty: 3 }, { name: 'x', qty: -1 }, 'junk'],
    })
    expect(bill).toEqual({ supplier: 'FOODGALLERY', invoiceNo: '12345', date: '2026-09-25', lines: [{ name: 'FLOUR 00 (OLIVA)', qty: 1000, unit: 'KG' }] })
    expect(cleanOcr('nonsense')).toEqual({ supplier: undefined, invoiceNo: undefined, date: undefined, lines: [] })
    expect(cleanOcr({ date: '25/09/2026' }).date).toBeUndefined()
  })
})

describe('the lines read (owner, 15 Oct 2026: a reading is never the product)', () => {
  test('even a name exactly like a product is left for the person', () => {
    const lines = [{ name: 'FLOUR 00 (OLIVA)', qty: 5, unit: 'kg' }, { name: 'Olive oil extra virgin', qty: 1 }]
    expect(ocrCandidates({ lines })).toEqual({ matched: [], unmatched: lines })
  })

  test('once a product is chosen, the read quantity is in its unit or converted from one of its units', () => {
    const [moz, flour] = products
    expect(convertReadLine({ name: 'x', qty: 5, unit: 'kg' }, flour)).toMatchObject({ qty: 5 })
    expect(convertReadLine({ name: 'x', qty: 2, unit: 'Carton' }, moz)).toMatchObject({ qty: 16, entryUnit: 'Carton', entryQty: 2 })
  })

  test('a unit the chosen product does not know is flagged, not taken as its own unit', () => {
    expect(convertReadLine({ name: 'x', qty: 5, unit: 'sack' }, products[1])).toMatchObject({ qty: 5, unitUnknown: 'sack' })
  })
})

describe('answers as models actually shape them (6 Oct 2026)', () => {
  test('the LINE order screenshot: "2 kg" strings, items/quantity keys — every row kept', () => {
    const bill = cleanOcr({
      model: 'gemini-3.5-flash',
      items: [
        { product: 'Feta cheese', quantity: '2 kg' },
        { product: 'Plain yoghurt', quantity: '3kg' },
        { name: 'Garlic dill white cheese', qty: '2 Kg.' },
      ],
    })
    expect(bill.model).toBe('gemini-3.5-flash')
    expect(bill.lines).toEqual([
      { name: 'Feta cheese', qty: 2, unit: 'kg' },
      { name: 'Plain yoghurt', qty: 3, unit: 'kg' },
      { name: 'Garlic dill white cheese', qty: 2, unit: 'Kg' },
    ])
  })
  test('a separate unit field wins over one inside the quantity; thousands and decimals', () => {
    expect(cleanOcr({ lines: [{ name: 'Flour', qty: '1,250.5 g', unit: 'KG' }] }).lines).toEqual([{ name: 'Flour', qty: 1250.5, unit: 'KG' }])
  })
  test('a bare array of rows is read too; rows with no number are dropped', () => {
    expect(cleanOcr([{ name: 'Ham', qty: 'two' }, { name: 'Bacon', qty: 4 }]).lines).toEqual([{ name: 'Bacon', qty: 4, unit: undefined }])
  })
})
