// The monthly closing-stock import: reading the sheet, deciding what to post, posting it.
//
//   npm test
//
// The sheet is the company's own working file, edited by hand every month. These tests are
// mostly about what the importer must REFUSE to do with it, because every one of those
// refusals is a number that would otherwise land in the ledger looking correct.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { parseSnapshotDate, parseStockWorkbook } from '../src/lib/stockSheet'
import type { ParsedSheet } from '../src/lib/stockSheet'
import type { Product, StockLocation } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const { buildImportPlan, applyImportPlan, loadExistingCounts } = await import(
  '../src/services/importStock',
)
const { setActiveBrand } = await import('../src/brand/brand')
const { setStockCount } = await import('../src/services/stock')

const ACTOR = { id: 'uid-admin', name: 'Admin' }
const MAIN = 'loc-main'
const BRANCH = 'loc-branch'

const PRODUCTS: Product[] = [
  prod('p1', 'VGT-01-01-001', 'SWISS BROWN MUSHROOMS', 'KG'),
  prod('p2', 'VGT-01-02-017', 'CAPSICUM GREEN', 'KG'),
  prod('p3', 'MES-01-01-002', 'ANCHOVIES 720GR', 'EA'),
  { ...prod('p4', 'CHS-01-04-001', 'CHEDDAR LOAF', 'KG'), active: false },
]

const LOCATIONS: StockLocation[] = [
  { id: MAIN, name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 },
  { id: BRANCH, name: 'สาขาสารสิน', type: 'branch', active: true, createdAt: 1 },
]

function prod(id: string, sku: string, name: string, unitType: string): Product {
  return {
    id,
    sku,
    name,
    category: 'Vegetable',
    unit: unitType,
    unitType,
    minStock: 0,
    hasImage: false,
    active: true,
    createdAt: 1,
    updatedAt: 1,
  }
}

/**
 * The shape the real file has: two header rows above a Unit/Quantity label row, then a
 * (quantity, unit) pair per location per counting date.
 */
