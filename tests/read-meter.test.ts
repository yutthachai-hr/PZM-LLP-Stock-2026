// Counting what the app reads, so a quota that runs out has an answer on screen.
//
//   npm test
//
// The free plan allows 50,000 document reads a day and it has run out three times. Each
// time the cause was worked out by reading code and estimating; this is the tally the
// cloud backend keeps as documents arrive (src/data/readMeter.ts), which Settings shows.

import { beforeEach, describe, expect, test, vi } from 'vitest'

const { noteRead, readTally, resetReadTally, subscribeReadTally } = await import('../src/data/readMeter')

// The tally is module state for the life of the page; wind it back between cases.
beforeEach(resetReadTally)

describe('the read meter', () => {
  test('adds up what each collection delivered', () => {
    noteRead('products', 323)
    noteRead('stockMovements', 470)
    noteRead('products', 2)
    const t = readTally()
    expect(t.byCollection.products).toBe(325)
    expect(t.byCollection.stockMovements).toBe(470)
    expect(t.total).toBe(795)
  })

  test('a snapshot that delivered nothing is not counted', () => {
    noteRead('products', 0)
    expect(readTally().byCollection.products).toBeUndefined()
    expect(readTally().total).toBe(0)
  })

  test('the tally handed out cannot be edited from outside', () => {
    noteRead('products', 10)
    const t = readTally()
    t.byCollection.products = 9999
    expect(readTally().byCollection.products).toBe(10)
  })

  test('the screen is told whenever the figure moves', () => {
    const seen = vi.fn()
    const off = subscribeReadTally(seen)
    noteRead('products', 5)
    noteRead('locations', 3)
    expect(seen).toHaveBeenCalledTimes(2)
    off()
    noteRead('products', 5)
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

// The window a listener asks for has to be the same question every time, or Firestore
// cannot resume it and every page load pays for the whole window again (23 Sep 2026).
describe('the ledger window', () => {
  test('is anchored to midnight, so every open of the day asks the same question', async () => {
    const { windowStart } = await import('../src/data/ledgerWindow')
    const morning = new Date(2026, 8, 23, 8, 14, 3).getTime()
    const evening = new Date(2026, 8, 23, 22, 59, 59).getTime()
    expect(windowStart(7, morning)).toBe(windowStart(7, evening))
    expect(new Date(windowStart(7, morning)).getHours()).toBe(0)
    expect(windowStart(7, morning)).toBeLessThan(morning)
    // A different length is a different window, and tomorrow is a different day.
    expect(windowStart(30, morning)).toBeLessThan(windowStart(7, morning))
    expect(windowStart(7, new Date(2026, 8, 24, 1, 0, 0).getTime())).toBeGreaterThan(windowStart(7, morning))
  })
})

// 23 Sep 2026: cutting the start-up window to a week also emptied the history screen of
// everything older, and the owner went looking for August and found nothing. The screens
// that ARE the history ask for a quarter; the ones people key on still start at a week.
describe('how far back each kind of screen asks for', () => {
  test('a quarter reaches back further than a month, and a month further than the start-up week', async () => {
    const { windowStart } = await import('../src/data/ledgerWindow')
    const { MONTH_DAYS, QUARTER_DAYS } = await import('../src/data/windowDays')
    const now = new Date(2026, 8, 23, 9, 0, 0).getTime()
    const august = new Date(2026, 7, 1, 0, 0, 0).getTime()
    expect(QUARTER_DAYS).toBeGreaterThan(MONTH_DAYS)
    // The owner's August rows are inside a quarter and outside a month.
    expect(windowStart(QUARTER_DAYS, now)).toBeLessThan(august)
    expect(windowStart(MONTH_DAYS, now)).toBeGreaterThan(august)
  })
})
