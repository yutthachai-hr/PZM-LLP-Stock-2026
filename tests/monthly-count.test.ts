// The monthly count's arithmetic (owner, 29 Sep 2026): counted first, compared with the
// books at the month's last day, confirmed later.
//
//   npm test

import { describe, expect, test } from 'vitest'
import {
  countDayOf,
  countRows,
  isBig,
  monthBefore,
  monthOf,
  monthlyCountId,
  POST_CHUNK,
  postingPlan,
  previousMonth,
  resultsOf,
} from '../src/lib/monthlyCount'
import type { MonthlyCountLine } from '../src/types'

const line = (qty: number): MonthlyCountLine => ({ qty, by: 'u', byName: 'U', at: 0 })

describe('months', () => {
  test('the month of a Bangkok day, including just after midnight on the 1st', () => {
    expect(monthOf(Date.UTC(2026, 8, 30, 16, 30))).toBe('2026-09') // 23:30 on 30 Sep
    expect(monthOf(Date.UTC(2026, 8, 30, 17, 30))).toBe('2026-10') // 00:30 on 1 Oct
  })

  test('a month is filed on its last day', () => {
    expect(monthOf(countDayOf('2026-08'))).toBe('2026-08')
    expect(new Date(countDayOf('2026-08') + 7 * 3_600_000).getUTCDate()).toBe(31)
    expect(new Date(countDayOf('2026-02') + 7 * 3_600_000).getUTCDate()).toBe(28)
    expect(new Date(countDayOf('2026-12') + 7 * 3_600_000).getUTCDate()).toBe(31)
  })

  test('previous month, across the new year', () => {
    expect(previousMonth(Date.UTC(2026, 9, 1, 3))).toBe('2026-09')
    expect(previousMonth(Date.UTC(2027, 0, 2, 3))).toBe('2026-12')
    expect(monthBefore('2027-01')).toBe('2026-12')
    expect(monthlyCountId('main', '2026-09')).toBe('main__2026-09')
  })
})

describe('countRows', () => {
  const system: Record<string, number> = { mozz: 120, flour: 35, tomato: 48 }
  const cost: Record<string, number> = { mozz: 230, flour: 40, tomato: 80 }
  const { rows, summary } = countRows({
    productIds: ['mozz', 'flour', 'tomato'],
    lines: { mozz: line(110), tomato: line(50) },
    systemQty: (id) => system[id] ?? 0,
    cost: (id) => cost[id] ?? 0,
    last: { mozz: { systemQty: 100, countedQty: 98, diff: -2, value: -460 } },
  })
  const by = Object.fromEntries(rows.map((r) => [r.productId, r]))

  test('a counted row: difference, value, and last month beside it', () => {
    expect(by.mozz).toMatchObject({ systemQty: 120, countedQty: 110, diff: -10, value: -2300, big: true, lastDiff: -2 })
    expect(by.tomato).toMatchObject({ diff: 2, value: 160, big: false })
  })

  test('an uncounted row is left alone, never read as zero', () => {
    expect(by.flour).toMatchObject({ countedQty: null, diff: null, value: null, big: false })
  })

  test('the summary', () => {
    expect(summary).toEqual({ total: 3, counted: 2, withDiff: 2, big: 1, shortValue: -2300, overValue: 160 })
  })

  test('the snapshot holds counted rows only', () => {
    expect(Object.keys(resultsOf(rows)).sort()).toEqual(['mozz', 'tomato'])
  })
})

describe('isBig', () => {
  test('10% of the books, or ฿500 either way; anything against an empty book', () => {
    expect(isBig(100, -9, -90)).toBe(false)
    expect(isBig(100, -10, -100)).toBe(true)
    expect(isBig(1000, -3, -600)).toBe(true)
    expect(isBig(0, 2, 10)).toBe(true)
    expect(isBig(50, 0, 0)).toBe(false)
  })
})

describe('postingPlan', () => {
  test('only differences not yet filed, in parts a transaction can hold', () => {
    const rows = Array.from({ length: POST_CHUNK + 5 }, (_, i) => ({
      productId: `p${i}`,
      systemQty: 1,
      countedQty: 2,
      diff: 1,
      value: 1,
      big: false,
    }))
    rows.push({ productId: 'same', systemQty: 1, countedQty: 1, diff: 0, value: 0, big: false })
    const parts = postingPlan(rows, ['p0'])
    expect(parts.map((p) => p.length)).toEqual([POST_CHUNK, 4])
    expect(parts.flat().some((r) => r.productId === 'p0' || r.productId === 'same')).toBe(false)
  })
})
