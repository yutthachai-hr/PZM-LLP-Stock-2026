// Which locations a product counts as belonging to.
//
//   npm test
//
// Reported with a screenshot of 45 low-stock rows, most of them the same shortage repeated:
// BARLAY MALT showed "0/20" at Sarasin and at Onnut even though none had ever been sent to
// either branch. Every product's minimum applied at every location, so one shortage became
// one row per branch and the real ones were buried.
//
// The owner's rule, asked and answered: a location carries a product once some has actually
// been there. The one exception is a product with no stock anywhere — that is something to
// buy, chased at the main warehouse and nowhere else.

import { describe, expect, test } from 'vitest'

/**
 * The rule as DataContext builds it, over the same inputs.
 *
 * Kept here in one piece because it is the decision, not the wiring: the dashboard, the
 * bell, the product list and the branch view all ask this one question.
 */
function tracker(
  levels: { locationId: string; productId: string }[],
  locations: { id: string; type: 'warehouse' | 'branch'; createdAt?: number; active?: boolean }[],
) {
  const stockedAt = new Set(levels.map((l) => `${l.locationId}__${l.productId}`))
  const stockedAnywhere = new Set(levels.map((l) => l.productId))
  const home =
    [...locations]
      .filter((l) => l.active !== false)
      .sort(
        (a, b) =>
          (a.type === 'warehouse' ? 0 : 1) - (b.type === 'warehouse' ? 0 : 1) ||
          (a.createdAt ?? 0) - (b.createdAt ?? 0),
      )[0]?.id ?? ''
  return (locationId: string, productId: string) =>
    stockedAt.has(`${locationId}__${productId}`) ||
    (!stockedAnywhere.has(productId) && locationId === home)
}

const LOCATIONS = [
  { id: 'branch-sarasin', type: 'branch' as const, createdAt: 3 },
  { id: 'main', type: 'warehouse' as const, createdAt: 1 },
  { id: 'branch-onnut', type: 'branch' as const, createdAt: 2 },
]

describe('a branch carries what has been sent to it', () => {
  const tracks = tracker([{ locationId: 'main', productId: 'barley' }], LOCATIONS)

  test('the warehouse it was received at carries it', () => {
    expect(tracks('main', 'barley')).toBe(true)
  })

  test('a branch it has never been sent to does not', () => {
    // The reported bug, exactly: 0/20 at two branches that have never seen the product.
    expect(tracks('branch-sarasin', 'barley')).toBe(false)
    expect(tracks('branch-onnut', 'barley')).toBe(false)
  })

  test('one shortage is one row, not one per location', () => {
    const rows = LOCATIONS.filter((l) => tracks(l.id, 'barley'))
    expect(rows).toHaveLength(1)
  })
})

describe('a balance that has fallen to zero still counts', () => {
  test('a branch that has run out is short, not absent', () => {
    // This is the whole point of the alert, so "has a balance row" is the test rather than
    // "has some left" — the latter would hide every shortage the moment it became one.
    const tracks = tracker(
      [{ locationId: 'branch-onnut', productId: 'cheese' }],
      LOCATIONS,
    )
    expect(tracks('branch-onnut', 'cheese')).toBe(true)
  })
})

describe('something nobody has ever received', () => {
  const tracks = tracker([], LOCATIONS)

  test('is chased at the main warehouse', () => {
    expect(tracks('main', 'new-item')).toBe(true)
  })

  test('and nowhere else, so a new product is one row and not three', () => {
    expect(tracks('branch-sarasin', 'new-item')).toBe(false)
    expect(tracks('branch-onnut', 'new-item')).toBe(false)
  })

  test('the main warehouse is chosen by type, not by being first in the list', () => {
    // The branches come first in LOCATIONS, and one of them is older than nothing here.
    expect(tracks('main', 'new-item')).toBe(true)
  })

  test('the oldest warehouse wins, so the row does not wander between two of them', () => {
    const two = [
      { id: 'wh-new', type: 'warehouse' as const, createdAt: 9 },
      ...LOCATIONS,
    ]
    const t = tracker([], two)
    expect(t('main', 'x')).toBe(true)
    expect(t('wh-new', 'x')).toBe(false)
  })

  test('a closed warehouse is not where anything gets chased', () => {
    const t = tracker([], [{ id: 'main', type: 'warehouse', createdAt: 1, active: false }, ...LOCATIONS.filter((l) => l.id !== 'main')])
    expect(t('main', 'x')).toBe(false)
    // Falls to the oldest location still open.
    expect(t('branch-onnut', 'x')).toBe(true)
  })

  test('with no locations at all nothing is chased anywhere', () => {
    expect(tracker([], [])('main', 'x')).toBe(false)
  })
})

describe('once it has been sent somewhere, the exception stops applying', () => {
  test('a product held at a branch is not also chased at the warehouse', () => {
    const tracks = tracker([{ locationId: 'branch-onnut', productId: 'sauce' }], LOCATIONS)
    expect(tracks('branch-onnut', 'sauce')).toBe(true)
    expect(tracks('main', 'sauce')).toBe(false)
  })
})
