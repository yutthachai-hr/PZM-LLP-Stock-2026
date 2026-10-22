// In-transit accounting (owner, 22 Oct 2026): branch stock excludes goods on the road, the
// company total includes them, and moving goods between our own sites never changes it.
// Synthetic transfers through the real ledger and balance functions.
//
//   npm test
import { describe, expect, test } from 'vitest'
import { stockValue, stockView } from '../src/lib/inventoryRules/stockView'
import { balancesFromLedger, parseLevelId } from '../src/lib/levelKey'
import { effectOverall } from '../src/lib/ledger'
import { balanceSeries } from '../src/lib/stats/balanceSeries'
import { valueAsOf } from '../src/lib/stats/periodCompare'
import { TRANSIT_LOCATION_ID, type Product, type StockLevel, type StockLocation, type StockMovement } from '../src/types'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 1, 3)
const site = (id: string): StockLocation => ({ id, name: id, active: true, createdAt: 0 }) as StockLocation
const transit = { ...site(TRANSIT_LOCATION_ID), type: 'transit' } as StockLocation
let n = 0
const mv = (day: number, qty: number, from?: string, to?: string): StockMovement =>
  ({ id: `m${++n}`, docNo: `X-${n}`, type: from && to ? 'issue' : to ? 'receive' : 'issue', productId: 'p1', productName: 'Flour', unit: 'kg', qty, ...(from ? { fromLocationId: from } : {}), ...(to ? { toLocationId: to } : {}), date: T0 + day * DAY, byUserId: 'u', byUserName: 'U', createdAt: T0 + day * DAY }) as StockMovement

/** Balances as the engine would leave them after these movements. */
function levelsOf(movements: StockMovement[]): StockLevel[] {
  return [...balancesFromLedger(movements)].map(([id, qty]) => {
    const { locationId, productId } = parseLevelId(id)
    return { id, locationId, productId, qty, updatedAt: 0, updatedBy: 'u' }
  })
}
function buckets(movements: StockMovement[], locations: StockLocation[] = [site('wh'), site('br')]) {
  const v = stockView({ locations, levels: levelsOf(movements), minOverrides: [] })
  return { wh: v.qtyAt('wh', 'p1'), br: v.qtyAt('br', 'p1'), inTransit: v.transitQty('p1'), company: v.companyQty('p1') }
}
const ledgerTotal = (movements: StockMovement[]) => movements.reduce((s, m) => s + effectOverall(m), 0)

describe('stock buckets through a transfer', () => {
  const received = mv(0, 10, undefined, 'wh')
  const dispatched = mv(1, 4, 'wh', TRANSIT_LOCATION_ID)
  const partly = mv(2, 3, TRANSIT_LOCATION_ID, 'br')
  const returned = mv(3, 1, TRANSIT_LOCATION_ID, 'wh')

  test.each([
    ['received', [received], { wh: 10, br: 0, inTransit: 0, company: 10 }],
    ['dispatched into transit', [received, dispatched], { wh: 6, br: 0, inTransit: 4, company: 10 }],
    ['partly received at the branch', [received, dispatched, partly], { wh: 6, br: 3, inTransit: 1, company: 10 }],
    ['fully received at the branch', [received, dispatched, mv(2, 4, TRANSIT_LOCATION_ID, 'br')], { wh: 6, br: 4, inTransit: 0, company: 10 }],
    ['cancelled before dispatch (nothing moved)', [received], { wh: 10, br: 0, inTransit: 0, company: 10 }],
    ['returned to the source in full (source -> transit -> source)', [received, dispatched, mv(2, 4, TRANSIT_LOCATION_ID, 'wh')], { wh: 10, br: 0, inTransit: 0, company: 10 }],
    ['the short line returned to the source (cancellation/return)', [received, dispatched, partly, returned], { wh: 7, br: 3, inTransit: 0, company: 10 }],
  ])('%s: branches exclude transit, the company total does not move', (_label, movements, expected) => {
    expect(buckets(movements as StockMovement[])).toEqual(expected)
    // The stock card's all-sites ledger agrees with the company total at every step.
    expect(ledgerTotal(movements as StockMovement[])).toBe(expected.company)
  })

  test('no double counting when the caller\'s locations already include the transit location', () => {
    const movements = [received, dispatched]
    expect(buckets(movements, [site('wh'), site('br'), transit]).company).toBe(10)
  })

  test('closing a site does not remove company-owned stock', () => {
    const movements = [received, dispatched]
    expect(buckets(movements, [{ ...site('wh'), active: false }, site('br')])).toEqual({ wh: 6, br: 0, inTransit: 4, company: 10 })
  })

  test('negative transit remains visible in the accounting total, never silently clamped', () => {
    const movements = [received, mv(1, 2, TRANSIT_LOCATION_ID, undefined)]
    expect(buckets(movements)).toEqual({ wh: 10, br: 0, inTransit: -2, company: 8 })
    expect(ledgerTotal(movements)).toBe(8)
  })

  test('goods lost in transit leave the company total; only that leaves it', () => {
    const lost = mv(2, 1, TRANSIT_LOCATION_ID, undefined)
    expect(buckets([received, dispatched, lost])).toEqual({ wh: 6, br: 0, inTransit: 3, company: 9 })
    expect(ledgerTotal([received, dispatched, lost])).toBe(9)
  })

  test('the all-sites trend anchored on the company total is flat across a dispatch', () => {
    const movements = [received, dispatched]
    const series = balanceSeries(movements, { productId: 'p1', current: buckets(movements).company, today: T0 + 2 * DAY, days: 3 })
    expect(series.map((p) => p.balance)).toEqual([10, 10, 10])
  })

  test('valuation includes goods in transit and its seven-day comparison is not skewed by a dispatch', () => {
    const movements = [received, dispatched]
    const value = buckets(movements).company * 2 // cost 2 a kg
    expect(value).toBe(20)
    // The dispatch inside the window is internal: the value a week earlier is the same 20.
    expect(valueAsOf(value, movements, T0 + DAY, T0 - 30 * DAY, () => 2)).toBe(20)
  })
})

