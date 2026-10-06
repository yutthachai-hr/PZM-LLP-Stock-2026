// Posting a monthly count (plan A10, 6 Oct 2026): the difference is worked out inside the
// transaction from the books as they are then, so stock filed while the manager reviews
// never makes the posted figure wrong.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, seed, raw, memoryBackend } = await import('./helpers/memory-backend')
const { postMonthlyCount } = await import('../src/services/monthlyCounts')
const { receiveStock } = await import('../src/services/stock')
const { countDayOf } = await import('../src/lib/monthlyCount')
const { setActiveBrand } = await import('../src/brand/brand')
import type { StockMovement } from '../src/types'

const ACTOR = { id: 'u-mgr', name: 'Manager' }
const WH = 'wh'
const COUNT_DAY = countDayOf('2026-09')
const LATER = COUNT_DAY + 3 * 86_400_000

const level = (pid: string) => (raw('stockLevels').find((d) => d.id === `${WH}__${pid}`)?.qty as number) ?? 0
const adjustments = () => (raw('stockMovements') as unknown as StockMovement[]).filter((m) => m.type === 'adjust')
const flourLine = (qty: number) => ({ productId: 'flour', productName: 'FLOUR', unit: 'KG', qty })

beforeEach(async () => {
  resetMemory()
  setActiveBrand('pizza')
  seed('locations', [{ id: WH, name: 'Main', type: 'warehouse', active: true, createdAt: 0 }])
  seed('products', [
    { id: 'flour', sku: 'F', name: 'FLOUR', category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, cost: 20 },
    { id: 'salt', sku: 'S', name: 'SALT', category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, cost: 5 },
  ])
  // 10 on the count day; 5 more arrived three days later.
  await receiveStock({ lines: [flourLine(10)], toLocationId: WH, date: COUNT_DAY - 86_400_000, actor: ACTOR })
  await receiveStock({ lines: [{ productId: 'salt', productName: 'SALT', unit: 'KG', qty: 4 }], toLocationId: WH, date: COUNT_DAY - 86_400_000, actor: ACTOR })
  await receiveStock({ lines: [flourLine(5)], toLocationId: WH, date: LATER, actor: ACTOR })
})

/** The sheet as counted: the posting takes the figures from here, never from the caller. */
function seedSheet(flour: number, salt = 4) {
  const line = (qty: number) => ({ qty, by: 'u', byName: 'U', at: 0 })
  seed('monthlyCounts', [
    { id: `${WH}__2026-09`, locationId: WH, month: '2026-09', countDate: COUNT_DAY, status: 'counting', lines: { flour: line(flour), salt: line(salt) }, createdBy: 'u', createdByName: 'U', createdAt: 0, updatedAt: 0 },
  ])
}

describe('postMonthlyCount', () => {
  test('files counted − books on the count day, on that day, and the sheet keeps the figures', async () => {
    seedSheet(8)
    await postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count', approveBig: true })
    expect(adjustments()).toHaveLength(1)
    expect(adjustments()[0]).toMatchObject({ productId: 'flour', qty: 2, fromLocationId: WH, date: COUNT_DAY })
    expect(level('flour')).toBe(13) // 8 counted + 5 that came after
    const sheet = raw('monthlyCounts')[0] as { status: string; results: Record<string, unknown>; postedIds: string[] }
    expect(sheet.status).toBe('posted')
    expect(sheet.results.flour).toEqual({ systemQty: 10, countedQty: 8, diff: -2, value: -40, bigApprovedBy: ACTOR.name })
    expect(sheet.results.salt).toEqual({ systemQty: 4, countedQty: 4, diff: 0, value: 0 })
    expect(sheet.postedIds.sort()).toEqual(['flour', 'salt'])
  })

  test('stock filed between reading the books and posting: read again, and the count still holds', async () => {
    seedSheet(8)
    // A delivery dated on the count day, and one dated today, both land just after the
    // posting has read the movements — the moment the old screen-side difference went stale.
    let slipped = false
    const original = memoryBackend.forBrand.bind(memoryBackend)
    const spy = vi.spyOn(memoryBackend, 'forBrand').mockImplementation((b) => {
      const real = original(b)
      return {
        ...real,
        getRange: async <T,>(c: string, f: string, from: number, to: number) => {
          const rows = await real.getRange<T>(c, f, from, to)
          if (!slipped && c === 'stockMovements') {
            slipped = true
            await receiveStock({ lines: [flourLine(3)], toLocationId: WH, date: COUNT_DAY, actor: ACTOR })
            await receiveStock({ lines: [{ productId: 'salt', productName: 'SALT', unit: 'KG', qty: 1 }], toLocationId: WH, date: LATER, actor: ACTOR })
          }
          return rows
        },
      }
    })
    try {
      await postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count', approveBig: true })
    } finally {
      spy.mockRestore()
    }
    expect(slipped).toBe(true)
    // Books on the count day were 13 after the late-keyed delivery: counted 8 → −5, once.
    expect(adjustments().map((m) => [m.productId, m.qty])).toEqual([['flour', 5]])
    expect(level('flour')).toBe(13) // 8 counted + 5 dated after the count day
    expect(level('salt')).toBe(5) // 4 counted, unchanged, + 1 dated after
  })

  test('a sheet already posted is not posted again', async () => {
    seedSheet(8)
    await postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count', approveBig: true })
    await expect(postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count', approveBig: true })).rejects.toThrow()
    expect(adjustments()).toHaveLength(1)
  })
})

describe('plan E2: a big difference waits for a manager to approve it', () => {
  test('refused without approval, nothing filed; filed and signed with it', async () => {
    seedSheet(8) // 10 on the books → −2 is 20%: big
    await expect(postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count' })).rejects.toThrow()
    expect(adjustments()).toHaveLength(0)
    await postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count', approveBig: true })
    expect(adjustments()).toHaveLength(1)
  })

  test('small differences need no approval', async () => {
    seedSheet(10, 4) // flour matches the books, salt matches: nothing big
    await postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'count' })
    expect((raw('monthlyCounts')[0] as { status: string }).status).toBe('posted')
  })

  test('the opening count sets the books and needs no approval', async () => {
    seedSheet(8)
    await postMonthlyCount({ id: `${WH}__2026-09`, actor: ACTOR, note: 'opening', reason: 'opening' })
    expect(adjustments()).toHaveLength(1)
  })
})
