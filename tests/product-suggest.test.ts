// Suggestions for a name read off a file (6 Oct 2026): word by word, order ignored,
// sizes and punctuation ignored — the LINE order screenshot that matched nothing.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { suggestProducts, words } from '../src/lib/productSuggest'
import type { Product } from '../src/types'

const p = (id: string, name: string, sku = id): Product => ({ id, name, sku, active: true }) as Product
const catalogue = [
  p('feta', 'FETA CHEESE 500G (HOMEMADE CHEESE)', 'CHS-10-001'),
  p('felix', 'FELIX SOLIS PENASOL WINE 3L'),
  p('yog', 'YOGHURT PLAIN 1 KG'),
  p('yogs', 'YOGHURT STRAWBERRY 1 KG'),
  p('garlic', 'WHITE CHEESE GARLIC & DILL 1KG'),
  p('wcheese', 'WHITE CHEESE'),
  p('old', 'FETA CHEESE OLD', 'X') ,
]
catalogue[6].active = false

describe('suggestProducts', () => {
  test('the screenshot rows find their products, best first', () => {
    // FETA first (both words); plain "cheese" products follow as weaker choices.
    expect(suggestProducts('Feta cheese.', catalogue)).toMatchObject([{ product: { id: 'feta' }, score: 1 }, { score: 0.5 }, { score: 0.5 }])
    expect(suggestProducts('Plain yoghurt.', catalogue)[0].product.id).toBe('yog')
    expect(suggestProducts('Garlic dill white cheese', catalogue)[0]).toMatchObject({ product: { id: 'garlic' }, score: 1 })
  })
  test('a two-letter fragment like "fe" is not a match for every FE-word', () => {
    expect(suggestProducts('Feta cheese', catalogue).map((s) => s.product.id)).not.toContain('felix')
  })
  test('sizes, units and punctuation are not words', () => {
    expect(words('Feta cheese 500g, 2 kg (x2).')).toEqual(['feta', 'cheese'])
  })
  test('inactive products are never suggested; nothing close: nothing', () => {
    expect(suggestProducts('feta cheese', catalogue).map((s) => s.product.id)).not.toContain('old')
    expect(suggestProducts('chocolate', catalogue)).toEqual([])
  })
})
