// A phone keys one product at a time through a sheet; this is what the sheet hands back.
import { describe, expect, test } from 'vitest'
import { lineOf, upsertLine } from '../src/lib/lines'

const mozz = { id: 'p1', name: 'Mozzarella', unitType: 'EA' }
const ham = { id: 'p2', name: 'Ham', unitType: 'KG' }

describe('upsertLine', () => {
  test('a new product is appended, keyed in its own unit or another', () => {
    const a = upsertLine([], mozz, { qty: 3, entryQty: 3, factor: 1 })
    expect(a).toEqual([{ productId: 'p1', productName: 'Mozzarella', unit: 'EA', qty: 3 }])
    const b = upsertLine(a, ham, { qty: 16, entryQty: 2, entryUnit: 'Carton', factor: 8 })
    expect(b[1]).toEqual({ productId: 'p2', productName: 'Ham', unit: 'KG', qty: 16, entryUnit: 'Carton', entryQty: 2 })
  })

  test('the same product again replaces its line in place, and a zero removes it', () => {
    const a = upsertLine([lineOf(mozz, { qty: 3, entryQty: 3, factor: 1 }), lineOf(ham, { qty: 1, entryQty: 1, factor: 1 })], mozz, { qty: 5, entryQty: 5, factor: 1 })
    expect(a.map((l) => [l.productId, l.qty])).toEqual([['p1', 5], ['p2', 1]])
    const b = upsertLine(a, mozz, { qty: 0, entryQty: 0, factor: 1 })
    expect(b.map((l) => l.productId)).toEqual(['p2'])
  })

  test("switching back to the product's own unit drops the keyed-unit fields", () => {
    const a = upsertLine([], mozz, { qty: 16, entryQty: 2, entryUnit: 'Carton', factor: 8 })
    const b = upsertLine(a, mozz, { qty: 4, entryQty: 4, factor: 1 })
    expect(b[0]).toEqual({ productId: 'p1', productName: 'Mozzarella', unit: 'EA', qty: 4 })
  })
})
