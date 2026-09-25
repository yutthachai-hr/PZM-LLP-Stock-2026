// A count keyed after the day it was taken.
//
//   npm test
//
// The owner counts on the morning of the 1st and treats that as the closing balance of the
// month before. When the count is keyed weeks later, the month's receipts and issues are
// already on the books, so the count can only be compared with what the shelf held at the
// end of that day — never with the balance now.

import { describe, expect, test } from 'vitest'
import { balanceAtDayEnd, balanceBefore } from '../src/lib/ledger'
import type { StockMovement } from '../src/types'

const MAIN = 'loc-main'
const BRANCH = 'loc-branch'
const DAY = 86_400_000
// 1 Sep 2026, 00:00 Bangkok — the first instant after the 31 Aug count.
const SEP_1 = Date.UTC(2026, 8, 1) - 7 * 3_600_000

let seq = 0
function mv(p: Partial<StockMovement> & Pick<StockMovement, 'date' | 'qty'>): StockMovement {
  seq++
  return {
    id: `m${seq}`,
    docNo: `D-${seq}`,
    type: 'receive',
    productId: 'p1',
    productName: 'MOZZARELLA',
    unit: 'EA',
    byUserId: 'u',
    byUserName: 'U',
    createdAt: seq,
    ...p,
  }
}

// The example in the manual: 120 at the end of August, then September's +200 +30 −150.
const ledger: StockMovement[] = [
  mv({ date: SEP_1 - 20 * DAY, qty: 120, toLocationId: MAIN }),
  mv({ date: SEP_1 + 2 * DAY, qty: 200, toLocationId: MAIN }),
  mv({ date: SEP_1 + 5 * DAY, qty: 30, toLocationId: MAIN }),
  mv({ type: 'issue', date: SEP_1 + 9 * DAY, qty: 150, fromLocationId: MAIN }),
]
const scope = { productId: 'p1', locationId: MAIN }

describe('the balance at the end of a day', () => {
  test('forward from history: everything filed before the next day starts', () => {
    expect(balanceBefore(ledger, scope, SEP_1)).toBe(120)
    expect(balanceBefore(ledger, scope, SEP_1 + 30 * DAY)).toBe(200)
  })

  test('backward from now: today minus everything filed after that day', () => {
    const later = ledger.filter((m) => m.date >= SEP_1)
    expect(balanceAtDayEnd(200, later, scope, SEP_1)).toBe(120)
  })

  test('the two agree, so a count compared with either posts the same difference', () => {
    const now = balanceBefore(ledger, scope, Number.MAX_SAFE_INTEGER)
    expect(balanceAtDayEnd(now, ledger, scope, SEP_1)).toBe(balanceBefore(ledger, scope, SEP_1))
  })

  test('a voided row moved nothing, before or after', () => {
    const rows = [...ledger, mv({ date: SEP_1 + DAY, qty: 999, toLocationId: MAIN, voided: true })]
    expect(balanceBefore(rows, scope, SEP_1 + 30 * DAY)).toBe(200)
    expect(balanceAtDayEnd(200, rows, scope, SEP_1)).toBe(120)
  })

  test('a transfer counts at both ends, and other products and places are ignored', () => {
    const rows = [
      ...ledger,
      mv({ type: 'issue', date: SEP_1 + DAY, qty: 40, fromLocationId: MAIN, toLocationId: BRANCH }),
      mv({ date: SEP_1 + DAY, qty: 7, toLocationId: MAIN, productId: 'p2' }),
      mv({ date: SEP_1 + DAY, qty: 7, toLocationId: BRANCH }),
    ]
    expect(balanceAtDayEnd(160, rows, scope, SEP_1)).toBe(120)
    expect(balanceAtDayEnd(47, rows, { productId: 'p1', locationId: BRANCH }, SEP_1)).toBe(0)
  })

  test('a legacy row in another unit sits on its own balance, not the product one', () => {
    // Keyed as "3 Pack" before 20 Sep 2026 with no conversion: it moved the #Pack row.
    const rows = [...ledger, mv({ date: SEP_1 + DAY, qty: 3, entryUnit: 'Pack', toLocationId: MAIN })]
    expect(balanceBefore(rows, scope, SEP_1 + 30 * DAY)).toBe(200)
    expect(balanceAtDayEnd(200, rows, scope, SEP_1)).toBe(120)
  })
})
