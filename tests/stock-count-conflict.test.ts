import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveCollection, setActiveBrand, type BrandId } from '../src/brand/brand'
import { COL, type MonthlyCount } from '../src/types'
import { raw, resetMemory, seed } from './helpers/memory-backend'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const {
  adjustStockLines,
  receiveStock,
  issueStock,
  captureFilingScope,
  StockLevelConflictError,
  postCountAsOf,
} = await import('../src/services/stock')
const { postMonthlyCount } = await import('../src/services/monthlyCounts')

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'
const OTHER = 'loc-other'

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seed('products', [
    { id: 'p1', sku: 'A-1', name: 'Bacon', category: 'Meat', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'p2', sku: 'A-2', name: 'Mozzarella', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'p3', sku: 'A-3', name: 'Tomato', category: 'Sauce', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  ])
  seed('locations', [
    { id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 },
    { id: OTHER, name: 'Other Branch', type: 'branch', active: true, createdAt: 1 },
  ])
  // Initial stock: p1 = 10, p2 = 20, p3 = 30 at MAIN
  seed('stockLevels', [
    { id: `${MAIN}__p1`, locationId: MAIN, productId: 'p1', qty: 10, updatedAt: 1 },
    { id: `${MAIN}__p2`, locationId: MAIN, productId: 'p2', qty: 20, updatedAt: 1 },
    { id: `${MAIN}__p3`, locationId: MAIN, productId: 'p3', qty: 30, updatedAt: 1 },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

function getLevel(locationId: string, productId: string, unit?: string): number {
  const id = unit ? `${locationId}__${productId}#${unit}` : `${locationId}__${productId}`
  const doc = raw('stockLevels').find((d) => d.id === id)
  return (doc?.qty as number) ?? 0
}

describe('Stock count stale-level conflict (P0 C-02)', () => {
  test('two devices counting the same item (second save conflicts after first commits)', async () => {
    // Both Device A and Device B see p1 at 10 KG.
    const devAExpected = 10
    const devBExpected = 10

    // Device A counts 12 KG -> delta +2
    const docA = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: { id: 'devA', name: 'Device A' },
      lines: [
        { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: devAExpected },
      ],
    })
    expect(docA).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1')).toBe(12)

    // Device B counts 15 KG -> delta +5 based on expectedLevel 10
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: { id: 'devB', name: 'Device B' },
        lines: [
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 5, reason: 'count', expectedLevel: devBExpected },
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // Verify error payload
    try {
      await adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: { id: 'devB', name: 'Device B' },
        lines: [
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 5, reason: 'count', expectedLevel: devBExpected },
        ],
      })
    } catch (e) {
      expect(e).toBeInstanceOf(StockLevelConflictError)
      const err = e as InstanceType<typeof StockLevelConflictError>
      expect(err.conflicts).toEqual([
        {
          productId: 'p1',
          productName: 'Bacon',
          locationId: MAIN,
          unit: 'KG',
          expected: 10,
          actual: 12,
        },
      ])
    }

    // Atomic abort: stock level remains 12 from Device A, no writes for Device B
    expect(getLevel(MAIN, 'p1')).toBe(12)
    const adjMovements = raw('stockMovements').filter((m) => m.productId === 'p1')
    expect(adjMovements).toHaveLength(1)
    expect(adjMovements[0].docNo).toBe(docA)
  })

  test('a receipt filed between figure capture and save', async () => {
    // Counter sees p1 at 10 KG
    const expected = 10

    // Receive 5 KG before counter saves
    await receiveStock({
      toLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', qty: 5 }],
    })
    expect(getLevel(MAIN, 'p1')).toBe(15)

    // Counter attempts save based on 10
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 2, reason: 'count', expectedLevel: expected },
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    expect(getLevel(MAIN, 'p1')).toBe(15)
  })

  test('a transfer out of the location between capture and save', async () => {
    // Counter sees p2 at 20 KG
    const expected = 20

    // Issue 7 KG to another location
    await issueStock({
      fromLocationId: MAIN,
      toLocationId: OTHER,
      date: Date.now(),
      actor: ACTOR,
      lines: [{ productId: 'p2', productName: 'Mozzarella', unit: 'KG', qty: 7 }],
    })
    expect(getLevel(MAIN, 'p2')).toBe(13)

    // Counter attempts save based on 20
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          { productId: 'p2', productName: 'Mozzarella', unit: 'KG', direction: 'in', qty: 1, reason: 'count', expectedLevel: expected },
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    expect(getLevel(MAIN, 'p2')).toBe(13)
  })

  test('an adjustment between capture and save', async () => {
    // Counter sees p3 at 30 KG
    const expected = 30

    // Spoilage adjustment filed
    await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [
        { productId: 'p3', productName: 'Tomato', unit: 'KG', direction: 'out', qty: 3, reason: 'damage' },
      ],
    })
    expect(getLevel(MAIN, 'p3')).toBe(27)

    // Counter attempts save
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          { productId: 'p3', productName: 'Tomato', unit: 'KG', direction: 'out', qty: 5, reason: 'count', expectedLevel: expected },
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    expect(getLevel(MAIN, 'p3')).toBe(27)
  })

  test('brand switch while waiting (pinned scope still files/rejects in original brand)', async () => {
    // Setup lelapin brand with products and stock
    const brands: BrandId[] = ['pizza', 'lelapin']
    for (const b of brands) {
      seed(resolveCollection(COL.products, b), [
        { id: 'p1', sku: 'A-1', name: `${b}-Bacon`, category: 'Meat', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
      ])
      seed(resolveCollection(COL.locations, b), [
        { id: MAIN, name: `${b}-Main`, type: 'warehouse', active: true, createdAt: 1 },
      ])
      seed(resolveCollection(COL.stockLevels, b), [
        { id: `${MAIN}__p1`, locationId: MAIN, productId: 'p1', qty: 10, updatedAt: 1 },
      ])
    }

    setActiveBrand('pizza')
    const scope = captureFilingScope()

    // Someone updates pizza stock behind the scenes
    seed(resolveCollection(COL.stockLevels, 'pizza'), [
      { id: `${MAIN}__p1`, locationId: MAIN, productId: 'p1', qty: 18, updatedAt: 2 },
    ])

    // Switch active brand to lelapin
    setActiveBrand('lelapin')

    // Submit with pizza's pinned scope and expectedLevel 10
    await expect(
      adjustStockLines({
        scope,
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: 10 },
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // lelapin stock must be untouched at 10
    const lelapinLevel = raw(resolveCollection(COL.stockLevels, 'lelapin')).find((d) => d.id === `${MAIN}__p1`)
    expect(lelapinLevel?.qty).toBe(10)
    // pizza stock remains 18
    const pizzaLevel = raw(resolveCollection(COL.stockLevels, 'pizza')).find((d) => d.id === `${MAIN}__p1`)
    expect(pizzaLevel?.qty).toBe(18)
  })

  test('retry/replay: after conflict, a save with refreshed expectedLevel succeeds exactly once', async () => {
    // Device A commits adjustment 10 -> 14 (+4)
    await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: { id: 'devA', name: 'Dev A' },
      lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 4, reason: 'count', expectedLevel: 10 }],
    })
    expect(getLevel(MAIN, 'p1')).toBe(14)

    // Device B had target 16, originally thought level was 10 (delta +6)
    // First attempt conflicts
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: { id: 'devB', name: 'Dev B' },
        lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 6, reason: 'count', expectedLevel: 10 }],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // Device B refreshes: new level is 14, target remains 16 -> new delta is +2, expectedLevel 14
    const docB = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: { id: 'devB', name: 'Dev B' },
      lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: 14 }],
    })
    expect(docB).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1')).toBe(16)

    // Exactly 2 adjustments in ledger
    const movements = raw('stockMovements').filter((m) => m.productId === 'p1')
    expect(movements).toHaveLength(2)
  })

  test('duplicate Save clicks (one movement)', async () => {
    // If the exact same submission is sent twice with expectedLevel: 10
    // First one succeeds and updates level to 12
    const doc1 = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: 10 }],
    })
    expect(doc1).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1')).toBe(12)

    // Duplicate call with the same expectedLevel: 10 conflicts immediately
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: 10 }],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // Level unchanged, only 1 movement
    expect(getLevel(MAIN, 'p1')).toBe(12)
    expect(raw('stockMovements').filter((m) => m.productId === 'p1')).toHaveLength(1)
  })

  test('backdated count (expectedLevel = current level term, asOf delta unchanged when nothing moved)', async () => {
    // Current level is 10.
    // Backdated count 5 days ago: expectedLevel is the current level (10)
    const docNo = await adjustStockLines({
      locationId: MAIN,
      date: Date.now() - 5 * 86400000,
      actor: ACTOR,
      lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: 10 }],
    })
    expect(docNo).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1')).toBe(12)

    // If current level changes to 15, backdated save with expectedLevel 12 conflicts
    seed('stockLevels', [{ id: `${MAIN}__p1`, locationId: MAIN, productId: 'p1', qty: 15, updatedAt: Date.now() }])
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now() - 5 * 86400000,
        actor: ACTOR,
        lines: [{ productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 2, reason: 'count', expectedLevel: 12 }],
      }),
    ).rejects.toThrow(StockLevelConflictError)
  })

  test('mixed units: legacy #unit level compared against its own doc only', async () => {
    // Seed a legacy unit level
    seed('stockLevels', [
      { id: `${MAIN}__p1`, locationId: MAIN, productId: 'p1', qty: 10, updatedAt: 1 },
      { id: `${MAIN}__p1#pack`, locationId: MAIN, productId: 'p1', qty: 4, unit: 'pack', updatedAt: 1 },
    ])

    // Adjusting legacy unit row checks against #pack doc
    await expect(
      adjustStockLines({
        locationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        lines: [
          {
            productId: 'p1',
            productName: 'Bacon',
            unit: 'KG',
            entryUnit: 'pack',
            direction: 'in',
            qty: 2,
            reason: 'count',
            expectedLevel: 5, // Expected 5, but actual is 4
          },
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // With matching expectedLevel 4, succeeds
    const docNo = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [
        {
          productId: 'p1',
          productName: 'Bacon',
          unit: 'KG',
          entryUnit: 'pack',
          direction: 'in',
          qty: 2,
          reason: 'count',
          expectedLevel: 4,
        },
      ],
    })
    expect(docNo).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1', 'pack')).toBe(6)
    // Base unit untouched
    expect(getLevel(MAIN, 'p1')).toBe(10)
  })

  test('delta-mode rows never conflict', async () => {
    // Level is 10. Staff keys relative adjustment +3 (damage/found, not a count)
    // expectedLevel is omitted (undefined)
    const docNo = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [
        { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'in', qty: 3, reason: 'found' },
      ],
    })
    expect(docNo).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1')).toBe(13)
  })

  test('no expectedLevel provided -> behaviour unchanged (backward compatible)', async () => {
    // Legacy caller without expectedLevel
    const docNo = await adjustStockLines({
      locationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
      lines: [
        { productId: 'p1', productName: 'Bacon', unit: 'KG', direction: 'out', qty: 4, reason: 'count' },
      ],
    })
    expect(docNo).toMatch(/^ADJ-/)
    expect(getLevel(MAIN, 'p1')).toBe(6)
  })

  test('postCountAsOf checks expectedLevel when provided', async () => {
    // postCountAsOf with expectedLevel
    await expect(
      postCountAsOf({
        productId: 'p1',
        productName: 'Bacon',
        unit: 'KG',
        locationId: MAIN,
        countedQty: 15,
        asOfQty: 10,
        actor: ACTOR,
        date: Date.now(),
        expectedLevel: 99, // Current is 10
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // With matching expectedLevel 10
    const wrote = await postCountAsOf({
      productId: 'p1',
      productName: 'Bacon',
      unit: 'KG',
      locationId: MAIN,
      countedQty: 15,
      asOfQty: 10,
      actor: ACTOR,
      date: Date.now(),
      expectedLevel: 10,
    })
    expect(wrote).toBe(true)
    expect(getLevel(MAIN, 'p1')).toBe(15)
  })

  test('postMonthlyCount multipart: conflict in part k leaves parts < k committed and part k untouched', async () => {
    const sheetId = 'sheet-monthly-1'
    seed('monthlyCounts', [
      {
        id: sheetId,
        locationId: MAIN,
        month: '2026-09',
        countDate: Date.UTC(2026, 8, 30),
        status: 'counting',
        lines: {},
        createdBy: ACTOR.id,
        createdByName: ACTOR.name,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    // Current levels: p1 = 10, p2 = 20
    // Part 0: p1 diff +2 (expected 10)
    // Part 1: p2 diff +5 (expected 99 -> conflict!)
    await expect(
      postMonthlyCount({
        id: sheetId,
        actor: ACTOR,
        note: 'monthly count',
        results: {},
        parts: [
          [{ productId: 'p1', productName: 'Bacon', unit: 'KG', diff: 2, expectedLevel: 10 }],
          [{ productId: 'p2', productName: 'Mozzarella', unit: 'KG', diff: 5, expectedLevel: 99 }],
        ],
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // Part 0 committed!
    expect(getLevel(MAIN, 'p1')).toBe(12)
    // Part 1 untouched!
    expect(getLevel(MAIN, 'p2')).toBe(20)

    // Sheet reflects part 0 committed in postedIds
    const sheet = raw('monthlyCounts').find((s) => s.id === sheetId) as unknown as MonthlyCount
    expect(sheet.postedIds).toContain('p1')
    expect(sheet.postedIds).not.toContain('p2')
    expect(sheet.status).toBe('posting')

    // Re-confirm resumes and finishes sheet with refreshed expectedLevel 20 for p2
    const docNos = await postMonthlyCount({
      id: sheetId,
      actor: ACTOR,
      note: 'monthly count resume',
      results: {},
      parts: [
        [{ productId: 'p1', productName: 'Bacon', unit: 'KG', diff: 2, expectedLevel: 10 }],
        [{ productId: 'p2', productName: 'Mozzarella', unit: 'KG', diff: 5, expectedLevel: 20 }],
      ],
    })
    expect(docNos).toHaveLength(1) // Only part 1 filed
    expect(getLevel(MAIN, 'p2')).toBe(25)
    const finalSheet = raw('monthlyCounts').find((s) => s.id === sheetId) as unknown as MonthlyCount
    expect(finalSheet.status).toBe('posted')
    expect(finalSheet.postedIds).toEqual(expect.arrayContaining(['p1', 'p2']))
  })
})
