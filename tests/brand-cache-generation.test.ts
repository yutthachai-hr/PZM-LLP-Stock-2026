// A list read for one brand that arrives after the brand changed is handed to whoever asked,
// never kept as the new brand's copy (owner, 12 Oct 2026). Suppliers and stock-count schedules.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ pending: [] as { collection: string; resolve: (rows: unknown[]) => void }[], reads: [] as string[] }))

vi.mock('../src/backend', () => {
  const read = (collection: string) =>
    new Promise<unknown[]>((resolve) => {
      h.reads.push(collection)
      h.pending.push({ collection, resolve })
    })
  const db = { getAll: read }
  return { backend: { ...db, forBrand: () => db }, BACKEND_MODE: 'local' }
})

import { setActiveBrand } from '../src/brand/brand'
import { loadSuppliers } from '../src/services/suppliers'
import { loadScheduleConfig } from '../src/services/schedules'
import { loadRecipes } from '../src/services/recipes'

beforeEach(() => {
  h.pending.length = 0
  h.reads.length = 0
  setActiveBrand('pizza')
})

describe('suppliers', () => {
  test('a Pizza Mania read finishing after the switch is not kept as Le Lapin\'s list', async () => {
    const pizza = loadSuppliers()
    await vi.waitFor(() => expect(h.pending).toHaveLength(1))
    setActiveBrand('lelapin')
    h.pending[0].resolve([{ id: 'sup-pizza', name: 'PIZZA ONLY' }])
    expect((await pizza).map((s) => s.id)).toEqual(['sup-pizza']) // the caller still gets its answer
    // Le Lapin asks: a fresh read, not Pizza Mania's rows.
    const lelapin = loadSuppliers()
    await vi.waitFor(() => expect(h.pending).toHaveLength(2))
    h.pending[1].resolve([{ id: 'sup-lelapin', name: 'LAPIN ONLY' }])
    expect((await lelapin).map((s) => s.id)).toEqual(['sup-lelapin'])
    // And now Le Lapin's list is held (no further read).
    expect((await loadSuppliers()).map((s) => s.id)).toEqual(['sup-lelapin'])
    expect(h.reads).toHaveLength(2)
  })
})

describe('stock-count schedules', () => {
  test('a Pizza Mania read finishing after the switch is not kept as Le Lapin\'s schedules', async () => {
    const pizza = loadScheduleConfig()
    await vi.waitFor(() => expect(h.pending).toHaveLength(1))
    setActiveBrand('lelapin')
    h.pending[0].resolve([{ id: 'sch-pizza', kind: 'stockCount', name: 'PIZZA COUNT', enabled: true }])
    await pizza
    const lelapin = loadScheduleConfig()
    await vi.waitFor(() => expect(h.pending).toHaveLength(2))
    h.pending[1].resolve([{ id: 'sch-lelapin', kind: 'stockCount', name: 'LAPIN COUNT', enabled: true }])
    expect((await lelapin).schedules.map((s) => s.id)).toEqual(['sch-lelapin'])
    expect((await loadScheduleConfig()).schedules.map((s) => s.id)).toEqual(['sch-lelapin'])
    expect(h.reads).toHaveLength(2)
  })
})

describe('recipes', () => {
  test('a Pizza Mania read finishing after the switch is not kept as Le Lapin\'s recipes', async () => {
    const pizza = loadRecipes()
    await vi.waitFor(() => expect(h.pending).toHaveLength(1))
    setActiveBrand('lelapin')
    h.pending[0].resolve([{ id: 'rec-pizza', code: 'P1', name: 'PIZZA ONLY' }])
    expect((await pizza).map((r) => r.id)).toEqual(['rec-pizza'])
    const lelapin = loadRecipes()
    await vi.waitFor(() => expect(h.pending).toHaveLength(2))
    h.pending[1].resolve([{ id: 'rec-lelapin', code: 'L1', name: 'LAPIN ONLY' }])
    expect((await lelapin).map((r) => r.id)).toEqual(['rec-lelapin'])
    expect((await loadRecipes()).map((r) => r.id)).toEqual(['rec-lelapin'])
    expect(h.reads).toHaveLength(2)
  })
})