function workbook(rows: (string | number | null)[][], sheetName = 'PZM'): ArrayBuffer {
  const aoa: (string | number | null)[][] = [
    ['Pizza Mania Co.,Ltd.', null, null, 'SKV.23', null, 'SRS.', null, 'SKV.23', null, 'SRS.', null],
    [
      'Inventory',
      null,
      null,
      'Closing Stock. July.26',
      null,
      'Closing Stock. July.26',
      null,
      'Closing Stock. Aug.26',
      null,
      'Closing Stock. Aug.26',
      null,
    ],
    ['Raw Material - Sukhumvit 23', null, null, null, null, null, null, null, null, null, null],
    [
      'Vegetable',
      null,
      'Unit',
      'Quantity',
      'Unit',
      'Quantity',
      'Unit',
      'Quantity',
      'Unit',
      'Quantity',
      'Unit',
    ],
    ...rows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return buf
}

/** Map every column of a parsed sheet onto a location, both counting dates included. */
function mapAll(sheet: ParsedSheet, byHeader: Record<string, string | null>) {
  return {
    sheetName: sheet.name,
    snapshots: sheet.snapshots.map((s) => ({
      label: s.label,
      date: s.date ?? 0,
      include: true,
      columns: s.columns.map((c) => ({ ...c, locationId: byHeader[c.header] ?? null })),
    })),
  }
}

const HEADERS = { 'SKV.23': MAIN, 'SRS.': BRANCH }

// ---------------------------------------------------------------- the sheet

describe('reading the sheet', () => {
  test('finds the quantity columns by their labels, not by position', () => {
    const { sheets, errors } = parseStockWorkbook(
      workbook([['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', 1, 'box', 3, 'KG', null, null]]),
    )
    expect(errors).toEqual([])
    expect(sheets).toHaveLength(1)
    const [s] = sheets
    expect(s.snapshots.map((x) => x.label)).toEqual([
      'Closing Stock. July.26',
      'Closing Stock. Aug.26',
    ])
    expect(s.snapshots[0].columns.map((c) => c.header)).toEqual(['SKV.23', 'SRS.'])
    // Column C is the pack size, not a location: it is a 'Unit' with no 'Quantity' before it.
    expect(s.snapshots[0].columns.map((c) => c.qtyCol)).toEqual([3, 5])
    expect(s.rows[0].packSize).toBe('1/KG')
    expect(s.rows[0].hasSku).toBe(true)
  })

  test('reads the counting date out of the heading', () => {
    const jul = parseSnapshotDate('Closing Stock. July.26')
    const aug10 = parseSnapshotDate('Closing Stock. 10.Aug.26')
    const aug = parseSnapshotDate('Closing Stock. Aug.26')
    // No day on the heading means a closing balance: the last day of that month.
    expect(new Date(jul!).toDateString()).toBe('Fri Jul 31 2026')
    expect(new Date(aug10!).toDateString()).toBe('Mon Aug 10 2026')
    expect(new Date(aug!).toDateString()).toBe('Mon Aug 31 2026')
    expect(parseSnapshotDate('Grand Total')).toBeNull()
  })

  test('reports a sheet that is not a stock sheet instead of throwing the file away', () => {
    const ws = XLSX.utils.aoa_to_sheet([['just', 'some', 'notes']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Notes')
    const good = XLSX.read(workbook([['VGT-01-01-001', 'X', '1/KG', 1, 'KG', null, null, null, null, null, null]]), {
      type: 'array',
    })
    XLSX.utils.book_append_sheet(wb, good.Sheets['PZM'], 'PZM')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const { sheets, errors } = parseStockWorkbook(buf)
    expect(errors).toHaveLength(1)
    expect(sheets.map((s) => s.name)).toEqual(['PZM'])
  })

  test('keeps section headings out of the rows but keeps rows with a name and no code', () => {
    const { sheets } = parseStockWorkbook(
      workbook([
        ['Meat & seafood - Sukhumvit 23', null, null, null, null, null, null, null, null, null, null],
        ['MES-01-01-002', 'ANCHOVIES 720GR', 'EA', 11, 'EA', null, null, null, null, null, null],
        [null, 'Pizza Dough 12"', null, 5, 'EA', null, null, null, null, null, null],
      ]),
    )
    const rows = sheets[0].rows
    // The heading has no name in column B, so it is not a row at all.
    expect(rows.map((r) => r.name)).toEqual(['ANCHOVIES 720GR', 'Pizza Dough 12"'])
    expect(rows.map((r) => r.hasSku)).toEqual([true, false])
  })
})

// ---------------------------------------------------------------- the plan

describe('deciding what to post', () => {
  function planFor(rows: (string | number | null)[][]) {
    const { sheets } = parseStockWorkbook(workbook(rows))
    const sheet = sheets[0]
    return buildImportPlan(sheet, mapAll(sheet, HEADERS), PRODUCTS, LOCATIONS)
  }

  test('a blank cell is not a count of zero', () => {
    const plan = planFor([
      // Counted at SKV, not counted at SRS, counted as zero at SKV in August.
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', null, null, 0, 'KG', null, null],
    ])
    expect(plan.postings).toHaveLength(2)
    expect(plan.postings.map((p) => [p.locationId, p.targetQty])).toEqual([
      [MAIN, 8],
      [MAIN, 0],
    ])
    // Nothing was said about the branch, so nothing is posted there.
    expect(plan.postings.some((p) => p.locationId === BRANCH)).toBe(false)
  })

  test('an unknown code is reported, never created', () => {
    const plan = planFor([
      ['PP-01-07-001', 'PLASTIC BAG 9X18', 'PACK', 12, 'PACK', null, null, null, null, null, null],
    ])
    expect(plan.postings).toEqual([])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]).toMatchObject({
      reason: 'unknownSku',
      code: 'PP-01-07-001',
      name: 'PLASTIC BAG 9X18',
      droppedCells: 1,
    })
  })

  test('a row with no code at all is reported once, not once per column', () => {
    const plan = planFor([
      [null, 'Pomodoro Sauce 74', null, 3, 'KG', 2, 'KG', 1, 'KG', null, null],
    ])
    expect(plan.postings).toEqual([])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0].reason).toBe('noSku')
    expect(plan.skipped[0].droppedCells).toBe(3)
  })

  test('a retired product is not quietly resurrected', () => {
    const plan = planFor([
      ['CHS-01-04-001', 'CHEDDAR LOAF', '1/KG', 4, 'KG', null, null, null, null, null, null],
    ])
    expect(plan.postings).toEqual([])
    expect(plan.skipped[0].reason).toBe('inactive')
  })

  test('the same product counted twice at one place on one date posts neither', () => {
    const plan = planFor([
      ['VGT-01-02-017', 'CAPSICUM GREEN', '1/KG', 15, 'KG', null, null, null, null, null, null],
      ['VGT-01-02-017', 'CAPSICUM GREEN (WIP)', '1/KG', 4.5, 'KG', null, null, null, null, null, null],
    ])
    // Summing would double the stock; keeping one would lose the other. The file does not
    // say which, so the owner is asked.
    expect(plan.postings).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['duplicate', 'duplicate'])
    expect(plan.skipped[1].detail).toContain('15')
    expect(plan.skipped[1].detail).toContain('4.5')
  })

  test('the same product at two different locations is not a duplicate', () => {
    const plan = planFor([
      ['VGT-01-02-017', 'CAPSICUM GREEN', '1/KG', 15, 'KG', 4, 'KG', null, null, null, null],
    ])
    expect(plan.postings).toHaveLength(2)
    expect(plan.skipped).toEqual([])
  })

  test('a negative quantity is refused', () => {
    const plan = planFor([
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', -2, 'KG', null, null, null, null, null, null],
    ])
    expect(plan.postings).toEqual([])
    expect(plan.skipped[0].reason).toBe('negative')
  })

  test('the unit comes from the catalog, and a disagreement is reported', () => {
    const plan = planFor([
      // The sheet says this mushroom was counted in boxes; the catalog says kilograms.
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 3, 'box', null, null, null, null, null, null],
    ])
    expect(plan.postings[0].unit).toBe('KG')
    expect(plan.postings[0].sheetUnit).toBe('box')
    expect(plan.unitWarnings).toEqual([
      {
        sku: 'VGT-01-01-001',
        productName: 'SWISS BROWN MUSHROOMS',
        sheetUnit: 'box',
        productUnit: 'KG',
      },
    ])
  })

  test('a column left unmapped contributes nothing', () => {
    const { sheets } = parseStockWorkbook(
      workbook([
        ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', 5, 'KG', null, null, null, null],
      ]),
    )
    const sheet = sheets[0]
    const plan = buildImportPlan(
      sheet,
      mapAll(sheet, { 'SKV.23': MAIN, 'SRS.': null }),
      PRODUCTS,
      LOCATIONS,
    )
    expect(plan.postings).toHaveLength(1)
    expect(plan.postings[0].locationId).toBe(MAIN)
    // An unmapped column is a choice, not a problem: it is not reported as skipped data.
    expect(plan.skipped).toEqual([])
  })

  test('postings come out in the order the counts happened', () => {
    const { sheets } = parseStockWorkbook(
      workbook([
        ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', null, null, 3, 'KG', null, null],
      ]),
    )
    const sheet = sheets[0]
    // Deliberately hand the snapshots over newest-first.
    const mapping = mapAll(sheet, HEADERS)
    mapping.snapshots.reverse()
    const plan = buildImportPlan(sheet, mapping, PRODUCTS, LOCATIONS)
    expect(plan.postings.map((p) => p.targetQty)).toEqual([8, 3])
    expect(plan.postings[0].date).toBeLessThan(plan.postings[1].date)
  })
})

