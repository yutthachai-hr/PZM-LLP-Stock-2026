import { describe, expect, test } from 'vitest'
import {
  MOVEMENTS_CEILING,
  acceptRewind,
  mayUseFigures,
  rewindFailed,
  rewindLoaded,
  rewindLoading,
  rewindRange,
  rewindTicket,
} from '../src/lib/monthlyHistory'
import { mergeReportMovements } from '../src/lib/reportHistory'
import type { StockMovement } from '../src/types'

const CUT = 1_000_000

function makeMv(id: string, date: number, over: Partial<StockMovement> = {}): StockMovement {
  return {
    id,
    docNo: `DOC-${id}`,
    type: 'receive',
    productId: 'p1',
    productName: 'Paris Ham',
    unit: 'KG',
    qty: 10,
    date,
    byUserId: 'u1',
    byUserName: 'User 1',
    createdAt: date,
    ...over,
  }
}

describe('Adjust Page Backdated Rewind Integrity (F-04)', () => {
  test('uses open-ended rewind range without arbitrary 400-day limit', () => {
    const range = rewindRange(CUT)
    expect(range.from).toBe(CUT)
    expect(range.to).toBe(MOVEMENTS_CEILING)
    expect(range.to).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('gating: while rewind is loading or failed, figures are withheld', () => {
    const ticket = rewindTicket('pizza', CUT, 0)
    expect(mayUseFigures(true, { status: 'idle' }, ticket)).toBe(false)
    expect(mayUseFigures(true, rewindLoading(CUT, ticket), ticket)).toBe(false)
    expect(mayUseFigures(true, rewindFailed(CUT, ticket, 'network error'), ticket)).toBe(false)
    expect(mayUseFigures(true, rewindLoaded(CUT, ticket, []), ticket)).toBe(true)
  })

  test('submit revalidation: fresh server void is not overwritten by stale unvoided live movement', () => {
    const fresh = [
      makeMv('mv-1', CUT + 100, { qty: 25, voided: true, updatedAt: 500 }),
    ]
    const staleLive = [
      makeMv('mv-1', CUT + 100, { qty: 25, voided: false, updatedAt: 100 }),
    ]

    const merged = mergeReportMovements(fresh, staleLive)
    expect(merged[0].voided).toBe(true)
    expect(merged[0].updatedAt).toBe(500)
  })

  test('brand ticket isolation: response for different brand is rejected by acceptRewind', () => {
    const pizzaTicket = rewindTicket('pizza', CUT, 0)
    const lelapinTicket = rewindTicket('lelapin', CUT, 0)
    const current = rewindLoading(CUT, pizzaTicket)
    const lelapinAnswer = rewindLoaded(CUT, lelapinTicket, [makeMv('m-lelapin', CUT + 50)])

    expect(acceptRewind(current, lelapinAnswer)).toBe(current)
  })
})
