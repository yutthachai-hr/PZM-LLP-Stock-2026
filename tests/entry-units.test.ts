// Which units a quantity may be keyed in, and what actually reaches the ledger.
//
//   npm test
//
// Three reports from the floor, in order:
//
//  1. Creating a product lets you pick EA, but on the receiving screen an EA product had no
//     unit control at all — subUnitsFor() only knew KG and L, and anything else fell back to
//     plain text.
//  2. Once the control was always drawn, it still only listed units whose size could be
//     computed, so Lot / Pack / EA — what is printed on the box in the person's hand — were
//     nowhere.
//  3. Picking EA still filed the row as KG, because the movement was always stamped with the
//     product's own unit. "ระบบต้องรับรู้แค่หน่วยที่ชั้นใส่เข้าไปเท่านั้น ห้ามแปลงค่าเองโดยเด็ดขาด."
//
// So: one conversion survives, grams to kilograms, because the owner kept it explicitly.
// Everything else is a label, recorded exactly as keyed.

import { describe, expect, test } from 'vitest'
import { PLAIN_UNITS, entryUnitsFor, subUnitsFor } from '../src/components/QtyInput'

const labels = (u: ReturnType<typeof entryUnitsFor>) => u.map((x) => x.label)

describe('the unit list is never empty', () => {
  test('a product with no sub-units still offers its own unit first', () => {
    expect(subUnitsFor('EA')).toEqual([])
    expect(entryUnitsFor('EA')[0]).toMatchObject({ label: 'EA', factor: 1, records: 'EA' })
  })

  test('a product with no unit at all still renders something selectable', () => {
    expect(entryUnitsFor('')[0].label).toBe('-')
  })

  test('every unit has a distinct key, because nearly all of them share the factor 1', () => {
    const units = entryUnitsFor('KG', ['Carton'])
    const keys = units.map((u) => u.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(units.filter((u) => u.factor === 1).length).toBeGreaterThan(1)
  })
})

describe('what is printed on the box is always offered', () => {
  test('a kilogram product can still be received by the lot', () => {
    expect(labels(entryUnitsFor('KG'))).toEqual(['KG', 'กรัม (g)', 'Lot', 'Pack', 'EA'])
  })

  test('a product is never offered its own unit twice', () => {
    expect(labels(entryUnitsFor('EA'))).toEqual(['EA', 'Lot', 'Pack'])
    expect(labels(entryUnitsFor('Lot'))).toEqual(['Lot', 'Pack', 'EA'])
    expect(labels(entryUnitsFor('Pack'))).toEqual(['Pack', 'Lot', 'EA'])
  })

  test('the owner can add their own, and they behave the same', () => {
    expect(labels(entryUnitsFor('KG', ['Carton', 'ลัง']))).toEqual([
      'KG',
      'กรัม (g)',
      'Carton',
      'ลัง',
    ])
  })
})

describe('nothing converts except grams and millilitres', () => {
  test('kilograms can be keyed in grams, and the row still says KG', () => {
    const [kg, g] = entryUnitsFor('KG')
    expect(kg).toMatchObject({ factor: 1, records: 'KG' })
    // The one exception the owner kept: "แต่กรัม แปลงได้ 500=0.5".
    expect(g).toMatchObject({ label: 'กรัม (g)', factor: 0.001, records: 'KG' })
  })

  test('litres can be keyed in millilitres, however the unit is spelled', () => {
    for (const spelling of ['L', 'lt', 'Liter', 'ลิตร']) {
      const [base, sub] = entryUnitsFor(spelling)
      expect([base.factor, sub.factor]).toEqual([1, 0.001])
      expect(sub.records).toBe(base.label)
    }
  })

  test('every other unit multiplies by exactly one', () => {
    for (const u of entryUnitsFor('KG', ['Carton']).filter((x) => x.key.startsWith('plain:'))) {
      expect(u.factor).toBe(1)
    }
    expect(PLAIN_UNITS).toEqual(['Lot', 'Pack', 'EA'])
  })

  test('a chosen unit is what the movement is filed under', () => {
    // This is the whole of report 3: picking Carton has to reach the ledger as Carton.
    const carton = entryUnitsFor('KG', ['Carton']).find((u) => u.label === 'Carton')!
    expect(carton.records).toBe('Carton')
    const base = entryUnitsFor('KG')[0]
    expect(base.records).toBe('KG')
  })
})

describe('what reaches the ledger', () => {
  const keyed = (typed: number, factor: number) => Math.round(typed * factor * 1000) / 1000

  test('500 grams becomes half a kilogram', () => {
    expect(keyed(500, entryUnitsFor('KG')[1].factor)).toBe(0.5)
  })

  test('one Lot is one Lot — no size is invented for it', () => {
    const lot = entryUnitsFor('KG').find((u) => u.label === 'Lot')!
    expect(keyed(1, lot.factor)).toBe(1)
    expect(lot.records).toBe('Lot')
  })

  test('ten Pack of a KG product stays ten, under Pack', () => {
    const pack = entryUnitsFor('KG').find((u) => u.label === 'Pack')!
    expect(keyed(10, pack.factor)).toBe(10)
    expect(pack.records).toBe('Pack')
  })
})
