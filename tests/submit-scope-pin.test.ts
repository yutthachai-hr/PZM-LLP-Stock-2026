// A backdated count or adjustment reads its figures, awaits a fresh server read, then files.
// The brand must be the one the person keyed the figures in — pinned when they pressed the
// button — not whichever brand is active once the read returns (history review R2 C-01).

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveCollection, setActiveBrand, type BrandId } from '../src/brand/brand'
import { COL, type MonthlyCount } from '../src/types'
import { createMemoryBackend, raw, resetMemory, seed } from './helpers/memory-backend'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { postMonthlyCount, recordMonthlyCount } = await import('../src/services/monthlyCounts')
const { adjustStockLines, captureFilingScope } = await import('../src/services/stock')
const brands: BrandId[] = ['pizza', 'lelapin']
const actor = { id: 'manager-fixture', name: 'Manager fixture' }
const locationId = 'loc-main'
const sheetId = 'shared-sheet-id'
const date = Date.UTC(2026, 8, 30)

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  for (const brand of brands) {
    seed(resolveCollection(COL.products, brand), [{
      id: 'p1', sku: 'p1', name: `${brand}-p1`, category: 'c', unit: 'each', unitType: 'EA',
      minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1,
    }])
    seed(resolveCollection(COL.locations, brand), [{ id: locationId, name: brand, type: 'warehouse', active: true, createdAt: 1 }])
    // The same sheet id in both brands: filing into the wrong one would succeed silently.
    seed(resolveCollection(COL.monthlyCounts, brand), [{
      id: sheetId, locationId, month: '2026-09', countDate: date, status: 'counting', lines: {},
      createdBy: actor.id, createdByName: actor.name, createdAt: 1, updatedAt: 1,
    }])
  }
})

/** Pressed in pizza; the person switches to Le Lapin while the fresh read is awaited. */
function pressedInPizzaThenSwitched() {
  setActiveBrand('pizza')
  const scope = captureFilingScope()
  setActiveBrand('lelapin')
  return scope
}

describe('a submit files into the brand it was pressed in', () => {
  test('monthly post', async () => {
    const scope = pressedInPizzaThenSwitched()
    await postMonthlyCount({
      id: sheetId, actor, note: 'synthetic', results: {}, scope,
      parts: [[{ productId: 'p1', productName: 'pizza-p1', unit: 'EA', diff: 4 }]],
    })
    expect(raw(resolveCollection(COL.movements, 'pizza')).map((m) => m.qty)).toEqual([4])
    expect(raw(resolveCollection(COL.movements, 'lelapin'))).toEqual([])
    expect(await createMemoryBackend('lelapin').getOne<MonthlyCount>(COL.monthlyCounts, sheetId)).toMatchObject({ status: 'counting' })
  })

  test('monthly record', async () => {
    const scope = pressedInPizzaThenSwitched()
    await recordMonthlyCount({ id: sheetId, actor, results: {}, scope })
    expect(await createMemoryBackend('pizza').getOne<MonthlyCount>(COL.monthlyCounts, sheetId)).toMatchObject({ status: 'recorded' })
    expect(await createMemoryBackend('lelapin').getOne<MonthlyCount>(COL.monthlyCounts, sheetId)).toMatchObject({ status: 'counting' })
  })

  test('adjustment', async () => {
    const scope = pressedInPizzaThenSwitched()
    await adjustStockLines({
      scope, locationId, date, actor,
      lines: [{ productId: 'p1', productName: 'pizza-p1', unit: 'EA', direction: 'in', qty: 2, reason: 'count' }],
    })
    expect(raw(resolveCollection(COL.movements, 'pizza')).map((m) => m.qty)).toEqual([2])
    expect(raw(resolveCollection(COL.movements, 'lelapin'))).toEqual([])
  })
})