// `ensureTransitLocation` writes the canonical id, but nothing stops a data import or a future
// screen from creating a second location with type 'transit'. Those goods are still ours: they
// must appear in the in-transit line and in the company total exactly once, never be dropped.
describe('a second location marked type transit', () => {
  const second = { ...site('transit-b'), type: 'transit' } as StockLocation
  const both = [site('wh'), site('br'), transit, second]
  const view = (movements: StockMovement[], locations: StockLocation[] = both) =>
    stockView({ locations, levels: levelsOf(movements), minOverrides: [] })

  test('is counted in transit and in the company total, and is never a branch', () => {
    const v = view([mv(0, 10, undefined, 'wh'), mv(1, 3, 'wh', 'transit-b')])
    expect(v.qtyAt('wh', 'p1')).toBe(7)
    expect(v.qtyAt('transit-b', 'p1')).toBe(3)
    expect(v.transitQty('p1')).toBe(3)
    expect(v.companyQty('p1')).toBe(10)
  })

  test('does not double count when both transit locations hold goods', () => {
    const v = view([mv(0, 10, undefined, 'wh'), mv(1, 2, 'wh', TRANSIT_LOCATION_ID), mv(2, 3, 'wh', 'transit-b')])
    expect(v.transitQty('p1')).toBe(5)
    expect(v.companyQty('p1')).toBe(10)
  })

  test('keeps a negative balance signed instead of inflating the company total', () => {
    const v = view([mv(0, 10, undefined, 'wh'), mv(1, 2, 'transit-b', undefined)])
    expect(v.transitQty('p1')).toBe(-2)
    expect(v.companyQty('p1')).toBe(8)
  })

  test('an unstocked product is chased at a real branch, never at the earliest transit location', () => {
    const v = view([], [{ ...second, createdAt: 0 }, { ...site('br'), createdAt: 1 }])
    expect(v.tracksProduct('br', 'new')).toBe(true)
    expect(v.tracksProduct('transit-b', 'new')).toBe(false)
  })

  test('zero transit is zero, even when the canonical location document is absent', () => {
    const v = view([mv(0, 10, undefined, 'wh')], [site('wh')])
    expect(v.transitQty('p1')).toBe(0)
    expect(v.companyQty('p1')).toBe(10)
  })
})

describe('company value', () => {
  const product = (id: string, cost: number, active = true): Product =>
    ({ id, name: id, sku: id, category: 'Dry', unit: 'kg', unitType: 'KG', minStock: 0, hasImage: false, active, cost, createdAt: 0, updatedAt: 0 }) as Product

  test('hiding a product does not dispose of its stock', () => {
    const products = [product('p1', 10), product('p2', 5, false)]
    const qty = (id: string) => (id === 'p1' ? 24 : 6)
    expect(stockValue(products, qty)).toBe(270)
  })

  test('the in-transit line is valued the same way, and the two buckets never overlap', () => {
    const products = [product('p1', 10), product('p2', 5, false)]
    const company = (id: string) => (id === 'p1' ? 24 : 6)
    const inTransit = (id: string) => (id === 'p1' ? 5 : 0)
    expect(stockValue(products, inTransit)).toBe(50)
    // company - transit = what the branches hold; transit is inside the total once.
    expect(stockValue(products, company) - stockValue(products, inTransit)).toBe(220)
  })
})
