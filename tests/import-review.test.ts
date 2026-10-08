// Release hardening (8 Oct 2026): what an imported line (Excel / photo / PDF) is filed as.
// The import window serves purchase requests, orders, monthly counts, adjustments and the
// line builder — these rules hold for all of them (one window, lib/importReview).
//
//   npm test
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { blockedReason, choose, importable, lacksUnit, planRows, setInclude, type ReadLine } from '../src/lib/importReview'
import type { Product } from '../src/types'

const P = (id: string, name: string, over: Partial<Product> = {}): Product =>
  ({ id, sku: id.toUpperCase(), name, category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over }) as Product

const catalogue = [
  P('feta', 'FETA CHEESE 500G (HOMEMADE CHEESE)', { unitConversions: [{ label: 'Pack', size: 0.5 }] }),
  P('yog', 'YOGHURT PLAIN 1 KG'),
  P('basil-a', 'BASIL', { supplierId: 's1' }),
  P('basil-b', 'BASIL', { supplierId: 's2' }),
  P('saffron', 'KASHMIRI SAFFRON (LES FARMIERS)', { unit: '', unitType: '' }), // an R&D row with no unit (main 476fa35)
  P('flour', 'FLOUR'),
]
const line = (name: string, qty = 2, unit?: string): ReadLine => ({ name, qty, ...(unit ? { unit } : {}) })

describe('what is ticked on arrival', () => {
  test('a sure match (code / exact name) is ticked, as before', () => {
    const [byCode, byName] = planRows([{ name: 'x', code: 'FLOUR', qty: 3 }, line('flour')], catalogue)
    expect([byCode.how, byCode.include, byCode.product?.id]).toEqual(['sure', true, 'flour'])
    expect([byName.how, byName.include, byName.product?.id]).toEqual(['sure', true, 'flour'])
  })

  test('a guess is shown with its product filled in, but NOT ticked — and not importable until confirmed', () => {
    const [g] = planRows([line('Feta cheese.')], catalogue)
    expect(g.how).toBe('guess')
    expect(g.product?.id).toBe('feta')
    expect(g.include).toBe(false)
    expect(importable([g])).toEqual([])
    // Even if something set the flag without the person, a bare guess never leaves.
    expect(importable([{ ...g, include: true }])).toEqual([])
  })

  test('confirming a guess (ticking it) makes it the person\'s choice; unticking takes it back', () => {
    const [g] = planRows([line('Plain yoghurt')], catalogue)
    const ok = setInclude(g, true)
    expect([ok.how, ok.include]).toEqual(['picked', true])
    expect(importable([ok]).map((r) => r.product?.id)).toEqual(['yog'])
    expect(importable([setInclude(ok, false)])).toEqual([])
  })

  test('ambiguous names never become a mapping by themselves: no product chosen, candidates offered', () => {
    const [b] = planRows([line('Basil')], catalogue)
    expect(b.product).toBeNull()
    expect(b.include).toBe(false)
    expect(b.suggestions.map((p) => p.id).sort()).toEqual(['basil-a', 'basil-b'])
    expect(importable([b])).toEqual([])
    expect(setInclude(b, true).include).toBe(false) // nothing to tick without a product
    const picked = choose(b, catalogue[3])
    expect([picked.how, picked.include, picked.product?.id]).toEqual(['picked', true, 'basil-b'])
  })

  test('nothing is invented: an unknown name stays unmatched, with no product, supplier or unit made up', () => {
    const [u] = planRows([line('Sumac powder', 1, 'tub')], catalogue)
    expect(u.product).toBeNull()
    expect(u.how).toBeNull()
    expect(importable([u])).toEqual([])
  })
})

describe('units', () => {
  test('a unit the product can convert is converted (1 Pack of feta = 0.5 KG)', () => {
    const [f] = planRows([{ name: 'x', code: 'FETA', qty: 4, unit: 'Pack' }], catalogue)
    expect([f.qty, f.entryUnit, f.entryQty, f.include]).toEqual([2, 'Pack', 4, true])
  })

  test('a unit the product has no rate for is flagged and cannot be imported — not silently used as the base unit', () => {
    const [f] = planRows([{ name: 'x', code: 'FLOUR', qty: 2, unit: 'Box' }], catalogue)
    expect(f.unitUnknown).toBe('Box')
    expect(blockedReason(f)).toBe('unit-unknown')
    expect(f.include).toBe(false)
    expect(setInclude(f, true).include).toBe(false)
    expect(importable([{ ...f, include: true }])).toEqual([])
  })

  test('a product with no unit of its own (R&D catalogue rows) can be shown but never imported', () => {
    expect(lacksUnit(catalogue[4])).toBe(true)
    const [s] = planRows([{ name: 'x', code: 'SAFFRON', qty: 1 }], catalogue)
    expect(s.product?.id).toBe('saffron')
    expect(blockedReason(s)).toBe('product-has-no-unit')
    expect(s.include).toBe(false)
    expect(choose(s, catalogue[4]).include).toBe(false)
    expect(importable([{ ...s, include: true, how: 'picked' }])).toEqual([])
  })

  test('a zero or broken quantity is blocked', () => {
    const [z] = planRows([{ name: 'x', code: 'FLOUR', qty: 0 }], catalogue)
    expect(blockedReason(z)).toBe('bad-qty')
    expect(z.include).toBe(false)
  })
})

describe('every consumer goes through these rules', () => {
  test('the import window decides rows only through lib/importReview, and every screen imports through the window', () => {
    const modal = readFileSync('src/components/import/LineImportModal.tsx', 'utf8')
    expect(modal).toContain('planRows(')
    expect(modal).toContain('importable(rows)')
    expect(modal).not.toMatch(/include:\s*!c\.unitUnknown/) // the old pre-tick of guesses is gone
    for (const f of ['src/components/LineBuilder.tsx', 'src/pages/Adjust.tsx', 'src/pages/counts/MonthlyCountSheet.tsx', 'src/pages/Orders.tsx', 'src/pages/requests/RequestEditor.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('<LineImportModal')
    }
  })

  test('the receiving bill reader takes sure matches only (it never had guesses)', () => {
    const receive = readFileSync('src/pages/Receive.tsx', 'utf8')
    expect(receive).toContain('matchOcrLines(')
    expect(receive).not.toContain('suggestProducts(')
  })
})
