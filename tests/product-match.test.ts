// Reading the order workbook's spellings against the catalogue.
//
//   npm test
//
// Every name below is copied from the real workbook (ตัวอย่างสั่งของ 140926.xlsx) and the
// real Pizza Mania catalogue. The point of the file is the rule at the top of productMatch.ts:
// anything short of an exact name or a confirmed alias is a list to choose from, never an
// answer. A wrong guess here orders cheese from the wrong company.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildMatchIndex,
  matchProduct,
  normaliseName,
  similarity,
  type ProductAlias,
} from '../src/lib/productMatch'
import type { Product } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw } = await import('./helpers/memory-backend')
const { saveAlias, listAliases, aliasId } = await import('../src/services/productAliases')
const { setActiveBrand } = await import('../src/brand/brand')

let n = 0
function product(name: string, over: Partial<Product> = {}): Product {
  n++
  return {
    id: `p${n}`,
    sku: `SKU-${String(n).padStart(3, '0')}`,
    name,
    category: 'Test',
    unit: 'Kilogram',
    unitType: 'KG',
    minStock: 0,
    hasImage: false,
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const CATALOGUE = [
  'SWISS BROWN MUSHROOMS (ZAKANA)',
  'SAUSAGE MIX DOLCE (LADER)',
  'SALAMI PICCANTE (OLIVA)',
  'SALAMI PICCANTE (PREMIUM FOOD) 1Pack/1.2kg',
  'PARMA HAM 6-7 KG (OLIVA) 1 ลัง/2 ขา',
  'PEPPERONI DIAMETER PORK (LARDER)',
  "CUPPING PEPPERONI SLICED 18''(LARDER)",
  "CUPPING PEPPERONI XX SLICED 18''(LARDER)",
  'SMOKED BACON SLICED 1 KG (TGM)',
  'PARIS HAM (TGM)',
  'BEEF FROZEN 1 KG (LAPALOMA)',
  'SHRIMP (KT)',
  'SHRIMP (PPN SEAFOOD)',
  'MOZZARELLA WHOLE MILK 2.72*8 (FOODGALLERY)',
  'GOAT CHEESE 1 KG (EUROPEAN)',
  'MASCARPONE CREAM CHEESE 6X500GR (OLIVA) 500gr/EA',
  'BLUE CHEESE 3 KG (TOPFOOD)',
  'BLUE CHEESE 3 KG (FOOD PROJECT)',
  'TOMATO SAUCE 4.10KG (OLIVA)',
  'FRENCH FRIES  3/8 (PANFOOD)',
  'FRENCH MASTARD 226 (VL)',
  'PIZZA BOX 18.5" 1PACK=25PCS (PRIMEMATE)',
  'COKE ZERO CAN 325 ML 1X24 (THAINAMTHIP)',
  'GAS 48 KG (BRANCH 3)',
].map((name) => product(name))

const byName = (name: string) => CATALOGUE.find((p) => p.name === name)!
const index = () => buildMatchIndex(CATALOGUE, [])

describe('normaliseName', () => {
  test('the supplier bracket and the size glue are the two things that differ most', () => {
    expect(normaliseName('FRENCH FRIES  3/8 2.26KG')).toBe('FRENCH FRIES 3/8 2.26 KG')
    expect(normaliseName('French Fries 3/8 2.26 kg')).toBe('FRENCH FRIES 3/8 2.26 KG')
    expect(normaliseName('SMOKED BACON SLICED 1 KG (TGM)')).toBe('SMOKED BACON SLICED 1 KG')
    expect(normaliseName('SMOKED BACON SLICED 1 KG ')).toBe('SMOKED BACON SLICED 1 KG')
  })

  test('a bracket in the middle of the name goes too, and what follows it stays', () => {
    expect(normaliseName('PARMA HAM 6-7 KG (OLIVA) 1 ลัง/2 ขา')).toBe(
      normaliseName('PARMA HAM 6-7 KG  1 ลัง/2 ขา'),
    )
  })

  test('"kg." and "kg*8" are punctuation, not different sizes', () => {
    expect(normaliseName('PEPPERONI PORK AND BEEF 1 kg.')).toBe('PEPPERONI PORK AND BEEF 1 KG')
    expect(normaliseName('MOZZARELLA WHOLE MILK 2.72 kg*8')).toBe('MOZZARELLA WHOLE MILK 2.72 KG 8')
  })

  test('a decimal keeps its dot', () => {
    expect(normaliseName('TOMATO SAUCE 4.05 KG')).toBe('TOMATO SAUCE 4.05 KG')
  })
})

describe('what counts as an answer', () => {
  test('the same name as exactly one product is a match', () => {
    const m = matchProduct('SMOKED BACON SLICED 1 KG ', index())
    expect(m.kind).toBe('exact')
    expect(m.product).toBe(byName('SMOKED BACON SLICED 1 KG (TGM)'))
  })

  test('the SKU typed instead of the name is a match', () => {
    const p = byName('PARIS HAM (TGM)')
    expect(matchProduct(p.sku, index())).toMatchObject({ kind: 'exact', product: p })
  })

  test('the same cheese from two suppliers is a question, not a coin toss', () => {
    const m = matchProduct('BLUE CHEESE 3 KG ', index())
    expect(m.kind).toBe('ambiguous')
    expect(m.product).toBeUndefined()
    expect(m.candidates.map((c) => c.product.name).sort()).toEqual([
      'BLUE CHEESE 3 KG (FOOD PROJECT)',
      'BLUE CHEESE 3 KG (TOPFOOD)',
    ])
  })

  test('a bare "PEPPERONI" against three pepperonis picks none of them', () => {
    const m = matchProduct('PEPPERONI', index())
    expect(m.kind).toBe('none')
    expect(m.product).toBeUndefined()
    expect(m.candidates.length).toBeGreaterThanOrEqual(2)
    expect(m.candidates.every((c) => c.product.name.includes('PEPPERONI'))).toBe(true)
  })

  test('a different size is offered first, but never taken', () => {
    const m = matchProduct('TOMATO SAUCE 4.05 KG ', index())
    expect(m.kind).toBe('none')
    expect(m.candidates[0].product.name).toBe('TOMATO SAUCE 4.10KG (OLIVA)')
  })

  test('the workbook adding a pack size is offered first, never taken', () => {
    const m = matchProduct('FRENCH FRIES  3/8 2.26KG', index())
    expect(m.kind).toBe('none')
    expect(m.candidates[0].product.name).toBe('FRENCH FRIES  3/8 (PANFOOD)')
    // FRENCH MASTARD shares a word; it must not outrank the fries.
    expect(m.candidates.map((c) => c.product.name)).not.toContain('GAS 48 KG (BRANCH 3)')
  })

  test('a Thai name the catalogue has never seen has nothing to offer', () => {
    const m = matchProduct('กุ้งขาว', index())
    expect(m.kind).toBe('none')
    expect(m.candidates).toEqual([])
  })

  test('a hidden product is not matched silently', () => {
    const hidden = product('SCAMORZA (DEL CASARO)', { active: false })
    const idx = buildMatchIndex([...CATALOGUE, hidden], [])
    const m = matchProduct('SCAMORZA', idx)
    expect(m.kind).toBe('none')
    expect(m.candidates[0].product).toBe(hidden)
  })

  test('an empty cell matches nothing', () => {
    expect(matchProduct('   ', index())).toMatchObject({ kind: 'none', candidates: [] })
  })
})

describe('an alias is remembered', () => {
  test('a confirmed spelling settles the ambiguous cheese next time', () => {
    const topfood = byName('BLUE CHEESE 3 KG (TOPFOOD)')
    const alias: ProductAlias = {
      id: 'a1',
      key: normaliseName('BLUE CHEESE 3 KG'),
      productId: topfood.id,
      sourceName: 'BLUE CHEESE 3 KG ',
      createdBy: 'u1',
      createdByName: 'AA',
      createdAt: 0,
    }
    const m = matchProduct('blue cheese 3 kg', buildMatchIndex(CATALOGUE, [alias]))
    expect(m).toMatchObject({ kind: 'alias', product: topfood })
  })

  test('a Thai spelling reaches its product through an alias only', () => {
    const shrimp = byName('SHRIMP (PPN SEAFOOD)')
    const alias: ProductAlias = {
      id: 'a2',
      key: normaliseName('กุ้งขาว'),
      productId: shrimp.id,
      sourceName: 'กุ้งขาว',
      createdBy: 'u1',
      createdByName: 'AA',
      createdAt: 0,
    }
    expect(matchProduct('กุ้งขาว', buildMatchIndex(CATALOGUE, [alias]))).toMatchObject({
      kind: 'alias',
      product: shrimp,
    })
  })
})

describe('similarity', () => {
  test('is symmetric and bounded', () => {
    const a = normaliseName('FRENCH FRIES 3/8 2.26KG')
    const b = normaliseName('FRENCH FRIES 3/8 (PANFOOD)')
    expect(similarity(a, b)).toBe(similarity(b, a))
    expect(similarity(a, a)).toBe(1)
    expect(similarity(a, '')).toBe(0)
  })
})

describe('saving an alias', () => {
  beforeEach(() => {
    resetMemory()
    setActiveBrand('pizza')
  })

  test('the same spelling saved twice is one document, the later one winning', async () => {
    const actor = { id: 'u1', name: 'AA' }
    await saveAlias({ sourceName: 'BLUE CHEESE 3 KG ', productId: 'p-top', actor })
    await saveAlias({ sourceName: 'blue cheese 3 kg', productId: 'p-fp', actor })
    const rows = raw('productAliases') as ProductAlias[]
    expect(rows).toHaveLength(1)
    expect(rows[0].productId).toBe('p-fp')
    expect(rows[0].id).toBe(aliasId(normaliseName('BLUE CHEESE 3 KG')))
    expect((await listAliases())[0].key).toBe('BLUE CHEESE 3 KG')
  })

  test('an alias id is a plain path segment', () => {
    expect(aliasId(normaliseName('FRENCH FRIES 3/8'))).toMatch(/^alias-[0-9a-f]{16}$/)
  })
})
