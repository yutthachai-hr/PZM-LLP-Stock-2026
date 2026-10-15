// Ranking the products to choose from when a workbook name matches none outright.
//
// Owner, 15 Oct 2026: "RANCH 1 kg." offered MAYONNAISE 1KG and GAS 48 KG Branch 1 before
// RANCH (PICHON). The old score counted the shared "1" and "KG" as much as the name.
// Exact, SKU and confirmed-alias answers are untouched: everything below stays a suggestion.

import { describe, expect, test } from 'vitest'
import { buildMatchIndex, matchProduct, productSimilarity, safeSuggestion } from '../src/lib/productMatch'
import { searchProducts } from '../src/lib/productSearch'
import type { Product } from '../src/types'

let n = 0
const product = (name: string, over: Partial<Product> = {}): Product => ({
  id: `p${++n}`, sku: `SKU-${n}`, name, category: 'Test', unit: 'Kilogram', unitType: 'KG', minStock: 0,
  hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over,
})
const names = (raw: string, catalogue: Product[]) => matchProduct(raw, buildMatchIndex(catalogue, [])).candidates.map((c) => c.product.name)

describe('product identity outranks shared sizes and units', () => {
  const catalogue = [product('MAYONNAISE 1KG (FB FOOD)'), product('GAS 48 KG Branch 1'), product('RANCH (PICHON)')]

  test('RANCH 1 kg. offers RANCH (PICHON) first, and only it', () => {
    const m = matchProduct('RANCH 1 kg.', buildMatchIndex(catalogue, []))
    expect(m.kind).toBe('none')
    expect(m.product).toBeUndefined()
    expect(m.candidates.map((c) => c.product.name)).toEqual(['RANCH (PICHON)'])
  })

  test('a shared "1 KG" alone never makes MAYONNAISE a candidate for RANCH', () => {
    expect(productSimilarity('RANCH 1 KG', 'MAYONNAISE 1 KG').score).toBe(0)
  })

  test('BRANCH is not RANCH, even though one letter apart', () => {
    expect(productSimilarity('RANCH 1 KG', 'GAS 48 KG BRANCH 1').score).toBe(0)
  })
})

describe('sizes decide between products with the same name', () => {
  test('FRENCH FRIES 3/8 2.26KG suggests the 3/8 fries; the cut is part of the name', () => {
    const cat = [product('FRENCH FRIES  3/8 (PANFOOD)'), product('FRENCH FRIES 1/4 (PANFOOD)'), product('FRENCH MASTARD 226 (VL)')]
    expect(names('FRENCH FRIES 3/8 2.26KG', cat)[0]).toBe('FRENCH FRIES  3/8 (PANFOOD)')
  })

  test('MOZZARELLA 2.72 kg × 8 prefers the 2.72×8 pack over a 1 KG mozzarella', () => {
    const cat = [product('MOZZARELLA 1 KG (OTHER)'), product('MOZZARELLA WHOLE MILK 2.72*8 (FOODGALLERY)')]
    expect(names('MOZZARELLA 2.72 kg × 8', cat)).toEqual(['MOZZARELLA WHOLE MILK 2.72*8 (FOODGALLERY)', 'MOZZARELLA 1 KG (OTHER)'])
  })

  test('a different pack size stays visible but flagged, never equivalent', () => {
    const cat = [product('PENNE 1KG (X)')]
    const m = matchProduct('PENNE 500G', buildMatchIndex(cat, []))
    expect(m.kind).toBe('none')
    expect(m.candidates).toEqual([expect.objectContaining({ sizeConflict: true })])
  })

  test('PENNE 500G is an exact answer when the catalogue has PENNE 500G', () => {
    const cat = [product('PENNE 500G (X)'), product('PENNE 1KG (Y)')]
    expect(matchProduct('PENNE 500G', buildMatchIndex(cat, []))).toMatchObject({ kind: 'exact', product: cat[0] })
  })
})

describe('spelling, language and catalogue state', () => {
  test('a one-letter typo in a long word still finds the product', () => {
    const cat = [product('MOZZARELLA WHOLE MILK 2.72*8 (FOODGALLERY)'), product('MASCARPONE 500 G (OLIVA)')]
    expect(names('MOZARELLA 2.72 kg x 8', cat)[0]).toBe('MOZZARELLA WHOLE MILK 2.72*8 (FOODGALLERY)')
  })

  test('mixed Thai and English names rank by the shared words', () => {
    const cat = [product('ชีส MOZZARELLA 2.72*8'), product('ชีส CHEDDAR 1 KG')]
    expect(names('ชีส MOZZARELLA', cat)[0]).toBe('ชีส MOZZARELLA 2.72*8')
  })

  test('the same name from two suppliers is still a question, never one answer', () => {
    const cat = [product('SHRIMP (KT)'), product('SHRIMP (PPN SEAFOOD)')]
    expect(matchProduct('SHRIMP', buildMatchIndex(cat, [])).kind).toBe('ambiguous')
  })

  test('an inactive product can be offered, but is never answered on its own', () => {
    const cat = [product('RANCH (PICHON)', { active: false })]
    const m = matchProduct('RANCH', buildMatchIndex(cat, []))
    expect(m.kind).toBe('none')
    expect(m.candidates.map((c) => c.product.name)).toEqual(['RANCH (PICHON)'])
  })

  test('an empty or partly loaded catalogue offers nothing rather than a wrong product', () => {
    expect(matchProduct('RANCH 1 kg.', buildMatchIndex([], [])).candidates).toEqual([])
  })

  test('only numbers and units are not a product name', () => {
    expect(productSimilarity('1 KG', 'MAYONNAISE 1 KG').score).toBe(0)
  })
})

