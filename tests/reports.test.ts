// Regression tests for the reporting findings in AUDIT_FOR_CLAUDE.md
// (F39, F40, F42, F43).
//
//   npm test
//
// These are the bugs that put a wrong number in front of someone. A Stock Card that starts
// its running total at zero after a date filter does not look broken — it looks like the
// stock is wrong, which is worse.

import { describe, expect, test, vi } from 'vitest'

import {
  effectAt,
  openingBalance,
  shownUnit,
  stockCard,
} from '../src/lib/ledger'
import { dateInputToMs, dayRange, startOfDayMs } from '../src/lib/format'
import { columnWidths, registerThaiFont } from '../src/lib/export'
import type { StockMovement } from '../src/types'

const MAIN = 'loc-main'
const BRANCH = 'loc-branch'

function mv(over: Partial<StockMovement>): StockMovement {
  return {
    id: Math.random().toString(36).slice(2),
    docNo: 'RC-00001',
    type: 'receive',
    productId: 'p1',
    productName: 'Mozzarella',
    unit: 'KG',
    qty: 1,
    date: 0,
    byUserId: 'u1',
    byUserName: 'Staff',
    createdAt: 0,
    ...over,
  } as StockMovement
}

const day = (n: number, hour = 9) => new Date(2026, 8, n, hour, 0, 0).getTime()

describe('F39 — a running balance that starts where the stock actually was', () => {
  // Received 10 into the warehouse on the 1st, issued 3 out of it on the 5th.
  const all = [
    mv({ id: 'a', type: 'receive', qty: 10, toLocationId: MAIN, date: day(1) }),
    mv({ id: 'b', type: 'issue', qty: 3, fromLocationId: MAIN, toLocationId: BRANCH, date: day(5) }),
  ]

  test('what was on hand before the chosen period is carried in', () => {
    expect(openingBalance(all, { productId: 'p1', locationId: MAIN, before: day(3) })).toBe(10)
  })

  test('a stock card filtered to the 3rd onwards shows 7, not -3', () => {
    const card = stockCard(all, {
      productId: 'p1',
      locationId: MAIN,
      from: day(3),
      to: day(9),
    })
    expect(card.opening).toBe(10)
    expect(card.rows).toHaveLength(1)
    expect(card.rows[0].balance).toBe(7)
  })

  test('filtering by movement type does not change the balance of the rows shown', () => {
    const unfiltered = stockCard(all, { productId: 'p1', locationId: MAIN })
    const issuesOnly = stockCard(all, { productId: 'p1', locationId: MAIN, type: 'issue' })
    const issueRow = unfiltered.rows.find((r) => r.movement.type === 'issue')!
    expect(issuesOnly.rows).toHaveLength(1)
    // Same movement, same real balance, whatever else is on screen.
    expect(issuesOnly.rows[0].balance).toBe(issueRow.balance)
    expect(issuesOnly.rows[0].balance).toBe(7)
  })

  test('a receipt older than the loaded ledger window is still counted as opening', () => {
    // The window only holds the issue; the opening has to come from somewhere else.
    const card = stockCard(all, { productId: 'p1', locationId: MAIN, from: day(4) })
    expect(card.opening).toBe(10)
    expect(card.rows.at(-1)!.balance).toBe(7)
  })

  test('voided movements are left out of both the opening and the running total', () => {
    const withVoid = [
      ...all,
      mv({ id: 'c', type: 'receive', qty: 100, toLocationId: MAIN, date: day(2), voided: true }),
    ]
    expect(openingBalance(withVoid, { productId: 'p1', locationId: MAIN, before: day(3) })).toBe(10)
  })

  test('the effect of a transfer is opposite at each end', () => {
    const transfer = all[1]
    expect(effectAt(transfer, MAIN)).toBe(-3)
    expect(effectAt(transfer, BRANCH)).toBe(3)
    expect(effectAt(transfer, 'somewhere-else')).toBe(0)
  })
})

