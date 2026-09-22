// The Stock Card's trend line: end-of-day balances worked back from the balance now.
import { describe, expect, test } from 'vitest'
import { balanceSeries } from '../src/lib/stats/balanceSeries'
import { bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { StockMovement } from '../src/types'

const today = bkkDayStart(Date.UTC(2026, 8, 22, 5))
let n = 0
function mv(p: Partial<StockMovement>): StockMovement {
  n++
  return { id: `m${n}`, docNo: `D-${n}`, type: 'receive', productId: 'p1', productName: 'X', unit: 'KG', qty: 1, date: today, byUserId: 'u', byUserName: 'U', createdAt: today, ...p }
}

describe('balanceSeries', () => {
  test('walks back from the balance now, one closing per day, oldest first', () => {
    // 10 received 3 days ago, 4 used yesterday, 2 received today → 8 now.
    const rows = [
      mv({ type: 'receive', toLocationId: 'A', qty: 10, date: today - 3 * DAY_MS }),
      mv({ type: 'consume', fromLocationId: 'A', qty: 4, date: today - DAY_MS }),
      mv({ type: 'receive', toLocationId: 'A', qty: 2, date: today }),
    ]
    const s = balanceSeries(rows, { productId: 'p1', current: 8, today, days: 5, locationId: 'A' })
    expect(s.map((p) => p.balance)).toEqual([0, 10, 10, 6, 8])
    expect(s[4].day).toBe(today)
    expect(s[0].day).toBe(today - 4 * DAY_MS)
  })

  test('only this product, not voided rows, not legacy per-unit rows', () => {
    const rows = [
      mv({ toLocationId: 'A', qty: 5, date: today }),
      mv({ toLocationId: 'A', qty: 50, date: today, productId: 'p2' }),
      mv({ toLocationId: 'A', qty: 7, date: today, voided: true }),
      mv({ toLocationId: 'A', qty: 3, date: today, entryUnit: 'Pack' }),
    ]
    const s = balanceSeries(rows, { productId: 'p1', current: 5, today, days: 2, locationId: 'A' })
    expect(s.map((p) => p.balance)).toEqual([0, 5])
  })

  test('with no site chosen a transfer between sites moves nothing', () => {
    const rows = [
      mv({ type: 'issue', fromLocationId: 'A', toLocationId: 'B', qty: 4, date: today }),
      mv({ type: 'consume', fromLocationId: 'B', qty: 1, date: today }),
    ]
    const all = balanceSeries(rows, { productId: 'p1', current: 9, today, days: 2 })
    expect(all.map((p) => p.balance)).toEqual([10, 9])
    const atB = balanceSeries(rows, { productId: 'p1', current: 3, today, days: 2, locationId: 'B' })
    expect(atB.map((p) => p.balance)).toEqual([0, 3])
  })

  test('a row dated after today is taken off before today closes', () => {
    const rows = [mv({ toLocationId: 'A', qty: 4, date: today + DAY_MS })]
    const s = balanceSeries(rows, { productId: 'p1', current: 10, today, days: 1, locationId: 'A' })
    expect(s).toEqual([{ day: today, balance: 6 }])
  })
})
