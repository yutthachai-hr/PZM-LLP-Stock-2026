// Which units a quantity may be keyed in, and what actually reaches the ledger.
//
//   npm test
//
// Reported from the floor, twice. First: creating a product lets you pick EA, but on the
// receiving screen an EA product had no unit control at all — subUnitsFor() only knew KG
// and L, and everything else fell back to plain text. Then, once the control was always
// drawn: it still only offered units whose size could be computed, so a KG product showed
// KG and grams and nothing else, and Lot / Pack / EA — what is actually printed on the box
// — were still nowhere. They are now offered on every product, and their size is asked for
// at the moment of keying instead of guessed.

import { describe, expect, test } from 'vitest'
import { ASK_UNITS, entryUnitsFor, recallSize, subUnitsFor } from '../src/components/QtyInput'

const labels = (u: ReturnType<typeof entryUnitsFor>) => u.map((x) => x.label)

describe('the unit list is never empty', () => {
  test('a product with no sub-units still offers its own unit first', () => {
    // The first report: EA produced an empty list, so the screen rendered plain text.
    expect(subUnitsFor('EA')).toEqual([])
    expect(entryUnitsFor('EA')[0]).toMatchObject({ label: 'EA', factor: 1 })
  })

  test('a product with no unit at all still renders something selectable', () => {
    expect(entryUnitsFor('')[0].label).toBe('-')
  })

  test('every unit has a distinct key, because two of them can share a factor', () => {
    // Lot, Pack and EA all start at factor 0, so the factor cannot identify the choice.
    const keys = entryUnitsFor('KG', 2, 'ถุง').map((u) => u.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('what is printed on the box is always offered', () => {
  test('a kilogram product can still be received by the lot', () => {
    // The second report: this list used to stop at grams.
    expect(labels(entryUnitsFor('KG'))).toEqual(['KG', 'กรัม (g)', 'Lot', 'Pack', 'EA'])
  })

  test('those units start with no size, so nothing is invented', () => {
    for (const u of entryUnitsFor('KG').filter((x) => x.ask)) {
      expect(u.factor).toBe(0)
    }
    expect(ASK_UNITS).toEqual(['Lot', 'Pack', 'EA'])
  })

  test('a product is never offered its own unit twice', () => {
    // An EA product listing "EA" and then a second "EA" that asks for a size reads as a
    // broken control.
    expect(labels(entryUnitsFor('EA'))).toEqual(['EA', 'Lot', 'Pack'])
    expect(labels(entryUnitsFor('Lot'))).toEqual(['Lot', 'Pack', 'EA'])
    expect(labels(entryUnitsFor('Pack'))).toEqual(['Pack', 'Lot', 'EA'])
  })

  test('a configured pack replaces the one that would have asked', () => {
    // The product already says how big its pack is, so asking again would be a second,
    // worse answer to the same question.
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
    // it has to be the product's own, or asked for.
    expect(entryUnitsFor('EA', 300, 'ลัง')[1]).toMatchObject({ label: 'ลัง (×300)', factor: 300 })
  })

  test('an unnamed pack still says what it is', () => {
    expect(entryUnitsFor('EA', 12)[1].label).toBe('Pack (×12)')
  })

  test('a pack of one is not a unit', () => {
    // It would be a second entry for the same number — pick it and nothing changes, which
    // reads as the control being broken. Pack is then still offered as a size to key.
    const units = entryUnitsFor('EA', 1, 'Pack')
    expect(units.filter((u) => u.factor === 1)).toHaveLength(1)
    expect(units.find((u) => u.label === 'Pack')?.ask).toBe(true)
  })

  test('a missing or nonsense pack size is ignored rather than offered', () => {
    for (const size of [0, -5, undefined]) {
      expect(entryUnitsFor('EA', size, 'Pack').some((u) => u.label.includes('×'))).toBe(false)
    }
  })

  test('a pack sits alongside the sub-unit, not instead of it', () => {
    expect(entryUnitsFor('KG', 2, 'ถุง').map((u) => u.factor)).toEqual([1, 2, 0.001, 0, 0])
  })

  test('the base unit is always first, so the default records what was typed', () => {
    for (const units of [entryUnitsFor('EA', 300, 'ลัง'), entryUnitsFor('KG', 2), entryUnitsFor('')]) {
      expect(units[0].factor).toBe(1)
    }
  })
})

describe('what reaches the ledger', () => {
  // QtyInput multiplies the typed number by the chosen size and hands the parent base
  // units. The balance is one number per product per location, so a movement recorded in
  // "Lot" alongside one in "EA" would make that number unreadable.
  const keyed = (typed: number, factor: number) =>
    factor > 0 ? Math.round(typed * factor * 1000) / 1000 : 0

  test('two cases of 300 become 600 pieces, not 2', () => {
    expect(keyed(2, entryUnitsFor('EA', 300, 'ลัง')[1].factor)).toBe(600)
  })

  test('500 grams becomes half a kilogram', () => {
    expect(keyed(500, entryUnitsFor('KG')[1].factor)).toBe(0.5)
  })

  test('a fractional pack still converts', () => {
    expect(keyed(0.5, entryUnitsFor('EA', 24, 'Lot')[1].factor)).toBe(12)
  })

  test('a lot with no size given yet records nothing at all', () => {
    // Better a line the screen refuses to save than a 1 that silently meant 10 kilos.
    const lot = entryUnitsFor('KG').find((u) => u.label === 'Lot')!
    expect(keyed(3, lot.factor)).toBe(0)
  })
})

describe('a size keyed once is not asked for again', () => {
  test('nothing is recalled for a product that has never been keyed', () => {
    expect(recallSize('prod-never-seen', 'Lot')).toBe(0)
  })

  test('no product means no memory, rather than a shared one', () => {
    // The Adjust screen renders this control before a product is chosen.
    expect(recallSize(undefined, 'Lot')).toBe(0)
  })
})
