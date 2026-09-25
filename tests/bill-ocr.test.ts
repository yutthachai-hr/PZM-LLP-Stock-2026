// A supplier's bill read by AI (Automation Plan Phase 4, 25 Sep 2026): the model's answer is
// untrusted — cleaned here, matched only when sure, and nothing is filed without a person.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { cleanOcr, matchOcrLines } from '../src/lib/billOcr'
import { buildMatchIndex } from '../src/lib/productMatch'
import type { Product } from '../src/types'

const product = (id: string, name: string, over: Partial<Product> = {}): Product => ({
  id, sku: id.toUpperCase(), name, category: 'c', unit: 'KG', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over,
})
const products = [
  product('moz', 'MOZZARELLA WHOLE MILK (FOODGALLERY)', { unitType: 'EA', unit: 'EA', unitConversions: [{ label: 'Carton', size: 8 }] }),
  product('flour', 'FLOUR 00 (OLIVA)'),
]
const index = buildMatchIndex(products, [])

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

describe('matching the lines', () => {
  test('a sure match in the product unit, or converted from one of its units', () => {
    const r = matchOcrLines(
      { lines: [{ name: 'FLOUR 00 (OLIVA)', qty: 5, unit: 'kg' }, { name: 'MOZZARELLA WHOLE MILK (FOODGALLERY)', qty: 2, unit: 'Carton' }] },
      index,
    )
    expect(r.matched.map((m) => [m.product.id, m.qty, m.entryUnit ?? null, m.entryQty ?? null])).toEqual([
      ['flour', 5, null, null],
      ['moz', 16, 'Carton', 2],
    ])
  })

  test('an unknown unit is flagged; a name that is not a sure match is left for the person', () => {
    const r = matchOcrLines({ lines: [{ name: 'FLOUR 00 (OLIVA)', qty: 5, unit: 'sack' }, { name: 'Olive oil extra virgin', qty: 1 }] }, index)
    expect(r.matched[0]).toMatchObject({ qty: 5, unitUnknown: 'sack' })
    expect(r.unmatched.map((l) => l.name)).toEqual(['Olive oil extra virgin'])
  })
})