describe('the hint shown in the import preview', () => {
  const hint = (raw: string, catalogue: Product[]) => safeSuggestion(matchProduct(raw, buildMatchIndex(catalogue, [])))?.name

  test('RANCH 1 kg. hints RANCH (PICHON)', () => {
    expect(hint('RANCH 1 kg.', [product('MAYONNAISE 1KG (FB FOOD)'), product('RANCH (PICHON)')])).toBe('RANCH (PICHON)')
  })

  test('a candidate of another pack size is never the hint', () => {
    expect(hint('RANCH 1 KG', [product('RANCH 500 G (PICHON)')])).toBeUndefined()
  })

  test('a hidden product is never the hint', () => {
    expect(hint('RANCH 1 KG', [product('RANCH (PICHON)', { active: false })])).toBeUndefined()
  })
})

describe('typing in the product picker ranks the way the import does', () => {
  test('RANCH 1 KG finds RANCH (PICHON) first, and never MAYONNAISE 1KG', () => {
    const cat = [product('MAYONNAISE 1KG (FB FOOD)'), product('GAS 48 KG Branch 1'), product('RANCH (PICHON)')]
    const found = searchProducts('RANCH 1 KG', cat).map((p) => p.name)
    expect(found[0]).toBe('RANCH (PICHON)')
    expect(found).not.toContain('MAYONNAISE 1KG (FB FOOD)')
  })

  test('typing still forgives spacing and word order', () => {
    const cat = [product('SALAD (SIAM FOOD)'), product('RED OAK SALAD (ACK)'), product('MOZZARELLA CHEESE')]
    expect(searchProducts('siamfood salad', cat)[0].name).toBe('SALAD (SIAM FOOD)')
    expect(searchProducts('salad ack', cat)[0].name).toBe('RED OAK SALAD (ACK)')
    expect(searchProducts('moz che', cat).map((p) => p.name)).toEqual(['MOZZARELLA CHEESE'])
  })

  test('a word typed on its own still finds it, and a code still wins', () => {
    const cat = [product('RANCH (PICHON)', { sku: 'PZS-01-06-001' }), product('MAYONNAISE 1KG (FB FOOD)')]
    expect(searchProducts('ranch', cat).map((p) => p.name)).toEqual(['RANCH (PICHON)'])
    expect(searchProducts('PZS-01-06-001', cat).map((p) => p.name)).toEqual(['RANCH (PICHON)'])
  })
})

describe("the owner's other cases", () => {
  test('PENNE 500 G offers PENNE, not another 500 G product', () => {
    const cat = [product('MASCARPONE 500 G (OLIVA)'), product('PENNE (PASTA CO)')]
    expect(names('PENNE 500 G', cat)).toEqual(['PENNE (PASTA CO)'])
  })

  test('RANCH 1 KG against only RANCH 500 G is a flagged choice, never a match', () => {
    const m = matchProduct('RANCH 1 KG', buildMatchIndex([product('RANCH 500 G (PICHON)')], []))
    expect(m.kind).toBe('none')
    expect(m.product).toBeUndefined()
    expect(m.candidates).toEqual([expect.objectContaining({ sizeConflict: true })])
  })

  test('a SKU and a confirmed alias still answer before any ranking', () => {
    const ranch = product('RANCH (PICHON)', { sku: 'PZS-01-06-001' })
    const mayo = product('MAYONNAISE 1KG (FB FOOD)')
    expect(matchProduct('PZS-01-06-001', buildMatchIndex([mayo, ranch], []))).toMatchObject({ kind: 'exact', product: ranch })
    const alias = { id: 'a1', key: 'RANCH 1 KG', productId: mayo.id, sourceName: 'RANCH 1 kg.', createdBy: 'u', createdByName: 'U', createdAt: 0 }
    // A person confirmed it once; the ranking does not overrule them.
    expect(matchProduct('RANCH 1 kg.', buildMatchIndex([mayo, ranch], [alias]))).toMatchObject({ kind: 'alias', product: mayo })
  })
})
