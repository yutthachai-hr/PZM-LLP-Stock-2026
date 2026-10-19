import { describe, expect, test, beforeEach } from 'vitest'
import {
  dateInputToMs,
  dayRange,
  formatDateFor,
  formatThaiDate,
  formatThaiDateShort,
  formatThaiDateTime,
  msToDateInput,
  setDateLanguage,
  startOfDay,
  startOfDayMs,
  endOfDay,
} from '../src/lib/format'
import { bkkDayStart, bkkDayEnd, DAY_MS, BKK_OFFSET_MS } from '../src/lib/inventoryRules/time'

describe('history-date-contract: Bangkok fixed UTC+7 date contract', () => {
  beforeEach(() => {
    setDateLanguage('th')
  })

  // Fixed Bangkok anchors for 2026-10-08
  // 2026-10-08 00:00:00 Bangkok = 2026-10-07 17:00:00 UTC = 1791421200000
  const BKK_2026_10_08_START = Date.UTC(2026, 9, 8) - BKK_OFFSET_MS
  const BKK_2026_10_08_END = BKK_2026_10_08_START + DAY_MS - 1
  const BKK_2026_10_09_START = BKK_2026_10_08_START + DAY_MS

  test('exact Bangkok millisecond boundaries for 2026-10-08 and 2026-10-09', () => {
    expect(BKK_2026_10_08_START).toBe(1791392400000)
    expect(BKK_2026_10_08_END).toBe(1791478799999)
    expect(BKK_2026_10_09_START).toBe(1791478800000)

    expect(bkkDayStart(BKK_2026_10_08_START)).toBe(BKK_2026_10_08_START)
    expect(bkkDayStart(BKK_2026_10_08_END)).toBe(BKK_2026_10_08_START)
    expect(bkkDayEnd(BKK_2026_10_08_START)).toBe(BKK_2026_10_08_END)
    expect(bkkDayStart(BKK_2026_10_09_START)).toBe(BKK_2026_10_09_START)
  })

  describe('display formatting with Thai Buddhist year vs English Gregorian', () => {
    test('formatThaiDate formats Bangkok 00:00 and 23:59:59 on the same calendar day', () => {
      setDateLanguage('th')
      expect(formatThaiDate(BKK_2026_10_08_START)).toBe('08/10/2569')
      expect(formatThaiDate(BKK_2026_10_08_END)).toBe('08/10/2569')
      expect(formatThaiDate(BKK_2026_10_09_START)).toBe('09/10/2569')

      setDateLanguage('en')
      expect(formatThaiDate(BKK_2026_10_08_START)).toBe('08/10/2026')
      expect(formatThaiDate(BKK_2026_10_08_END)).toBe('08/10/2026')
      expect(formatThaiDate(BKK_2026_10_09_START)).toBe('09/10/2026')
    })

    test('formatThaiDateShort formats 2-digit years in Buddhist and Gregorian', () => {
      setDateLanguage('th')
      expect(formatThaiDateShort(BKK_2026_10_08_START)).toBe('08/10/69')
      expect(formatThaiDateShort(BKK_2026_10_08_END)).toBe('08/10/69')

      setDateLanguage('en')
      expect(formatThaiDateShort(BKK_2026_10_08_START)).toBe('08/10/26')
      expect(formatThaiDateShort(BKK_2026_10_08_END)).toBe('08/10/26')
    })

    test('formatThaiDateTime formats exact Bangkok hours and minutes', () => {
      setDateLanguage('th')
      expect(formatThaiDateTime(BKK_2026_10_08_START)).toBe('08/10/2569 00:00')
      expect(formatThaiDateTime(BKK_2026_10_08_END)).toBe('08/10/2569 23:59')

      setDateLanguage('en')
      expect(formatThaiDateTime(BKK_2026_10_08_START)).toBe('08/10/2026 00:00')
      expect(formatThaiDateTime(BKK_2026_10_08_END)).toBe('08/10/2026 23:59')
    })

    test('formatDateFor respects language argument explicitly', () => {
      expect(formatDateFor(BKK_2026_10_08_START, 'th')).toBe('08/10/2569')
      expect(formatDateFor(BKK_2026_10_08_START, 'en')).toBe('08/10/2026')
      expect(formatDateFor(BKK_2026_10_08_END, 'th')).toBe('08/10/2569')
      expect(formatDateFor(BKK_2026_10_08_END, 'en')).toBe('08/10/2026')
    })
  })

  describe('date input parsing and round-tripping', () => {
    test('dateInputToMs resolves to exact Bangkok midnight', () => {
      expect(dateInputToMs('2026-10-08')).toBe(BKK_2026_10_08_START)
      expect(dateInputToMs('2026-10-09')).toBe(BKK_2026_10_09_START)
    })

    test('msToDateInput formats timestamp to Bangkok YYYY-MM-DD input string', () => {
      expect(msToDateInput(BKK_2026_10_08_START)).toBe('2026-10-08')
      expect(msToDateInput(BKK_2026_10_08_END)).toBe('2026-10-08')
      expect(msToDateInput(BKK_2026_10_09_START)).toBe('2026-10-09')
    })

    test('startOfDay, endOfDay, and startOfDayMs align with Bangkok day boundaries', () => {
      expect(startOfDay(BKK_2026_10_08_END)).toBe(BKK_2026_10_08_START)
      expect(startOfDayMs(BKK_2026_10_08_END)).toBe(BKK_2026_10_08_START)
      expect(endOfDay(BKK_2026_10_08_START)).toBe(BKK_2026_10_08_END)
    })
  })

  describe('dayRange semantics: half-open, open ends, invalid calendar dates, reversed ranges', () => {
    test('covers single day whole range [from, to)', () => {
      const { from, to } = dayRange('2026-10-08', '2026-10-08')
      expect(from).toBe(BKK_2026_10_08_START)
      expect(to).toBe(BKK_2026_10_09_START)
    })

    test('empty end date keeps range open-ended to Infinity', () => {
      const { from, to } = dayRange('2026-10-08', '')
      expect(from).toBe(BKK_2026_10_08_START)
      expect(to).toBe(Infinity)
    })

    test('empty start date keeps range open-ended from -Infinity', () => {
      const { from, to } = dayRange('', '2026-10-08')
      expect(from).toBe(-Infinity)
      expect(to).toBe(BKK_2026_10_09_START)
    })

    test('both empty yields (-Infinity, Infinity)', () => {
      const { from, to } = dayRange('', '')
      expect(from).toBe(-Infinity)
      expect(to).toBe(Infinity)
    })

    test('invalid calendar date (Feb 31) fails closed and does not normalize into March', () => {
      const ms = dateInputToMs('2026-02-31')
      expect(Number.isNaN(ms)).toBe(true)

      const range = dayRange('2026-02-31', '2026-10-08')
      expect(Number.isNaN(range.from) || range.from > range.to).toBe(true)
    })

    test('reversed adjacent days are invalid, not a successful empty range', () => {
      expect(dayRange('2026-10-09', '2026-10-08').valid).toBe(false)
    })

    test('reversed date range fails closed', () => {
      const range = dayRange('2026-10-10', '2026-10-08')
      // Fail closed: either NaN or from > to so no movement can match
      expect(Number.isNaN(range.from) || range.from > range.to).toBe(true)
    })
  })
})
