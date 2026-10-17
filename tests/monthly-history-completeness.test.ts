// The monthly count sheet is compared with the books at the end of the month's last day.
// Getting there from today means subtracting every movement dated after that day, so the
// read that supplies them must be exhaustive and must not be mistaken for complete when it
// failed. Two proven defects are locked down here (audit D-2 and D-4):
//
//   * the read stopped at a device-clock horizon of today + 400 days, so a row dated past
//     it was never subtracted — the day-end figure and the posted adjustment were wrong;
//   * a failed read left the sheet "calculating" for the rest of the session, with no way
//     to retry, and nothing blocked the export or the confirmation.
//
//   npx vitest run tests/monthly-history-completeness.test.ts

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

const DAY = 86_400_000
const CUT = Date.UTC(2026, 8, 30) // the count's day-end cut

let seq = 0
function mv(date: number): StockMovement {
  seq++
  return {
    id: `m${seq}`,
    docNo: `D-${seq}`,
    type: 'receive',
    productId: 'p1',
    productName: 'MOZZARELLA',
    unit: 'EA',
    qty: 1,
    date,
    byUserId: 'u',
    byUserName: 'U',
    createdAt: seq,
  }
}

describe('the rewind read covers every later movement (D-2)', () => {
  test('the window has no device-clock horizon', () => {
    const range = rewindRange(CUT)
    expect(range.from).toBe(CUT)
    expect(range.to).toBe(MOVEMENTS_CEILING)
  })

  test('a row dated past the old 400-day horizon is still inside the window', () => {
    const range = rewindRange(CUT)
    const far = CUT + 500 * DAY
    expect(far).toBeGreaterThan(CUT + 400 * DAY)
    expect(far).toBeGreaterThanOrEqual(range.from)
    expect(far).toBeLessThanOrEqual(range.to)
  })
})

describe('an incomplete read is never a complete answer (D-4)', () => {
  const ticket = rewindTicket('pizza', CUT, 0)

  test('idle, loading and error all withhold the figures', () => {
    expect(mayUseFigures(true, { status: 'idle' }, ticket)).toBe(false)
    expect(mayUseFigures(true, rewindLoading(CUT, ticket), ticket)).toBe(false)
    expect(mayUseFigures(true, rewindFailed(CUT, ticket, 'offline'), ticket)).toBe(false)
  })

  test('a successful read settles the figures, even when it found no later movements', () => {
    expect(mayUseFigures(true, rewindLoaded(CUT, ticket, []), ticket)).toBe(true)
    expect(mayUseFigures(true, rewindLoaded(CUT, ticket, [mv(CUT + DAY)]), ticket)).toBe(true)
  })

  test('a sheet that is not backdated needs no rewind at all', () => {
    expect(mayUseFigures(false, { status: 'error' }, ticket)).toBe(true)
  })

  test('a later read answers for a different cut only when its ticket matches', () => {
    const other = rewindTicket('pizza', CUT + DAY, 0)
    expect(mayUseFigures(true, rewindLoaded(CUT + DAY, other, []), ticket)).toBe(false)
  })

  test('a retry gets a new ticket, so the failed attempt cannot settle it', () => {
    const retry = rewindTicket('pizza', CUT, 1)
    expect(retry).not.toBe(ticket)
    expect(mayUseFigures(true, rewindFailed(CUT, retry, 'offline'), ticket)).toBe(false)
  })
})

describe('a late answer never overwrites the request in flight', () => {
  const ticket = rewindTicket('pizza', CUT, 0)
  const stale = rewindTicket('pizza', CUT, 1)

  test('an answer from an older attempt is dropped', () => {
    const current = rewindLoading(CUT, stale)
    const late = rewindLoaded(CUT, ticket, [mv(CUT + DAY)])
    expect(acceptRewind(current, late)).toBe(current)
  })

  test('an answer to the request in flight is published', () => {
    const current = rewindLoading(CUT, ticket)
    const answer = rewindLoaded(CUT, ticket, [mv(CUT + DAY)])
    expect(acceptRewind(current, answer)).toBe(answer)
  })

  test('an answer from another brand is dropped', () => {
    const current = rewindLoading(CUT, ticket)
    const foreign = rewindLoaded(CUT, rewindTicket('lelapin', CUT, 0), [])
    expect(acceptRewind(current, foreign)).toBe(current)
  })

  test('a late failure cannot replace a good answer', () => {
    const current = rewindLoaded(CUT, ticket, [mv(CUT + DAY)])
    expect(acceptRewind(current, rewindFailed(CUT, stale, 'offline'))).toBe(current)
  })
})

describe('fresh server movements and live listener merge (F-01)', () => {
  test('a fresh server void is not clobbered by a stale live-window receipt', () => {
    // Movement was voided on another device; fresh read from server has voided: true at updatedAt = 500
    const fresh = [
      { ...mv(CUT + 100), id: 'mv-1', qty: 25, voided: true, updatedAt: 500 },
    ]
    // Live listener still holds unvoided record at updatedAt = 100
    const staleLive = [
      { ...mv(CUT + 100), id: 'mv-1', qty: 25, voided: false, updatedAt: 100 },
    ]

    const merged = mergeReportMovements(fresh, staleLive)
    expect(merged).toHaveLength(1)
    expect(merged[0].voided).toBe(true)
    expect(merged[0].updatedAt).toBe(500)
  })
})
