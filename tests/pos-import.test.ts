// POS sales into stock used (Automation Plan Phase 3, 25 Sep 2026): the day's sales export,
// summed per menu item, matched to recipes, ingredients totalled for one consume document.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { guessColumns, matchSales, readSales, type Row } from '../src/lib/posImport'
import type { Recipe } from '../src/types'

const recipe = (code: string, name: string, lines: [string, number][], over: Partial<Recipe> = {}): Recipe => ({
  id: code, code, name, active: true, createdBy: 'u', createdByName: 'U', createdAt: 0, updatedAt: 0,
  lines: lines.map(([p, qty]) => ({ productId: p, productName: p.toUpperCase(), unit: 'KG', qty })),
  ...over,
})
const MARGHERITA = recipe('45', 'Margherita', [['mozzarella', 0.12], ['dough', 1]])
const PEPPERONI = recipe('48', 'Pepperoni', [['mozzarella', 0.1], ['pepperoni', 0.05], ['dough', 1]], { aliases: ['Pep 12"'] })
const FRIES = recipe('69', 'Straight Cut French Fries', [])

const sheet: Row[] = [
  ['Daily sales', null, null, null],
  ['Item Code', 'Item Name', 'Qty', 'Amount'],
  ['045', 'Margherita', 3, '1,050'],
  ['48', 'Pepperoni', '2', 800],
  ['45', 'Margherita', 1, 350],
  ['', 'Pep 12"', 1, 400],
  ['69', 'Fries', 5, 500],
  ['999', 'Special of the day', 2, 600],
  ['46', 'BBQ Chicken', 0, 0],
  ['TOTAL', '', 14, 3700],
]

describe('reading the export', () => {
  test('finds the header row and guesses code, name and quantity', () => {
    expect(guessColumns(sheet)).toEqual({ header: 1, code: 0, name: 1, qty: 2 })
    expect(guessColumns([['รหัสเมนู', 'ชื่อเมนู', 'จำนวนที่ขายได้']])).toEqual({ header: 0, code: 0, name: 1, qty: 2 })
  })

  test('sums per item ("045" is 45), skips zero, blank and total rows', () => {
    const sales = readSales(sheet, guessColumns(sheet))
    expect(sales.find((s) => s.code === '045')?.qty).toBe(4)
    expect(sales.map((s) => s.name)).not.toContain('BBQ Chicken')
    expect(sales.some((s) => /total/i.test(s.code))).toBe(false)
    expect(sales).toHaveLength(5)
  })

  test('no quantity column, nothing read', () => {
    expect(readSales(sheet, { header: 1, code: 0, name: 1, qty: null })).toEqual([])
  })
})

describe('matching to recipes', () => {
  test('by code, then by name or alias; ingredients multiplied and summed', () => {
    const r = matchSales(readSales(sheet, guessColumns(sheet)), [MARGHERITA, PEPPERONI, FRIES])
    expect(r.matched.map((m) => [m.recipe.name, m.sale.qty])).toEqual([
      ['Margherita', 4],
      ['Pepperoni', 2],
      ['Pepperoni', 1],
    ])
    // mozzarella: 4 × 0.12 + 3 × 0.1 = 0.78; dough: 4 + 3 = 7; pepperoni 3 × 0.05
    expect(Object.fromEntries(r.usage.map((u) => [u.productId, u.qty]))).toEqual({ dough: 7, mozzarella: 0.78, pepperoni: 0.15 })
    expect(r.usage.find((u) => u.productId === 'mozzarella')?.from).toEqual(['Margherita', 'Pepperoni'])
  })

  test('what has no recipe is listed, and a recipe with no ingredients is flagged, not silently used', () => {
    const r = matchSales(readSales(sheet, guessColumns(sheet)), [MARGHERITA, PEPPERONI, FRIES])
    expect(r.unmatched.map((s) => s.name)).toEqual(['Special of the day'])
    expect(r.empty.map((m) => m.recipe.name)).toEqual(['Straight Cut French Fries'])
  })

  test('an inactive recipe does not match', () => {
    const r = matchSales([{ code: '45', name: 'Margherita', qty: 1 }], [{ ...MARGHERITA, active: false }])
    expect(r.unmatched).toHaveLength(1)
  })
})
