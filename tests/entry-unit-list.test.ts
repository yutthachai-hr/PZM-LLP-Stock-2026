// The owner's own list of entry units — Lot, Pack, EA, Carton — and what it costs to read.
//
//   npm test
//
// Asked for after the size box was removed: a way to add their own units, starting with
// Carton. The list is one shared document, so the whole vocabulary is one read, and it is
// read once per session rather than subscribed.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw } = await import('./helpers/memory-backend')
const {
  DEFAULT_UNITS,
  clearEntryUnitCache,
  loadEntryUnits,
  normaliseUnits,
  peekEntryUnits,
  saveEntryUnits,
} = await import('../src/services/entryUnits')
const { entryUnitsFor } = await import('../src/components/QtyInput')
const { backend } = await import('../src/backend')

beforeEach(() => {
  resetMemory()
  clearEntryUnitCache()
  vi.restoreAllMocks()
})

describe('tidying a list before it is stored', () => {
  test('blank and whitespace-only names are dropped', () => {
    expect(normaliseUnits(['Lot', '   ', '', 'Pack'])).toEqual(['Lot', 'Pack'])
  })

  test('names are trimmed, because a trailing space is invisible in a dropdown', () => {
    expect(normaliseUnits([' Carton '])).toEqual(['Carton'])
  })

  test('the same name twice is once, whatever the casing', () => {
    // Two options reading "Carton" and "carton" are a coin toss for whoever picks one.
    expect(normaliseUnits(['Carton', 'carton', 'CARTON'])).toEqual(['Carton'])
  })

  test('a name cannot be longer than the column it has to fit in', () => {
    expect(normaliseUnits(['x'.repeat(80)])[0]).toHaveLength(20)
  })

  test('the list is bounded, so one paste cannot fill the dropdown', () => {
    const many = Array.from({ length: 200 }, (_, i) => `U${i}`)
    expect(normaliseUnits(many)).toHaveLength(40)
  })

  test('order is kept, so a newly added unit lands where it was put', () => {
    expect(normaliseUnits(['EA', 'Lot', 'Carton'])).toEqual(['EA', 'Lot', 'Carton'])
  })
})

describe('reading the list', () => {
  test('an unconfigured system gets the built-in units, not an empty dropdown', async () => {
    expect(await loadEntryUnits()).toEqual([...DEFAULT_UNITS])
  })

  test('a stored list replaces them', async () => {
    await backend.set('meta', 'entryUnits', {
      id: 'entryUnits',
      names: ['Carton', 'Lot'],
      updatedAt: 1,
    })
    expect(await loadEntryUnits()).toEqual(['Carton', 'Lot'])
  })

  test('a stored list is tidied on the way in, not trusted as written', async () => {
    // It can be edited outside the app, or written by an older version.
    await backend.set('meta', 'entryUnits', {
      id: 'entryUnits',
      names: [' Carton ', 'carton', ''],
      updatedAt: 1,
    })
    expect(await loadEntryUnits()).toEqual(['Carton'])
  })

  test('the document is read once per session, however many screens ask', async () => {
    const spy = vi.spyOn(backend, 'getOne')
    await Promise.all([loadEntryUnits(), loadEntryUnits()])
    await loadEntryUnits()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('a read that fails does not take the entry screens with it', async () => {
    vi.spyOn(backend, 'getOne').mockRejectedValueOnce(new Error('permission-denied'))
    expect(await loadEntryUnits()).toEqual([...DEFAULT_UNITS])
  })

  test('nothing is read until a screen asks for it', () => {
    expect(peekEntryUnits()).toBeNull()
  })
})

describe('changing the list', () => {
  test('saving stores the tidied list and does not re-read it', async () => {
    await loadEntryUnits()
    const spy = vi.spyOn(backend, 'getOne')
    await saveEntryUnits(['Lot', 'Pack', 'EA', ' Carton '])
    expect(peekEntryUnits()).toEqual(['Lot', 'Pack', 'EA', 'Carton'])
    expect(spy).not.toHaveBeenCalled()
    expect(raw('meta').find((d) => d.id === 'entryUnits')).toMatchObject({
      names: ['Lot', 'Pack', 'EA', 'Carton'],
    })
  })

  test('the list cannot be emptied, because an empty dropdown looks broken', async () => {
    await expect(saveEntryUnits([])).rejects.toThrow()
    await expect(saveEntryUnits(['  '])).rejects.toThrow()
  })

  test('a removed unit is gone from the next screen that asks', async () => {
    await saveEntryUnits(['Lot', 'Carton'])
    await saveEntryUnits(['Carton'])
    expect(await loadEntryUnits()).toEqual(['Carton'])
  })
})

describe('what the dropdown does with it', () => {
  test("the product's own unit is never part of the editable list", () => {
    // Asked directly: "where did KG go?". It comes from the product, is always first, and
    // no edit in Settings can remove it.
    const units = entryUnitsFor('KG', undefined, undefined, ['Carton'])
    expect(units.map((u) => u.label)).toEqual(['KG', 'กรัม (g)', 'Carton'])
    expect(units[0].factor).toBe(1)
  })

  test('a custom unit records what was typed, like the built-in ones', () => {
    const carton = entryUnitsFor('KG', undefined, undefined, ['Carton'])[2]
    expect(carton.factor).toBe(1)
  })

  test('the built-in list stands in until the real one has loaded', () => {
    expect(entryUnitsFor('KG').map((u) => u.label)).toEqual([
      'KG',
      'กรัม (g)',
      ...DEFAULT_UNITS,
    ])
  })

  test('a custom unit that repeats the product unit is not listed twice', () => {
    expect(entryUnitsFor('Carton', undefined, undefined, ['Carton', 'Lot'])).toHaveLength(2)
  })

  test('a list that repeats itself still yields distinct options', () => {
    const keys = entryUnitsFor('KG', undefined, undefined, ['Carton', 'carton']).map((u) => u.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
