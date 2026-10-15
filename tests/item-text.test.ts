// Product lists typed or pasted into the import window (Owner, 15 Oct 2026):
// "แป้งพิซซ่า 5 ถุง, มอสซาเรลล่า 3 กก., กล่องพิซซ่า 18 นิ้ว 2 แพ็ค".
// The reader only splits and reads numbers. Matching, units and confirmation stay in
// lib/importReview, so nothing typed here can be filed without a person.

import { describe, expect, test } from 'vitest'
import { readItemText } from '../src/lib/itemText'

const read = (s: string) => readItemText(s).lines

describe('splitting a list', () => {
  test("the Owner's example is three lines, with the size kept in the box's name", () => {
    expect(read('แป้งพิซซ่า 5 ถุง, มอสซาเรลล่า 3 กก., กล่องพิซซ่า 18 นิ้ว 2 แพ็ค')).toEqual([
      { name: 'แป้งพิซซ่า', qty: 5, unit: 'ถุง' },
      { name: 'มอสซาเรลล่า', qty: 3, unit: 'KG' },
      { name: 'กล่องพิซซ่า 18 นิ้ว', qty: 2, unit: 'Pack' },
    ])
  })

  test('one item per line, pasted from a chat, blank lines ignored', () => {
    expect(read('MOZZARELLA 2 kg\n\n  PENNE 500G 3 pack  \r\nRANCH 1')).toEqual([
      { name: 'MOZZARELLA', qty: 2, unit: 'KG' },
      { name: 'PENNE 500G', qty: 3, unit: 'Pack' },
      { name: 'RANCH', qty: 1 },
    ])
  })

  test('semicolons and "และ" also separate items', () => {
    expect(read('ชีส 2 กก; ซอส 3 ขวด และ แป้ง 1 ถุง').map((l) => l.name)).toEqual(['ชีส', 'ซอส', 'แป้ง'])
  })
})

describe('reading the quantity', () => {
  test('a count before the name', () => {
    expect(read('2 x mozzarella')).toEqual([{ name: 'mozzarella', qty: 2 }])
    expect(read('5 ถุง แป้งพิซซ่า')).toEqual([{ name: 'แป้งพิซซ่า', qty: 5, unit: 'ถุง' }])
  })

  test('a count after the name with x', () => {
    expect(read('mozzarella x2')).toEqual([{ name: 'mozzarella', qty: 2 }])
  })

  test('a unit with a trailing dot is read as the unit', () => {
    expect(read('นมสด 2 มล.')).toEqual([{ name: 'นมสด', qty: 2, unit: 'มล' }])
  })

  test('decimals and mixed Thai and English', () => {
    expect(read('ชีส MOZZARELLA 2.5 kg')).toEqual([{ name: 'ชีส MOZZARELLA', qty: 2.5, unit: 'KG' }])
  })

  test('no quantity is left unknown, never guessed', () => {
    const [line] = read('มอสซาเรลล่า')
    expect(line.name).toBe('มอสซาเรลล่า')
    expect(Number.isNaN(line.qty)).toBe(true)
  })

  test('a size glued to its unit is part of the name, not the quantity', () => {
    const [line] = read('PENNE 500G')
    expect(line.name).toBe('PENNE 500G')
    expect(Number.isNaN(line.qty)).toBe(true)
  })

  test('Thai digits are read as numbers', () => {
    expect(read('แป้ง ๕ ถุง')).toEqual([{ name: 'แป้ง', qty: 5, unit: 'ถุง' }])
  })

  test('"ตาม" is not a quantity', () => {
    expect(Number.isNaN(read('PEPPERONI ตาม')[0].qty)).toBe(true)
  })

  test('single tokens do not invent quantity or split into name: 12345, 10, 7UP, 15/10/2026, 17:00', () => {
    for (const token of ['12345', '10', '7UP', '15/10/2026', '17:00']) {
      const [l] = read(token)
      expect(l.name).toBe(token)
      expect(Number.isNaN(l.qty)).toBe(true)
    }
    const pair = readItemText('15/10/2026, 17:00').lines
    expect(pair.map((l) => [l.name, Number.isNaN(l.qty)])).toEqual([
      ['15/10/2026', true],
      ['17:00', true],
    ])
  })

  test('numeric SKU or barcode with explicit quantity or multiplier', () => {
    expect(read('12345 2')).toEqual([{ name: '12345', qty: 2 }])
    expect(read('12345 2 pack')).toEqual([{ name: '12345', qty: 2, unit: 'Pack' }])
    expect(read('2 x 12345')).toEqual([{ name: '12345', qty: 2 }])
    expect(read('12345 x2')).toEqual([{ name: '12345', qty: 2 }])
  })

  test('valid leading counts with name or unit preserved', () => {
    expect(read('3 mozzarella')).toEqual([{ name: 'mozzarella', qty: 3 }])
    expect(read('5 ถุง แป้งพิซซ่า')).toEqual([{ name: 'แป้งพิซซ่า', qty: 5, unit: 'ถุง' }])
    expect(read('2 x mozzarella')).toEqual([{ name: 'mozzarella', qty: 2 }])
  })
})

