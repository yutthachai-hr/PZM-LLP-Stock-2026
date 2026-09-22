// The reports overview's four sentences — each a computed figure, never a guess.
import { expect, test } from 'vitest'
import { insights } from '../src/lib/stats/insights'

const base = { receiptsNow: 0, receiptsBefore: null, issued: [], valueNow: 0, valueBefore: null, lowCount: 0 }

test('receipts compared with the period before, in percent', () => {
  expect(insights({ ...base, receiptsNow: 62, receiptsBefore: 50 })[0]).toEqual({ kind: 'receiptsUp', pct: 24 })
  expect(insights({ ...base, receiptsNow: 38, receiptsBefore: 50 })[0]).toEqual({ kind: 'receiptsDown', pct: 24 })
  expect(insights({ ...base, receiptsNow: 5, receiptsBefore: 5 })[0]).toEqual({ kind: 'receiptsFlat' })
})

test('no receipts sentence when the earlier period is not loaded or was empty', () => {
  expect(insights({ ...base, receiptsNow: 5 }).some((i) => i.kind.startsWith('receipts'))).toBe(false)
  expect(insights({ ...base, receiptsNow: 5, receiptsBefore: 0 }).some((i) => i.kind.startsWith('receipts'))).toBe(false)
})

test('the most-used product and its share of everything used', () => {
  const r = insights({ ...base, issued: [{ name: 'Mozzarella', amount: 18 }, { name: 'Flour', amount: 72 }, { name: 'Ham', amount: 10 }] })
  expect(r.find((i) => i.kind === 'topIssue')).toEqual({ kind: 'topIssue', name: 'Flour', pct: 72 })
  expect(insights(base).some((i) => i.kind === 'topIssue')).toBe(false)
})

test('stock value against the start of the period', () => {
  expect(insights({ ...base, valueNow: 105, valueBefore: 100 }).find((i) => i.kind.startsWith('value'))).toEqual({ kind: 'valueUp', pct: 5 })
  expect(insights({ ...base, valueNow: 90, valueBefore: 100 }).find((i) => i.kind.startsWith('value'))).toEqual({ kind: 'valueDown', pct: 10 })
  expect(insights({ ...base, valueNow: 90, valueBefore: null }).some((i) => i.kind.startsWith('value'))).toBe(false)
})

test('always ends with what needs ordering', () => {
  expect(insights({ ...base, lowCount: 14 }).at(-1)).toEqual({ kind: 'lowStock', count: 14 })
  expect(insights(base).at(-1)).toEqual({ kind: 'allStocked' })
})