// ---------------------------------------------------------------- applying it

describe('posting the counts', () => {
  beforeEach(() => {
    resetMemory()
    setActiveBrand('pizza')
    seed('products', PRODUCTS as unknown as Record<string, unknown>[])
    seed('locations', LOCATIONS as unknown as Record<string, unknown>[])
  })

  function planFor(rows: (string | number | null)[][], existing?: ReadonlySet<string>) {
    const { sheets } = parseStockWorkbook(workbook(rows))
    const sheet = sheets[0]
    return buildImportPlan(sheet, mapAll(sheet, HEADERS), PRODUCTS, LOCATIONS, existing)
  }

  function movementsFor(productId: string) {
    return (raw('stockMovements') as Record<string, unknown>[])
      .filter((m) => m.productId === productId)
      .sort((a, b) => (a.date as number) - (b.date as number))
  }

  test('three counts of one item become three dated movements with the right deltas', async () => {
    const plan = planFor([
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', null, null, 3, 'KG', null, null],
    ])
    const result = await applyImportPlan(plan, ACTOR, 'นำเข้าจากไฟล์')
    expect(result).toMatchObject({ posted: 2, unchanged: 0, failed: [] })

    const mv = movementsFor('p1')
    expect(mv).toHaveLength(2)
    // 0 -> 8 is 8 in; 8 -> 3 is 5 out. The balance is a delta from what the previous count
    // left, which is why the order they are posted in matters.
    expect(mv.map((m) => [m.qty, m.toLocationId ? 'in' : 'out'])).toEqual([
      [8, 'in'],
      [5, 'out'],
    ])
    expect(mv.every((m) => m.reason === 'opening')).toBe(true)
    expect(new Date(mv[0].date as number).toDateString()).toBe('Fri Jul 31 2026')
    expect(new Date(mv[1].date as number).toDateString()).toBe('Mon Aug 31 2026')
    // The balance ends where the last count says.
    const level = (raw('stockLevels') as Record<string, unknown>[]).find(
      (l) => l.id === `${MAIN}__p1`,
    )
    expect(level?.qty).toBe(3)
  })

  test('importing the same file twice records nothing the second time', async () => {
    const rows: (string | number | null)[][] = [
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', 2, 'KG', 3, 'KG', null, null],
      ['MES-01-01-002', 'ANCHOVIES 720GR', 'EA', 11, 'EA', null, null, null, null, null, null],
    ]
    const firstPlan = planFor(rows)
    const first = await applyImportPlan(firstPlan, ACTOR, 'นำเข้าจากไฟล์')
    expect(first.posted).toBe(4)
    const countAfterFirst = (raw('stockMovements') as unknown[]).length

    // The second run must not replay July against the balance August already moved. Left to
    // itself that writes a correction down and a correction back up: the closing balance
    // still looks right and the stock card has two movements that never happened.
    const second = await planFor(rows, await loadExistingCounts())
    expect(second.postings).toEqual([])
    expect(second.alreadyCounted).toHaveLength(4)

    const result = await applyImportPlan(second, ACTOR, 'นำเข้าจากไฟล์')
    expect(result).toMatchObject({ posted: 0, unchanged: 0, failed: [] })
    expect((raw('stockMovements') as unknown[]).length).toBe(countAfterFirst)
  })

  test('a count of zero is posted and empties the balance', async () => {
    await setStockCount({
      productId: 'p1',
      productName: 'SWISS BROWN MUSHROOMS',
      unit: 'KG',
      locationId: MAIN,
      targetQty: 6,
      actor: ACTOR,
    })
    const plan = planFor([
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 0, 'KG', null, null, null, null, null, null],
    ])
    await applyImportPlan(plan, ACTOR, 'นำเข้าจากไฟล์')
    const level = (raw('stockLevels') as Record<string, unknown>[]).find(
      (l) => l.id === `${MAIN}__p1`,
    )
    expect(level?.qty).toBe(0)
  })

  test('one bad posting does not throw away the counts that worked', async () => {
    const plan = planFor([
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', null, null, null, null, null, null],
      ['MES-01-01-002', 'ANCHOVIES 720GR', 'EA', 11, 'EA', null, null, null, null, null, null],
    ])
    // A product deleted between the preview and the apply — the transaction refuses it.
    // seed() upserts, so the store has to be rebuilt without it.
    resetMemory()
    setActiveBrand('pizza')
    seed('products', PRODUCTS.filter((p) => p.id !== 'p3') as unknown as Record<string, unknown>[])
    seed('locations', LOCATIONS as unknown as Record<string, unknown>[])

    const result = await applyImportPlan(plan, ACTOR, 'นำเข้าจากไฟล์')
    expect(result.posted).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].posting.sku).toBe('MES-01-01-002')
    expect(movementsFor('p1')).toHaveLength(1)
  })

  test('progress is reported for every posting', async () => {
    const plan = planFor([
      ['VGT-01-01-001', 'SWISS BROWN MUSHROOMS', '1/KG', 8, 'KG', 2, 'KG', null, null, null, null],
    ])
    const seenProgress: number[] = []
    await applyImportPlan(plan, ACTOR, 'นำเข้าจากไฟล์', (done, total) => {
      expect(total).toBe(2)
      seenProgress.push(done)
    })
    expect(seenProgress).toEqual([1, 2])
  })
})