describe('instructions are kept, never read as items', () => {
  test('a prohibition is a constraint, not a product line', () => {
    const r = readItemText('แป้งพิซซ่า 5 ถุง, ยังไม่ต้องส่งผู้ขาย')
    expect(r.lines).toEqual([{ name: 'แป้งพิซซ่า', qty: 5, unit: 'ถุง' }])
    expect(r.constraints).toEqual(['ยังไม่ต้องส่งผู้ขาย'])
  })

  test('Thai quality words and samples with "อย่าง" are products, not prohibitions', () => {
    const quality = readItemText('แป้งพิซซ่าอย่างดี 5 ถุง')
    expect(quality.constraints).toEqual([])
    expect(quality.lines).toEqual([{ name: 'แป้งพิซซ่าอย่างดี', qty: 5, unit: 'ถุง' }])

    const sample = readItemText('ตัวอย่าง 2 pack')
    expect(sample.constraints).toEqual([])
    expect(sample.lines).toEqual([{ name: 'ตัวอย่าง', qty: 2, unit: 'Pack' }])

    const each = readItemText('ชีส อย่างละ 2 กก.')
    expect(each.constraints).toEqual([])
    expect(each.lines).toEqual([{ name: 'ชีส อย่างละ', qty: 2, unit: 'KG' }])

    // Real prohibition with "อย่า" is still kept as a constraint
    const prohibit = readItemText('อย่าเพิ่งส่ง 1-2 วันนี้')
    expect(prohibit.lines).toEqual([])
    expect(prohibit.constraints).toEqual(['อย่าเพิ่งส่ง 1-2 วันนี้'])
  })

  test('prohibitions containing digits, dates, times, quantities or SKUs are preserved as constraints, never product lines', () => {
    const items = [
      'ยังไม่ต้องส่งผู้ขาย วันที่ 15',
      'ห้ามส่งก่อน 17:00',
      "don't send before 5pm",
      'ห้ามสั่งเกิน 10 กล่อง',
      'อย่าเพิ่งส่ง 1-2 วันนี้',
      'ห้ามสั่ง SKU-1234 จนกว่าจะแจ้ง',
      'ยังไม่ต้องส่งผู้ขาย วันที่ ๑๕',
    ]
    for (const text of items) {
      const res = readItemText(text)
      expect(res.lines).toEqual([])
      expect(res.constraints.length).toBe(1)
    }

    const mixed = readItemText('แป้งพิซซ่า 5 ถุง, ยังไม่ต้องส่งผู้ขาย วันที่ 15, ห้ามส่งก่อน 17:00, don\'t send before 5pm, ห้ามสั่งเกิน 10 กล่อง, อย่าเพิ่งส่ง 1-2 วันนี้, มอสซาเรลล่า 3 กก.')
    expect(mixed.lines).toEqual([
      { name: 'แป้งพิซซ่า', qty: 5, unit: 'ถุง' },
      { name: 'มอสซาเรลล่า', qty: 3, unit: 'KG' },
    ])
    expect(mixed.constraints).toEqual([
      'ยังไม่ต้องส่งผู้ขาย วันที่ 15',
      'ห้ามส่งก่อน 17:00',
      "don't send before 5pm",
      'ห้ามสั่งเกิน 10 กล่อง',
      'อย่าเพิ่งส่ง 1-2 วันนี้',
    ])
  })

  test('English prohibitions too', () => {
    expect(readItemText("ranch 2\ndon't send to supplier yet").constraints).toEqual(["don't send to supplier yet"])
  })

  test('empty text gives nothing', () => {
    expect(readItemText('  \n , ;  ')).toEqual({ lines: [], constraints: [] })
  })
})
