// Recipes (Automation Plan Phase 3, 25 Sep 2026): what one sale of a POS menu item takes
// from stock. Written by a หัวหน้า/admin, codes unique, never deleted.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Product, Recipe } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw } = await import('./helpers/memory-backend')
const R = await import('../src/services/recipes')
const { setActiveBrand } = await import('../src/brand/brand')

const MANAGER = { id: 'u-m', name: 'M', role: 'manager' as const }
const STAFF = { id: 'u-s', name: 'S', role: 'staff' as const }
const product = (id: string, unitType = 'KG'): Product => ({
  id, sku: id, name: id.toUpperCase(), category: 'c', unit: unitType, unitType, minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0,
})
const products = [product('mozzarella'), product('dough', 'EA')]

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
})

describe('saving a recipe', () => {
  test('lines take the product name and unit from the catalogue', async () => {
    const r = await R.saveRecipe({ code: '45', name: 'Margherita', lines: [{ productId: 'mozzarella', qty: 0.12 }, { productId: 'dough', qty: 1 }] }, { products, existing: [] }, MANAGER)
    expect(r.lines).toEqual([
      { productId: 'mozzarella', productName: 'MOZZARELLA', unit: 'KG', qty: 0.12 },
      { productId: 'dough', productName: 'DOUGH', unit: 'EA', qty: 1 },
    ])
    expect((raw('recipes') as unknown as Recipe[])[0]).toMatchObject({ code: '45', active: true, createdBy: 'u-m' })
  })

  test('staff cannot; the code is required and unique ("045" is 45); lines must be real and positive', async () => {
    const base = { code: '45', name: 'Margherita', lines: [{ productId: 'dough', qty: 1 }] }
    await expect(R.saveRecipe(base, { products, existing: [] }, STAFF)).rejects.toThrow()
    await expect(R.saveRecipe({ ...base, code: ' ' }, { products, existing: [] }, MANAGER)).rejects.toThrow()
    const first = await R.saveRecipe(base, { products, existing: [] }, MANAGER)
    await expect(R.saveRecipe({ ...base, code: '045', name: 'Other' }, { products, existing: [first] }, MANAGER)).rejects.toThrow()
    await expect(R.saveRecipe({ ...base, code: '46', lines: [{ productId: 'nope', qty: 1 }] }, { products, existing: [first] }, MANAGER)).rejects.toThrow()
    await expect(R.saveRecipe({ ...base, code: '46', lines: [{ productId: 'dough', qty: 0 }] }, { products, existing: [first] }, MANAGER)).rejects.toThrow()
    await expect(R.saveRecipe({ ...base, code: '46', lines: [{ productId: 'dough', qty: 1 }, { productId: 'dough', qty: 2 }] }, { products, existing: [first] }, MANAGER)).rejects.toThrow()
  })

  test('editing keeps who made it; switching off keeps it on the books', async () => {
    const r = await R.saveRecipe({ code: '48', name: 'Pepperoni', lines: [] }, { products, existing: [] }, MANAGER)
    const edited = await R.saveRecipe({ id: r.id, code: '48', name: 'Pepperoni 12"', aliases: ['Pep'], lines: [{ productId: 'dough', qty: 1 }] }, { products, existing: [r] }, { ...MANAGER, id: 'u-a', name: 'A', role: 'admin' })
    expect(edited).toMatchObject({ id: r.id, createdBy: 'u-m', updatedBy: 'u-a', aliases: ['Pep'] })
    const off = await R.setRecipeActive(edited, false, MANAGER)
    expect(off.active).toBe(false)
    expect(raw('recipes')).toHaveLength(1)
  })
})

describe('starting from the menu codes', () => {
  test('one empty recipe per code not already there; pressing twice adds nothing', async () => {
    const menu = [['45', 'Margherita'], ['48', 'Pepperoni']] as const
    const first = await R.saveRecipe({ code: '045', name: 'Margherita', lines: [] }, { products, existing: [] }, MANAGER)
    expect(await R.addMissingMenu(menu, { products, existing: [first] }, MANAGER)).toBe(1)
    const all = raw('recipes') as unknown as Recipe[]
    expect(all.map((r) => r.code).sort()).toEqual(['045', '48'])
    expect(await R.addMissingMenu(menu, { products, existing: all }, MANAGER)).toBe(0)
    await expect(R.addMissingMenu(menu, { products, existing: [] }, STAFF)).rejects.toThrow()
  })
})