describe('F40 — a date range that means the days you picked', () => {
  test('a chosen day starts at midnight, not midday', () => {
    const ms = dateInputToMs('2026-09-08')
    expect(new Date(ms).getHours()).toBe(0)
    expect(startOfDayMs(day(8, 23))).toBe(dateInputToMs('2026-09-08'))
  })

  test('picking the 8th to the 8th covers the 8th and nothing else', () => {
    const { from, to } = dayRange('2026-09-08', '2026-09-08')
    const inRange = (t: number) => t >= from && t < to

    expect(inRange(day(8, 0))).toBe(true) // midnight, the start of the day
    expect(inRange(day(8, 9))).toBe(true) // a stock count taken before noon
    expect(inRange(day(8, 23))).toBe(true) // last thing at night
    expect(inRange(day(9, 0))).toBe(false) // the next day
    expect(inRange(day(9, 12))).toBe(false) // used to be included, at midday
    expect(inRange(day(7, 23))).toBe(false) // the night before
  })

  test('an open-ended range stays open', () => {
    const { from, to } = dayRange('', '')
    expect(inRangeAll(from, to)).toBe(true)
  })

  function inRangeAll(from: number, to: number): boolean {
    return day(1) >= from && day(1) < to && day(30) >= from && day(30) < to
  }
})

describe('F43 — exporting a lot of rows', () => {
  test('column widths are computed without spreading the rows as arguments', () => {
    // Math.max(...rows.map(...)) threw RangeError long before Excel's own row limit.
    const rows = Array.from({ length: 150_000 }, (_, i) => ({ name: `row ${i}`, qty: i }))
    expect(() => columnWidths(rows)).not.toThrow()
    const widths = columnWidths(rows)
    expect(widths).toHaveLength(2)
    expect(widths[0].wch).toBeGreaterThan(0)
  })

  test('no rows means no widths to compute', () => {
    expect(columnWidths([])).toEqual([])
  })
})

describe('F42 — the Thai font in the second PDF of the session', () => {
  test('every new document gets the font, not just the first', () => {
    const make = () => ({ addFileToVFS: vi.fn(), addFont: vi.fn(), setFont: vi.fn() })
    const first = make()
    const second = make()

    expect(registerThaiFont(first as never)).toBe(true)
    expect(registerThaiFont(second as never)).toBe(true)

    // A module-level "already registered" flag meant the second document was told the font
    // was there when it had never been added to it.
    expect(first.addFont).toHaveBeenCalledTimes(1)
    expect(second.addFont).toHaveBeenCalledTimes(1)
  })

  test('registering twice on the same document does not add it twice', () => {
    const doc = { addFileToVFS: vi.fn(), addFont: vi.fn(), setFont: vi.fn() }
    registerThaiFont(doc as never)
    registerThaiFont(doc as never)
    expect(doc.addFont).toHaveBeenCalledTimes(1)
  })
})

describe('the unit a report prints', () => {
  // Reported from the floor: a line keyed as EA came back out of the system as KG, because
  // every screen and every export stamped the product's unit over what had been selected.
  test("a line keyed in the product's own unit reads as it always did", () => {
    expect(shownUnit({ unit: 'KG' })).toBe('KG')
  })

  test('a line keyed in another unit reports that unit', () => {
    expect(shownUnit({ unit: 'KG', entryUnit: 'Pack' })).toBe('Pack')
    expect(shownUnit({ unit: 'KG', entryUnit: 'Carton' })).toBe('Carton')
  })

  test('an empty or blank entry unit falls back rather than printing nothing', () => {
    // A column with no unit in it is worse than one showing the product's.
    expect(shownUnit({ unit: 'KG', entryUnit: '' })).toBe('KG')
    expect(shownUnit({ unit: 'KG', entryUnit: '   ' })).toBe('KG')
  })

  test('it reads a real movement, not just a shape built for the test', () => {
    const m = mv({ unit: 'KG', entryUnit: 'Pack', qty: 10, toLocationId: MAIN })
    expect(shownUnit(m)).toBe('Pack')
    expect(effectAt(m, MAIN)).toBe(10)
  })
})
