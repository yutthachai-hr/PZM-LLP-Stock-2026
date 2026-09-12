// Which units a quantity may be keyed in, and what actually reaches the ledger.
//
//   npm test
//
// Reported from the floor: creating a product lets you pick EA, but on the receiving screen
// an EA product had no unit control at all — subUnitsFor() only knew KG and L, and anything
// else fell back to plain text. Then, once the control was always drawn: it still only
// listed units whose size could be computed, so Lot / Pack / EA — what is printed on the box
// in the person's hand — were still nowhere. They are now on every product.
//
// They carry no multiplier. The owner asked for the unit alone, without a size prompt beside
// it, so the number typed against Lot is the number recorded. A real conversion comes from
// ขนาดบรรจุ on the product, which is offered above them with its multiplier showing.

import { describe, expect, test } from 'vitest'
import { PLAIN_UNITS, entryUnitsFor, subUnitsFor } from '../src/components/QtyInput'

const labels = (u: ReturnType<typeof entryUnitsFor>) => u.map((x) => x.label)

describe('the unit list is never empty', () => {
  test('a product with no sub-units still offers its own unit first', () => {
    // The original report: EA produced an empty list, so the screen rendered plain text.
    expect(subUnitsFor('EA')).toEqual([])
    expect(entryUnitsFor('EA')[0]).toMatchObject({ label: 'EA', factor: 1 })
  })

  test('a product with no unit at all still renders something selectable', () => {
    expect(entryUnitsFor('')[0].label).toBe('-')
  })

  test('every unit has a distinct key, because most of them share the factor 1', () => {
    // The factor cannot identify the choice, so the <select> is keyed instead.
    const units = entryUnitsFor('KG', 2, 'ถุง')
    const keys = units.map((u) => u.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(units.filter((u) => u.factor === 1).length).toBeGreaterThan(1)
  })
})

describe('what is printed on the box is always offered', () => {
  test('a kilogram product can still be received by the lot', () => {
    // This list used to stop at grams.
    expect(labels(entryUnitsFor('KG'))).toEqual(['KG', 'กรัม (g)', 'Lot', 'Pack', 'EA'])
  })

  test('they record what was typed, because a lot has no size of its own', () => {
    for (const u of entryUnitsFor('KG').filter((x) => x.key.startsWith('plain:'))) {
      expect(u.factor).toBe(1)
    }
    expect(PLAIN_UNITS).toEqual(['Lot', 'Pack', 'EA'])
  })

  test('a product is never offered its own unit twice', () => {
    expect(labels(entryUnitsFor('EA'))).toEqual(['EA', 'Lot', 'Pack'])
    expect(labels(entryUnitsFor('Lot'))).toEqual(['Lot', 'Pack', 'EA'])
    expect(labels(entryUnitsFor('Pack'))).toEqual(['Pack', 'Lot', 'EA'])
  })

  test('a configured pack replaces the plain one, so only one of them converts', () => {
    // Two entries both called Pack, one multiplying and one not, is a coin toss.
    expect(labels(entryUnitsFor('EA', 300, 'ลัง'))).toEqual(['EA', 'ลัง (×300)', 'Lot'])
    expect(labels(entryUnitsFor('EA', 24, 'Lot'))).toEqual(['EA', 'Lot (×24)'])
  })
})

describe('weight and volume keep their sub-units', () => {
  test('kilograms can be keyed in grams', () => {
    const [kg, g] = entryUnitsFor('KG')
    expect([kg.factor, g.factor]).toEqual([1, 0.001])
    expect(g.label).toBe('กรัม (g)')
  })

  test('litres can be keyed in millilitres, however the unit is spelled', () => {
    for (const spelling of ['L', 'lt', 'Liter', 'ลิตร']) {
      expect(entryUnitsFor(spelling).slice(0, 2).map((u) => u.factor)).toEqual([1, 0.001])
    }
  })
})

describe('packs come from the product, not from a table', () => {
  test('a pack is offered with its own multiplier and name', () => {
    // "1 Pack" is 12 of one thing and 300 of another, so there is no universal factor —
    // it has to be the product's own.
    expect(entryUnitsFor('EA', 300, 'ลัง')[1]).toMatchObject({ label: 'ลัง (×300)', factor: 300 })
  })

  test('an unnamed pack still says what it is', () => {
    expect(entryUnitsFor('EA', 12)[1].label).toBe('Pack (×12)')
  })

  test('a pack of one is not a unit', () => {
    // It would be a second entry for the same number — pick it and nothing changes, which
    // reads as the control being broken.
    expect(entryUnitsFor('EA', 1, 'Pack').some((u) => u.label.includes('×'))).toBe(false)
  })

  test('a missing or nonsense pack size is ignored rather than offered', () => {
    for (const size of [0, -5, undefined]) {
      expect(entryUnitsFor('EA', size, 'Pack').some((u) => u.label.includes('×'))).toBe(false)
    }
  })

  test('a pack sits alongside the sub-unit, not instead of it', () => {
    expect(entryUnitsFor('KG', 2, 'ถุง').map((u) => u.factor)).toEqual([1, 2, 0.001, 1, 1])
  })

  test('the base unit is always first, so the default records what was typed', () => {
    const lists = [entryUnitsFor('EA', 300, 'ลัง'), entryUnitsFor('KG', 2), entryUnitsFor('')]
    for (const units of lists) expect(units[0].factor).toBe(1)
  })
})

describe('what reaches the ledger', () => {
  // QtyInput multiplies the typed number by the chosen factor and hands the parent base
  // units. The balance is one number per product per location, so only a unit with a real
  // multiplier changes that number.
  const keyed = (typed: number, factor: number) => Math.round(typed * factor * 1000) / 1000

  test('two cases of 300 become 600 pieces, not 2', () => {
    expect(keyed(2, entryUnitsFor('EA', 300, 'ลัง')[1].factor)).toBe(600)
  })

  test('500 grams becomes half a kilogram', () => {
    expect(keyed(500, entryUnitsFor('KG')[1].factor)).toBe(0.5)
  })

  test('a fractional pack still converts', () => {
    expect(keyed(0.5, entryUnitsFor('EA', 24, 'Lot')[1].factor)).toBe(12)
  })

  test('a lot records the number typed against it, unconverted', () => {
    const lot = entryUnitsFor('KG').find((u) => u.label === 'Lot')!
    expect(keyed(3, lot.factor)).toBe(3)
  })
})
