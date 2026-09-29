// WIP item codes run by themselves (owner, 30 Sep 2026): "ถ้าเกิดอนาคตมี WIP ตัวใหม่
// เลขต้องรันเองอัตโนมัติต่อทันที".
//
//   npm test

import { describe, expect, test } from 'vitest'
import { isWipCategory, nextWipCode, wipCode, wipSeq } from '../src/lib/wipCode'

describe('WIP codes', () => {
  test('three digits, one series per brand', () => {
    expect(wipCode(1, 'PZM')).toBe('WIP-001')
    expect(wipCode(25, 'LLP')).toBe('WIP-LL-025')
    expect(wipCode(1000, 'PZM')).toBe('WIP-1000')
  })

  test('a code is read back only within its own series', () => {
    expect(wipSeq('WIP-024', 'PZM')).toBe(24)
    expect(wipSeq(' wip-ll-005 ', 'LLP')).toBe(5)
    expect(wipSeq('WIP-LL-005', 'PZM')).toBeNull()
    expect(wipSeq('WIP-01-01-001', 'PZM')).toBeNull()
    expect(wipSeq('VGT-01-14-004', 'PZM')).toBeNull()
  })

  test('the next code follows the highest one held, whatever order they are in', () => {
    const held = [{ sku: 'WIP-002' }, { sku: 'WIP-024' }, { sku: 'VGT-01-14-004' }, { sku: 'WIP-LL-009' }]
    expect(nextWipCode(held, 'PZM')).toBe('WIP-025')
    expect(nextWipCode(held, 'LLP')).toBe('WIP-LL-010')
  })

  test('the first WIP item of an empty catalogue is 001', () => {
    expect(nextWipCode([], 'PZM')).toBe('WIP-001')
  })

  test('a gap is never refilled: numbers only go up', () => {
    expect(nextWipCode([{ sku: 'WIP-001' }, { sku: 'WIP-005' }], 'PZM')).toBe('WIP-006')
  })

  test('the WIP category however it was typed', () => {
    expect(isWipCategory('WIP')).toBe(true)
    expect(isWipCategory(' wip ')).toBe(true)
    expect(isWipCategory('Cheese')).toBe(false)
    expect(isWipCategory(undefined)).toBe(false)
  })
})
