// Smart "Other" item (R&D, 8 Oct 2026): what the app offers when someone types an item
// instead of picking the category's "(OTHER)" product. Identity is the product id; the
// matcher never links an ambiguous or differently-specified item by itself.
//
//   npm test
import { describe, expect, test } from 'vitest'
import { decideOther, isOtherPlaceholder, itemKey, makeOtherSku, otherIndex, otherItemOn } from '../src/lib/otherItem'
import type { Product } from '../src/types'

const P = (id: string, name: string, over: Partial<Product> = {}): Product =>
  ({ id, sku: id.toUpperCase(), name, category: 'Vegetable', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over }) as Product

const catalogue = [
  P('vgt-other', 'VEGETABLE-(OTHER)', { unit: '', unitType: '' }),
  P('mes-other', 'MES-CHICKEN (OTHER)', { unit: '', unitType: '' }),
  P('saffron', 'KASHMIRI SAFFRON (LES FARMIERS)', { unit: 'Gram', unitType: 'G', barcode: '8850001' }),
  P('thyme', 'THYME (YCUBE SOLUTIONS)'),
  P('thyme-dried', 'THYME DRIED', { spec: '50 g jar' }),
  P('basil-a', 'BASIL', { supplierId: 's1' }),
  P('basil-b', 'BASIL', { supplierId: 's2' }),
  P('truffle', 'BLACK TRUFFLE', { review: 'pending', proposedBy: 'u1' } as Partial<Product>),
  P('gone', 'LEMONGRASS', { active: false }),
]
const idx = otherIndex(catalogue, [{ key: 'ใบโหระพา', productId: 'basil-a', sourceName: 'ใบโหระพา' } as never])

describe('the catch-all products', () => {
  test('"(OTHER)" placeholders are recognised and never matched', () => {
    expect(isOtherPlaceholder(catalogue[0])).toBe(true)
    expect(isOtherPlaceholder(catalogue[1])).toBe(true)
    expect(isOtherPlaceholder(catalogue[2])).toBe(false)
    expect(decideOther({ name: 'VEGETABLE-(OTHER)' }, idx).kind).not.toBe('use')
  })
})

describe('matching priority', () => {
  test('1. a verified code: SKU, barcode or id → use it', () => {
    expect(decideOther({ name: 'SAFFRON' }, idx)).toMatchObject({ kind: 'use', why: 'code', product: { id: 'saffron' } })
    expect(decideOther({ name: '8850001' }, idx)).toMatchObject({ kind: 'use', why: 'code', product: { id: 'saffron' } })
  })
  test('2. a confirmed spelling (alias) → that product', () => {
    expect(decideOther({ name: 'ใบโหระพา' }, idx)).toMatchObject({ kind: 'use', why: 'alias', product: { id: 'basil-a' } })
  })
  test('3. one product of that name, unit and spec compatible → use it (acceptance 2)', () => {
    expect(decideOther({ name: 'thyme dried', spec: '50G JAR', unit: 'KG' }, idx)).toMatchObject({ kind: 'use', product: { id: 'thyme-dried' } })
    expect(decideOther({ name: '  Thyme   (ycube solutions) ' }, idx)).toMatchObject({ kind: 'use', product: { id: 'thyme' } })
  })
  test('same name, different spec or unit → never linked by itself (acceptance 4)', () => {
    const d = decideOther({ name: 'THYME DRIED', spec: '1 kg bag' }, idx)
    expect(d).toMatchObject({ kind: 'choose', candidates: [{ product: { id: 'thyme-dried' }, why: 'same-name-other-spec' }] })
    expect(decideOther({ name: 'THYME DRIED', unit: 'Bottle' }, idx).kind).toBe('choose')
  })
  test('several products of that name → the person picks (acceptance 5)', () => {
    const d = decideOther({ name: 'basil' }, idx)
    expect(d.kind).toBe('choose')
    expect(d.kind === 'choose' && d.candidates.map((c) => c.product.id).sort()).toEqual(['basil-a', 'basil-b'])
  })
  test('a product still pending review is offered, not taken', () => {
    expect(decideOther({ name: 'Black Truffle' }, idx)).toMatchObject({ kind: 'choose', candidates: [{ why: 'pending' }] })
  })
  test('nothing close → create, with the near ones shown (acceptance 1)', () => {
    const d = decideOther({ name: 'Sumac powder' }, idx)
    expect(d.kind).toBe('create')
    const near = decideOther({ name: 'THYME FRESH' }, idx)
    expect(near.kind === 'create' && near.candidates.map((c) => c.product.id)).toContain('thyme-dried')
  })
  test('hidden products are never matched; too little text decides nothing', () => {
    expect(decideOther({ name: 'LEMONGRASS' }, idx).kind).toBe('create')
    expect(decideOther({ name: ' x ' }, idx).kind).toBe('empty')
  })
  test('a different supplier does not change identity: the same product either way (acceptance 3)', () => {
    // Supplier is not part of the key or the match; the line carries its own supplier.
    expect(itemKey({ name: 'Sumac Powder', spec: '1KG', unit: 'kg' })).toBe(itemKey({ name: 'sumac  powder', spec: '1 kg', unit: 'KG' }))
    expect(itemKey({ name: 'Sumac Powder', spec: '1KG' })).not.toBe(itemKey({ name: 'Sumac Powder', spec: '500G' }))
  })
})

describe('codes and scope', () => {
  test('RND-000001 …', () => {
    expect(makeOtherSku(1)).toBe('RND-000001')
    expect(makeOtherSku(123456)).toBe('RND-123456')
  })
  test('R&D only; a build can switch it off', () => {
    expect(otherItemOn('rnd', {})).toBe(true)
    expect(otherItemOn('pizza', {})).toBe(false)
    expect(otherItemOn('lelapin', {})).toBe(false)
    expect(otherItemOn('rnd', { VITE_OTHER_ITEM: 'off' })).toBe(false)
  })
})
