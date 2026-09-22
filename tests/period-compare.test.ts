// The dashboard's "compared with before" lines — computed from the ledger window only.
import { describe, expect, test } from 'vitest'
import { activityKind, change, covers, dailyActivity, docsOnDay, netEffect, valueAsOf } from '../src/lib/stats/periodCompare'
import { bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { StockMovement } from '../src/types'

const today = bkkDayStart(Date.UTC(2026, 8, 22, 5)) // 22 Sep 2026, Bangkok
let n = 0
function mv(p: Partial<StockMovement>): StockMovement {
  n++
  return {
    id: `m${n}`,
    docNo: `D-${n}`,
    type: 'receive',
    productId: 'p1',
    productName: 'Cheese',
    unit: 'KG',
    qty: 1,
    date: today,
    byUserId: 'u',
    byUserName: 'U',
    createdAt: today,
    ...p,
  }
}

describe('netEffect', () => {
  test('in is plus, out is minus, a transfer inside scope is nothing', () => {
    expect(netEffect(mv({ type: 'receive', toLocationId: 'A', qty: 5 }))).toBe(5)
    expect(netEffect(mv({ type: 'consume', fromLocationId: 'A', qty: 2 }))).toBe(-2)
    expect(netEffect(mv({ type: 'issue', fromLocationId: 'A', toLocationId: 'B', qty: 3 }))).toBe(0)
  })

  test('a transfer counts for the site it leaves or reaches when only that site is in scope', () => {
    const t = mv({ type: 'issue', fromLocationId: 'A', toLocationId: 'B', qty: 3 })
    expect(netEffect(t, new Set(['A']))).toBe(-3)
    expect(netEffect(t, new Set(['B']))).toBe(3)
  })

  test('voided rows and legacy per-unit rows move nothing', () => {
    expect(netEffect(mv({ toLocationId: 'A', qty: 5, voided: true }))).toBe(0)
    expect(netEffect(mv({ toLocationId: 'A', qty: 5, entryUnit: 'Pack' }))).toBe(0)
    expect(netEffect(mv({ toLocationId: 'A', qty: 50, entryUnit: 'Pack', entryQty: 2 }))).toBe(50)
  })
})

test('activityKind sorts the ledger into the chart bars', () => {
  expect(activityKind(mv({ type: 'receive' }))).toBe('in')
  expect(activityKind(mv({ type: 'consume' }))).toBe('out')
  expect(activityKind(mv({ type: 'issue', fromLocationId: 'A' }))).toBe('out')
  expect(activityKind(mv({ type: 'issue', fromLocationId: 'A', toLocationId: 'B' }))).toBe('transfer')
  expect(activityKind(mv({ type: 'adjust' }))).toBe('adjust')
})

test('docsOnDay counts documents, not lines, and skips voided ones', () => {
  const rows = [
    mv({ docNo: 'RC-1' }),
    mv({ docNo: 'RC-1' }),
    mv({ docNo: 'RC-2' }),
    mv({ docNo: 'RC-3', voided: true }),
    mv({ docNo: 'RC-4', date: today - DAY_MS }),
  ]
  expect(docsOnDay(rows, today, (m) => m.type === 'receive')).toBe(2)
  expect(docsOnDay(rows, today - DAY_MS, (m) => m.type === 'receive')).toBe(1)
})

test('dailyActivity gives one row per day, oldest first, today last', () => {
  const rows = dailyActivity(
    [mv({ type: 'receive' }), mv({ type: 'consume', date: today - 2 * DAY_MS }), mv({ type: 'receive', date: today - 30 * DAY_MS })],
    today,
    7,
  )
  expect(rows).toHaveLength(7)
  expect(rows[6]).toMatchObject({ day: today, in: 1, out: 0 })
  expect(rows[4]).toMatchObject({ day: today - 2 * DAY_MS, out: 1 })
  expect(rows.reduce((s, r) => s + r.in, 0)).toBe(1)
})

describe('valueAsOf', () => {
  const cost = () => 10
  test('undoes everything dated on or after the day, at current cost', () => {
    const rows = [
      mv({ toLocationId: 'A', qty: 5, date: today }), // +50 today
      mv({ fromLocationId: 'A', type: 'consume', qty: 2, date: today - 3 * DAY_MS }), // −20
      mv({ toLocationId: 'A', qty: 100, date: today - 40 * DAY_MS }), // before the period: untouched
    ]
    expect(valueAsOf(1000, rows, today - 5 * DAY_MS, today - 60 * DAY_MS, cost)).toBe(1000 - 50 + 20)
  })

  test('is null when the ledger window starts after the day asked about', () => {
    expect(valueAsOf(1000, [], today - 30 * DAY_MS, today - 10 * DAY_MS, cost)).toBeNull()
    expect(covers(today - 30 * DAY_MS, today - 30 * DAY_MS + 3_600_000)).toBe(true)
  })
})

describe('change', () => {
  test('a percentage when there was something before', () => {
    expect(change(3, 1)).toEqual({ text: '+200%', up: true, flat: false })
    expect(change(478_320, 454_600).text).toBe('+5.2%')
    expect(change(8, 10)).toEqual({ text: '−20%', up: false, flat: false })
  })

  test('a count, not an infinite percentage, when there was nothing before', () => {
    expect(change(2, 0, { unit: 'รายการ' })).toEqual({ text: '+2 รายการ', up: true, flat: false })
    expect(change(0, 0)).toEqual({ text: '0', up: true, flat: true })
  })
})
