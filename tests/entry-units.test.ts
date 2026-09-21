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
// And the fourth, 20 Sep 2026, which reversed report 3: with "1 Carton = 500 EA" on the
// product, keying 1 Carton must move 500 EA on the one balance. So now every unit carries
// its rate for the product — grams and millilitres from the standard table, everything
// else from the product's own list — or `null` when nobody has stated one, in which case
// choosing it asks for the rate. The unit keyed is still recorded (`records`), beside the
// converted quantity.

import { describe, expect, test, vi } from 'vitest'
import type { WheelEvent } from 'react'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { PLAIN_UNITS, entryUnitsFor, subUnitsFor } = await import('../src/components/QtyInput')
import { blurOnWheel } from '../src/components/ui'
import { normaliseConversions } from '../src/lib/units'

const labels = (u: ReturnType<typeof entryUnitsFor>) => u.map((x) => x.label)

describe('the unit list is never empty', () => {
  test('a product with no sub-units still offers its own unit first', () => {
    expect(subUnitsFor('EA')).toEqual([])
    expect(entryUnitsFor('EA')[0]).toMatchObject({ label: 'EA', factor: 1, records: 'EA' })
  })

  test('a product with no unit at all still renders something selectable', () => {
    expect(entryUnitsFor('')[0].label).toBe('-')
  })

  test('every unit has a distinct key, because several may share a rate', () => {
    const units = entryUnitsFor('KG', ['Carton', 'Pack'], [{ label: 'Carton', size: 10 }, { label: 'Pack', size: 10 }])
    const keys = units.map((u) => u.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(units.filter((u) => u.factor === 10).length).toBe(2)
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

describe('the standard measures: grams and millilitres', () => {
  test('kilograms can be keyed in grams; the row records g and converts to KG', () => {
    const [kg, g] = entryUnitsFor('KG')
    expect(kg).toMatchObject({ factor: 1, records: 'KG' })
    // "แต่กรัม แปลงได้ 500=0.5".
    expect(g).toMatchObject({ label: 'กรัม (g)', factor: 0.001, records: 'g' })
  })

  test('litres can be keyed in millilitres, however the unit is spelled', () => {
    for (const spelling of ['L', 'lt', 'Liter', 'ลิตร']) {
      const [base, sub] = entryUnitsFor(spelling)
      expect([base.factor, sub.factor]).toEqual([1, 0.001])
      expect(sub.records).toBe('ml')
    }
  })

  test('a unit with no rate for the product is offered with none, and the owner\'s list is unchanged', () => {
    for (const u of entryUnitsFor('KG', ['Carton']).filter((x) => x.key.startsWith('plain:'))) {
      expect(u.factor).toBeNull()
    }
    expect(PLAIN_UNITS).toEqual(['Lot', 'Pack', 'EA'])
  })

  test('the unit keyed is what the movement records as entryUnit', () => {
    const carton = entryUnitsFor('KG', ['Carton'], [{ label: 'Carton', size: 10 }]).find((u) => u.label === 'Carton')!
    expect(carton.records).toBe('Carton')
    const base = entryUnitsFor('KG')[0]
    expect(base.records).toBe('KG')
  })
})

describe('what reaches the ledger', () => {
  const keyed = (typed: number, factor: number | null) => Math.round(typed * (factor ?? NaN) * 1000) / 1000

  test('500 grams becomes half a kilogram', () => {
    expect(keyed(500, entryUnitsFor('KG')[1].factor)).toBe(0.5)
  })

  test('one Carton is what the product says a Carton is', () => {
    const carton = entryUnitsFor('EA', ['Carton'], [{ label: 'Carton', size: 500 }]).find((u) => u.label === 'Carton')!
    expect(keyed(2, carton.factor)).toBe(1000)
    expect(carton.records).toBe('Carton')
  })

  test('a Pack nobody has sized cannot be filed — its rate is null, not one', () => {
    const pack = entryUnitsFor('KG').find((u) => u.label === 'Pack')!
    expect(pack.factor).toBeNull()
  })
})

// The item that started this: ordered by the case, issued by the pack, received by the
// piece. The product's rate is the conversion.
describe('a product\'s own rate converts', () => {
  test('the unit records itself, and its rate is the product\'s size', () => {
    const lang = entryUnitsFor('EA', ['ลัง'], [{ label: 'ลัง', size: 288 }]).find(
      (u) => u.label === 'ลัง',
    )!
    expect(lang.factor).toBe(288)
    expect(lang.records).toBe('ลัง')
  })

  test('a rate makes its own unit selectable, even off the owner\'s shared list', () => {
    // Setting "1 ลัง = 288 EA" on one product would do nothing if ลัง were not offered —
    // and it has no business on the shared list, since a case is a different size on
    // every other product.
    const units = entryUnitsFor('EA', ['Pack'], [{ label: 'ลัง', size: 288 }])
    expect(units.map((u) => u.label)).toContain('ลัง')
    expect(units.find((u) => u.label === 'ลัง')!.factor).toBe(288)
  })

  test('a conversion label cannot duplicate the metric sub-unit row', () => {
    // The metric row (กรัม/มล.) is generated before the owner's list is read, and the
    // dedupe used to only know the product's own unit — a conversion or an owner's unit
    // spelled the same as the metric label would have produced two rows with the same
    // name, one of them silently missing the real ×0.001 that makes grams work at all.
    const units = entryUnitsFor('KG', [], [{ label: 'กรัม (g)', size: 5 }])
    const gramRows = units.filter((u) => u.label === 'กรัม (g)')
    expect(gramRows).toHaveLength(1)
    expect(gramRows[0].factor).toBe(0.001)
    expect(gramRows[0].refSize).toBeUndefined()
  })

  test('a unit with no matching reference carries none', () => {
    const pack = entryUnitsFor('EA', ['ลัง', 'แพ็ค'], [{ label: 'ลัง', size: 288 }]).find(
      (u) => u.label === 'แพ็ค',
    )!
    expect(pack.refSize).toBeUndefined()
  })

  test('the label is matched the same forgiving way the unit list already is', () => {
    // "ลัง " with trailing space, "LANG" any-case — a product edited by hand should not
    // lose its reference over spelling that the rest of the app already treats as the same.
    const units = entryUnitsFor('EA', ['ลัง'], [{ label: ' ลัง ', size: 288 }])
    expect(units.find((u) => u.label === 'ลัง')!.factor).toBe(288)
  })

  test('the base unit and the metric sub-units never carry one', () => {
    // A reference multiplier only makes sense for a unit whose size is not already known —
    // it would be nonsense on the base unit itself, or on grams, which already convert for
    // real.
    const units = entryUnitsFor('KG', [], [{ label: 'KG', size: 5 }, { label: 'กรัม (g)', size: 5 }])
    expect(units.every((u) => u.refSize === undefined)).toBe(true)
  })
})

describe('normaliseConversions', () => {
  test('trims labels, drops non-positive sizes, and bounds the length', () => {
    const raw = [
      { label: '  ลัง  ', size: 288 },
      { label: 'ศูนย์', size: 0 },
      { label: 'ติดลบ', size: -5 },
      { label: '   ', size: 10 },
    ]
    expect(normaliseConversions(raw)).toEqual([{ label: 'ลัง', size: 288 }])
  })

  test('a repeated label keeps the first one, the same rule the owner\'s own unit list uses', () => {
    const raw = [
      { label: 'Case', size: 288 },
      { label: 'case', size: 24 },
    ]
    expect(normaliseConversions(raw)).toEqual([{ label: 'Case', size: 288 }])
  })

  test('a list longer than the cap is cut, not refused', () => {
    const raw = Array.from({ length: 25 }, (_, i) => ({ label: `u${i}`, size: 1 }))
    expect(normaliseConversions(raw)).toHaveLength(20)
  })
})

describe('the mouse wheel cannot edit a quantity', () => {
  // Reported from the floor: someone keyed a quantity, scrolled the page to reach the save
  // button, and the number changed under them. A browser treats a scroll over a focused
  // number field as a nudge to its value, and nothing about that is visible afterwards.
  test('a number field is blurred, which hands the scroll back to the page', () => {
    let blurred = false
    blurOnWheel({
      currentTarget: { type: 'number', blur: () => (blurred = true) },
    } as unknown as WheelEvent<HTMLInputElement>)
    expect(blurred).toBe(true)
  })

  test('other fields are left alone — scrolling past a text box is not an edit', () => {
    let blurred = false
    blurOnWheel({
      currentTarget: { type: 'text', blur: () => (blurred = true) },
    } as unknown as WheelEvent<HTMLInputElement>)
    expect(blurred).toBe(false)
  })
})
