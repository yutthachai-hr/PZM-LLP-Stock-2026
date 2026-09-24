// Logistics: stock moved between the company's own sites, through a transit location.
//
//   npm test
//
// The three acceptance scenarios from the brief come first, in the words the owner used,
// then everything around them: overage, redirect/forward/return, and the guards that keep
// a double press from moving stock twice. After every scenario the same three checks run:
// the ledger and the balances agree (findLevelDrift), no balance is negative, and the
// transit balance is exactly what the open documents say is on the road.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Product, StockLevel, StockLocation, StockMovement, Transfer, TransferItem } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const T = await import('../src/services/transfers')
const { findLevelDrift, receiveStock, issueStock } = await import('../src/services/stock')
const { entryFor } = await import('../src/lib/uom')
const { setActiveBrand } = await import('../src/brand/brand')

const WAREHOUSE_STAFF = { id: 'u-wh', name: 'คลัง A', role: 'staff' as const, siteIds: ['loc-main'] }
const SARASIN_STAFF = { id: 'u-sr', name: 'สารสิน B', role: 'staff' as const, siteIds: ['loc-sarasin'] }
const ONNUT_STAFF = { id: 'u-on', name: 'อ่อนนุช C', role: 'staff' as const, siteIds: ['loc-onnut'] }
const MANAGER = { id: 'u-mgr', name: 'หัวหน้า M', role: 'manager' as const }
const ADMIN = { id: 'u-admin', name: 'Admin', role: 'admin' as const }

const MAIN = 'loc-main'
const SARASIN = 'loc-sarasin'
const ONNUT = 'loc-onnut'
const TRANSIT = 'transit'

const locations: StockLocation[] = [
  { id: MAIN, name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 },
  { id: SARASIN, name: 'สาขาสารสิน', type: 'branch', active: true, createdAt: 1 },
  { id: ONNUT, name: 'สาขาอ่อนนุช', type: 'branch', active: true, createdAt: 1 },
]

const product = (id: string, name: string, unitType: string, over: Partial<Product> = {}): Product => ({
  id, sku: id.toUpperCase(), name, category: 'c', unit: unitType, unitType, minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over,
})
const COKE = product('p-coke', 'COKE', 'EA', { unitConversions: [{ label: 'Carton', size: 24 }] })
const MOZZ = product('p-mozz', 'MOZZARELLA', 'KG')

function level(locationId: string, productId: string): number {
  const row = (raw('stockLevels') as unknown as StockLevel[]).find((l) => l.locationId === locationId && l.productId === productId && !l.unit)
  return row?.qty ?? 0
}
const docs = () => raw('transfers') as unknown as Transfer[]
const doc = (id: string) => docs().find((t) => t.id === id)!
const movements = () => raw('stockMovements') as unknown as StockMovement[]

async function stock(p: Product, qty: number, at = MAIN) {
  await receiveStock({ lines: [{ productId: p.id, productName: p.name, unit: p.unitType, qty }], toLocationId: at, date: Date.now(), actor: WAREHOUSE_STAFF })
}

/** A line as the editor builds it: keyed in any unit the product has, converted with entryFor. */
function line(p: Product, entryQty: number, entryUnit?: string, idx = 0): TransferItem {
  const e = entryFor(p, entryQty, entryUnit)
  return {
    idx, productId: p.id, productName: p.name, sku: p.sku, unit: p.unitType,
    requestedQty: e.qty, dispatchQty: e.qty,
    ...(e.entryUnit ? { requestedEntryUnit: e.entryUnit, requestedEntryQty: e.entryQty } : {}),
  }
}

/** Draft → submit → approve, the everyday path. */
async function approved(to: string, items: TransferItem[], by = WAREHOUSE_STAFF): Promise<Transfer> {
  const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: to, dispatchDate: Date.now(), actor: by })
  const s = await T.submitTransfer(d.id, by, items)
  return T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve' })
}

/** The three checks every scenario ends with. */
async function booksBalance() {
  expect(await findLevelDrift()).toEqual([])
  for (const l of raw('stockLevels') as unknown as StockLevel[]) expect(l.qty).toBeGreaterThanOrEqual(0)
  // What the open documents say is on the road is exactly what the transit location holds.
  for (const p of [COKE, MOZZ]) {
    const onRoad = docs().flatMap((t) => t.items.filter((i) => i.productId === p.id && !i.removed).map((i) => i.inTransitQty ?? 0))
    expect(level(TRANSIT, p.id)).toBeCloseTo(onRoad.reduce((a, b) => a + b, 0), 6)
  }
}

const companyTotal = (p: Product) =>
  (raw('stockLevels') as unknown as StockLevel[]).filter((l) => l.productId === p.id && !l.unit).reduce((a, l) => a + l.qty, 0)

beforeEach(async () => {
  resetMemory()
  setActiveBrand('pizza')
  seed('locations', locations as unknown as Record<string, unknown>[])
  seed('products', [COKE, MOZZ] as unknown as Record<string, unknown>[])
  await T.ensureTransitLocation()
})

describe('acceptance scenario 1 — COKE 100, Main → Sarasin 24', () => {
  test('approve moves 24 into transit; receiving all 24 completes it with no second approval', async () => {
    await stock(COKE, 100)
    const t = await approved(SARASIN, [line(COKE, 24)])
    expect(t.status).toBe('inTransit')
    expect(level(MAIN, COKE.id)).toBe(76)
    expect(level(TRANSIT, COKE.id)).toBe(24)
    expect(companyTotal(COKE)).toBe(100) // nothing left the company

    const opened = await T.openReceiving(t.id, SARASIN_STAFF)
    expect(opened.status).toBe('receiving')
    const done = await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 24 }] })
    expect(done.status).toBe('completed')
    expect(level(TRANSIT, COKE.id)).toBe(0)
    expect(level(SARASIN, COKE.id)).toBe(24)
    expect(level(MAIN, COKE.id)).toBe(76)
    await booksBalance()
  })

  test('every stock row the transfer made carries its id, and goes through transit', async () => {
    await stock(COKE, 100)
    const t = await approved(SARASIN, [line(COKE, 24)])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 24 }] })
    const mine = movements().filter((m) => m.transferId === t.id)
    expect(mine.map((m) => [m.type, m.fromLocationId, m.toLocationId, m.qty])).toEqual([
      ['issue', MAIN, TRANSIT, 24],
      ['issue', TRANSIT, SARASIN, 24],
    ])
  })
})

describe('acceptance scenario 2 — 10 KG sent, 8.7 KG received', () => {
  test('8.7 goes in, 1.3 stays open in transit, NOT_ACTUALLY_LOADED returns it to the source', async () => {
    await stock(MOZZ, 50)
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    const r = await T.confirmReceive({
      transferId: t.id,
      actor: SARASIN_STAFF,
      receivedLines: [{ idx: 0, receivedQty: 8.7, discrepancy: { reason: 'WEIGHT_VARIANCE', note: 'ชั่งได้ 8.7' } }],
    })
    expect(level(SARASIN, MOZZ.id)).toBeCloseTo(8.7)
    expect(level(TRANSIT, MOZZ.id)).toBeCloseTo(1.3) // not deleted, not written off
    expect(r.status).toBe('discrepancy')
    expect(r.items[0].discrepancy).toMatchObject({ kind: 'short', qty: 1.3, reason: 'WEIGHT_VARIANCE' })
    // The three numbers stay side by side.
    expect(r.items[0]).toMatchObject({ requestedQty: 10, dispatchQty: 10, receivedQty: 8.7 })
    await booksBalance()

    const sent = await T.submitDiscrepancyForApproval(t.id, SARASIN_STAFF)
    expect(sent.status).toBe('pendingDiscrepancyApproval')
    const done = await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'NOT_ACTUALLY_LOADED' }, actor: MANAGER })
    expect(done.status).toBe('completed')
    expect(level(TRANSIT, MOZZ.id)).toBeCloseTo(0)
    expect(level(MAIN, MOZZ.id)).toBeCloseTo(41.3) // 50 − 10 + 1.3
    expect(level(SARASIN, MOZZ.id)).toBeCloseTo(8.7)
    await booksBalance()
  })

  test.each([
    ['TRANSIT_LOSS', 'lost'],
    ['DAMAGED', 'damage'],
  ] as const)('%s writes the 1.3 off transit as an adjustment with reason %s', async (code, reason) => {
    await stock(MOZZ, 50)
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 8.7 }] })
    await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code }, actor: MANAGER })
    const adj = movements().find((m) => m.type === 'adjust' && m.transferId === t.id)!
    expect(adj).toMatchObject({ fromLocationId: TRANSIT, reason })
    expect(adj.qty).toBeCloseTo(1.3)
    expect(companyTotal(MOZZ)).toBeCloseTo(48.7)
    await booksBalance()
  })

  test('WEIGHING_ERROR files the rest into the branch and keeps both counts', async () => {
    await stock(MOZZ, 50)
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 8.7 }] })
    const done = await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'WEIGHING_ERROR', note: 'ตาชั่งเพี้ยน' }, actor: MANAGER })
    expect(level(SARASIN, MOZZ.id)).toBeCloseTo(10)
    expect(done.items[0].receivedQty).toBeCloseTo(8.7)
    expect(done.items[0].correctedReceivedQty).toBeCloseTo(10)
    await booksBalance()
  })
})

describe('acceptance scenario 3 — 5 Carton for Sarasin, 2 Carton found at On Nut', () => {
  const CARTON = 24

  test('reported first: On Nut does not get them, Sarasin receives 3, FORWARD delivers 2 without touching Main again', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    expect(level(MAIN, COKE.id)).toBe(200 - 5 * CARTON)

    const reported = await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 2 * CARTON, actor: ONNUT_STAFF, note: 'ติดมากับรถ' })
    // Still on its way to Sarasin: the report must not stop Sarasin receiving.
    expect(reported.status).toBe('inTransit')
    expect(reported.items[0].misroutes![0]).toMatchObject({ originalDestinationId: SARASIN, actualCustodyLocationId: ONNUT, qty: 48, reportedBy: ONNUT_STAFF.id })
    expect(level(ONNUT, COKE.id)).toBe(0) // not On Nut's sellable stock

    // Sarasin counts 3 Carton, which is exactly what it should now expect.
    const r = await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 3 * CARTON }] })
    expect(r.items[0].discrepancy).toBeUndefined()
    expect(r.status).toBe('pendingDiscrepancyApproval') // the misroute waits for the manager
    expect(level(SARASIN, COKE.id)).toBe(72)
    expect(level(TRANSIT, COKE.id)).toBe(48)

    const { transfer: parent, childTransfer: leg } = await T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: reported.items[0].misroutes![0].id, action: 'forward', actor: MANAGER })
    expect(leg).toMatchObject({ status: 'inTransit', fromLocationId: ONNUT, toLocationId: SARASIN, parentId: t.id, legKind: 'forward' })
    expect(parent.status).toBe('resolved') // done here, waiting on the leg
    expect(level(MAIN, COKE.id)).toBe(200 - 5 * CARTON) // NOT deducted again

    const legDone = await T.confirmReceive({ transferId: leg!.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 48 }] })
    expect(legDone.status).toBe('completed')
    expect(doc(t.id).status).toBe('completed') // the parent closes with its leg
    expect(level(SARASIN, COKE.id)).toBe(5 * CARTON)
    expect(level(TRANSIT, COKE.id)).toBe(0)
    expect(level(ONNUT, COKE.id)).toBe(0)
    expect(companyTotal(COKE)).toBe(200)
    await booksBalance()
  })

  test('received first: Sarasin is short 2 Carton, On Nut’s report turns that shortage into the misroute — counted once', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    const r = await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 72 }] })
    expect(r.items[0].discrepancy).toMatchObject({ kind: 'short', qty: 48 })
    const rep = await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 48, actor: ONNUT_STAFF })
    expect(rep.items[0].discrepancy!.resolution).toMatchObject({ code: 'WRONG_BRANCH', qty: 48 })
    expect(rep.status).toBe('pendingDiscrepancyApproval')
    // Nothing more can be reported: the 48 are accounted for.
    await expect(T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 1, actor: ONNUT_STAFF })).rejects.toThrow()

    const { childTransfer: leg } = await T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: rep.items[0].misroutes![0].id, action: 'forward', actor: MANAGER })
    await T.confirmReceive({ transferId: leg!.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 48 }] })
    expect(doc(t.id).status).toBe('completed')
    expect(level(SARASIN, COKE.id)).toBe(120)
    expect(level(MAIN, COKE.id)).toBe(80)
    await booksBalance()
  })

  test('a shortage the manager marks WRONG_BRANCH becomes a misroute at the branch they name', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 72 }] })
    await expect(T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'WRONG_BRANCH' }, actor: MANAGER })).rejects.toThrow()
    const w = await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'WRONG_BRANCH' }, custodyLocationId: ONNUT, actor: MANAGER })
    expect(w.items[0].misroutes![0]).toMatchObject({ actualCustodyLocationId: ONNUT, qty: 48 })
    expect(w.status).toBe('pendingDiscrepancyApproval')
    expect(level(TRANSIT, COKE.id)).toBe(48) // still on the road
    await booksBalance()
  })

  test('REDIRECT puts them into On Nut’s stock, and can raise a replacement draft for Sarasin', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    const rep = await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 48, actor: ONNUT_STAFF })
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 72 }] })
    const { transfer, replacement } = await T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: rep.items[0].misroutes![0].id, action: 'redirect', actor: MANAGER, createReplacement: true })
    expect(transfer.status).toBe('completed')
    expect(level(ONNUT, COKE.id)).toBe(48)
    expect(level(TRANSIT, COKE.id)).toBe(0)
    expect(replacement).toMatchObject({ status: 'draft', fromLocationId: MAIN, toLocationId: SARASIN, legKind: 'replacement', parentId: t.id })
    expect(replacement!.items[0].requestedQty).toBe(48)
    expect(level(MAIN, COKE.id)).toBe(80) // a draft moves nothing
    await booksBalance()
  })

  test('RETURN sends them back to Main through a leg Main receives', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    const rep = await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 48, actor: ONNUT_STAFF })
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 72 }] })
    const { childTransfer: leg } = await T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: rep.items[0].misroutes![0].id, action: 'return', actor: MANAGER })
    expect(leg).toMatchObject({ fromLocationId: ONNUT, toLocationId: MAIN, legKind: 'return' })
    expect(doc(t.id).status).toBe('resolved')
    await T.confirmReceive({ transferId: leg!.id, actor: WAREHOUSE_STAFF, receivedLines: [{ idx: 0, receivedQty: 48 }] })
    expect(level(MAIN, COKE.id)).toBe(128)
    expect(doc(t.id).status).toBe('completed')
    await booksBalance()
  })

  test('the parent’s chain can be read back: legs, and every movement they made', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    const rep = await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 48, actor: ONNUT_STAFF })
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 72 }] })
    const { childTransfer: leg } = await T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: rep.items[0].misroutes![0].id, action: 'forward', actor: MANAGER })
    await T.confirmReceive({ transferId: leg!.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 48 }] })
    const parent = doc(t.id)
    expect(parent.childIds).toEqual([leg!.id])
    expect(parent.history.map((h) => h.action)).toEqual(
      expect.arrayContaining(['created', 'submitted', 'approved', 'movedToTransit', 'misrouteReported', 'received', 'forwarded', 'legClosed']),
    )
    const rows = await T.transferMovements([t.id, leg!.id])
    expect(rows.map((m) => [m.fromLocationId, m.toLocationId, m.qty])).toEqual([
      [MAIN, TRANSIT, 120],
      [TRANSIT, SARASIN, 72],
      [TRANSIT, SARASIN, 48],
    ])
  })
})

describe('overage — 10 sent, 12 counted', () => {
  async function over() {
    await stock(MOZZ, 50)
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    const r = await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 12 }] })
    return { t, r }
  }

  test('only the 10 that were sent go in; the extra 2 wait for the manager', async () => {
    const { r } = await over()
    expect(level(SARASIN, MOZZ.id)).toBe(10)
    expect(r.items[0].discrepancy).toMatchObject({ kind: 'over', qty: 2, reason: 'OVER' })
    await booksBalance()
  })

  test('DISPATCH_WRONG: Main really sent 12 — Main −2, Sarasin +2, and the dispatch figure is corrected beside the original', async () => {
    const { t } = await over()
    const d = await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'DISPATCH_WRONG' }, actor: MANAGER })
    expect(level(MAIN, MOZZ.id)).toBe(38)
    expect(level(SARASIN, MOZZ.id)).toBe(12)
    expect(d.items[0]).toMatchObject({ dispatchQty: 10, correctedDispatchQty: 12 })
    await booksBalance()
  })

  test('APPROVED_ADJUSTMENT: a found-goods adjustment explains the +2', async () => {
    const { t } = await over()
    await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'APPROVED_ADJUSTMENT', note: 'ของแถม' }, actor: MANAGER })
    const adj = movements().find((m) => m.type === 'adjust' && m.transferId === t.id)!
    expect(adj).toMatchObject({ toLocationId: SARASIN, reason: 'found', qty: 2 })
    expect(level(SARASIN, MOZZ.id)).toBe(12)
    await booksBalance()
  })

  test('COUNT_ERROR: nothing moves; the corrected count is kept beside the receiver’s', async () => {
    const { t } = await over()
    const before = movements().length
    const d = await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'COUNT_ERROR' }, actor: MANAGER })
    expect(movements().length).toBe(before)
    expect(d.items[0]).toMatchObject({ receivedQty: 12, correctedReceivedQty: 10 })
    await booksBalance()
  })

  test('BELONGS_TO_OTHER_TRANSFER: the 2 are recorded as found goods of the On Nut delivery, which then decides', async () => {
    await stock(MOZZ, 50)
    const toOnNut = await approved(ONNUT, [line(MOZZ, 2)])
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 12 }] })
    const d = await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'BELONGS_TO_OTHER_TRANSFER' }, relatedTransferId: toOnNut.id, actor: MANAGER })
    expect(d.status).toBe('completed')
    const other = doc(toOnNut.id)
    expect(other.items[0].misroutes![0]).toMatchObject({ actualCustodyLocationId: SARASIN, qty: 2 })
    await T.resolveMisroute({ transferId: toOnNut.id, itemIdx: 0, misrouteId: other.items[0].misroutes![0].id, action: 'redirect', actor: MANAGER })
    expect(level(SARASIN, MOZZ.id)).toBe(12)
    expect(level(TRANSIT, MOZZ.id)).toBe(0)
    await booksBalance()
  })
})

describe('guards', () => {
  test('two approvals at the same moment deduct once', async () => {
    await stock(COKE, 100)
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const s = await T.submitTransfer(d.id, WAREHOUSE_STAFF, [line(COKE, 24)])
    const results = await Promise.allSettled([
      T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve' }),
      T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: ADMIN, action: 'approve' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(level(MAIN, COKE.id)).toBe(76)
    expect(level(TRANSIT, COKE.id)).toBe(24)
    await booksBalance()
  })

  test('a resolution cannot be applied twice, nor two different ones at once', async () => {
    await stock(MOZZ, 50)
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 8.7 }] })
    const results = await Promise.allSettled([
      T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'NOT_ACTUALLY_LOADED' }, actor: MANAGER }),
      T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'TRANSIT_LOSS' }, actor: ADMIN }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await expect(T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'NOT_ACTUALLY_LOADED' }, actor: MANAGER })).rejects.toThrow()
    expect(companyTotal(MOZZ)).toBeCloseTo(results[0].status === 'fulfilled' ? 50 : 48.7)
    await booksBalance()
  })

  test('a misroute cannot be decided twice', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 48)])
    const rep = await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 10, actor: ONNUT_STAFF })
    const id = rep.items[0].misroutes![0].id
    await T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: id, action: 'redirect', actor: MANAGER })
    await expect(T.resolveMisroute({ transferId: t.id, itemIdx: 0, misrouteId: id, action: 'redirect', actor: MANAGER })).rejects.toThrow()
    expect(level(ONNUT, COKE.id)).toBe(10)
    await booksBalance()
  })

  test('a resolution moves the open quantity and nothing else, and only the right kind applies', async () => {
    await stock(MOZZ, 50)
    const t = await approved(SARASIN, [line(MOZZ, 10)])
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 8.7 }] })
    await expect(T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'NOT_ACTUALLY_LOADED', qty: 5 }, actor: MANAGER })).rejects.toThrow()
    await expect(T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'APPROVED_ADJUSTMENT' }, actor: MANAGER })).rejects.toThrow()
    expect(level(TRANSIT, MOZZ.id)).toBeCloseTo(1.3)
  })

  test('a report cannot claim more than is on the road', async () => {
    await stock(COKE, 100)
    const t = await approved(SARASIN, [line(COKE, 24)])
    await expect(T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 25, actor: ONNUT_STAFF })).rejects.toThrow()
    await T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 20, actor: ONNUT_STAFF })
    await expect(T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 5, actor: ONNUT_STAFF })).rejects.toThrow()
    // Nor from a branch the reporter does not belong to, nor naming the destination itself.
    await expect(T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: ONNUT, qty: 1, actor: SARASIN_STAFF })).rejects.toThrow()
    await expect(T.reportMisroute({ transferId: t.id, itemIdx: 0, actualCustodyLocationId: SARASIN, qty: 1, actor: SARASIN_STAFF })).rejects.toThrow()
  })

  test('approval re-reads the source: short stock refuses it and moves nothing', async () => {
    await stock(COKE, 30)
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const s = await T.submitTransfer(d.id, WAREHOUSE_STAFF, [line(COKE, 24)])
    // Someone else takes 10 before the manager gets to it.
    await issueStock({ lines: [{ productId: COKE.id, productName: 'COKE', unit: 'EA', qty: 10 }], fromLocationId: MAIN, toLocationId: ONNUT, date: Date.now(), actor: MANAGER })
    await expect(T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve' })).rejects.toThrow()
    expect(level(MAIN, COKE.id)).toBe(20)
    expect(doc(s.id).status).toBe('pendingApproval')
    await booksBalance()
  })

  test('approval refuses until an admin has switched logistics on (the transit location exists)', async () => {
    resetMemory()
    seed('locations', locations as unknown as Record<string, unknown>[])
    seed('products', [COKE] as unknown as Record<string, unknown>[])
    await stock(COKE, 100)
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const s = await T.submitTransfer(d.id, WAREHOUSE_STAFF, [line(COKE, 24)])
    await expect(T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve' })).rejects.toThrow()
    await expect(T.ensureTransitLocation(undefined, MANAGER)).rejects.toThrow()
    await T.ensureTransitLocation(undefined, ADMIN)
    await T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve' })
    expect(level(TRANSIT, COKE.id)).toBe(24)
  })
})

describe('permissions', () => {
  test('staff create and submit for their own site; only a manager reviews', async () => {
    await stock(COKE, 100)
    await expect(T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: SARASIN_STAFF })).rejects.toThrow()
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const s = await T.submitTransfer(d.id, WAREHOUSE_STAFF, [line(COKE, 24)])
    await expect(T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: WAREHOUSE_STAFF, action: 'approve' })).rejects.toThrow()
  })

  test('only the destination’s people receive, and only a manager resolves', async () => {
    await stock(COKE, 100)
    const t = await approved(SARASIN, [line(COKE, 24)])
    await expect(T.confirmReceive({ transferId: t.id, actor: ONNUT_STAFF, receivedLines: [{ idx: 0, receivedQty: 24 }] })).rejects.toThrow()
    await T.confirmReceive({ transferId: t.id, actor: SARASIN_STAFF, receivedLines: [{ idx: 0, receivedQty: 20 }] })
    await expect(T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, resolution: { code: 'TRANSIT_LOSS' }, actor: SARASIN_STAFF })).rejects.toThrow()
  })

  test('someone with no sites assigned may act for every site (owner, 24 Sep 2026)', async () => {
    await stock(COKE, 100)
    const anywhere = { id: 'u-any', name: 'Any', role: 'staff' as const }
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: anywhere })
    const s = await T.submitTransfer(d.id, anywhere, [line(COKE, 24)])
    const t = await T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve' })
    expect((await T.confirmReceive({ transferId: t.id, actor: anywhere, receivedLines: [{ idx: 0, receivedQty: 24 }] })).status).toBe('completed')
  })

  test('once stock has moved, it cannot be cancelled', async () => {
    await stock(COKE, 100)
    const t = await approved(SARASIN, [line(COKE, 24)])
    await expect(T.cancelTransfer(t.id, MANAGER, 'ผิด')).rejects.toThrow()
  })
})

describe('the request and the review', () => {
  test('a keyed unit is converted with the product’s own rate, and the keyed figure is kept', async () => {
    await stock(COKE, 200)
    const t = await approved(SARASIN, [line(COKE, 5, 'Carton')])
    expect(t.items[0]).toMatchObject({ requestedQty: 120, requestedEntryQty: 5, requestedEntryUnit: 'Carton', dispatchQty: 120 })
    const out = movements().find((m) => m.transferId === t.id)!
    expect(out).toMatchObject({ qty: 120, entryQty: 5, entryUnit: 'Carton' })
    expect(() => entryFor(MOZZ, 1, 'Carton')).toThrow() // no rate → the existing "define it" refusal
  })

  test('a manager edits the dispatch figure; the requester’s stays, and the change is in the history with old and new', async () => {
    await stock(COKE, 100)
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const s = await T.submitTransfer(d.id, WAREHOUSE_STAFF, [line(COKE, 24)])
    const edited = s.items.map((i) => ({ ...i, dispatchQty: 20 }))
    const t = await T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'approve', items: edited })
    expect(t.items[0]).toMatchObject({ requestedQty: 24, dispatchQty: 20, inTransitQty: 20 })
    expect(level(MAIN, COKE.id)).toBe(80)
    const change = t.history.find((h) => h.action === 'qtyChanged')!
    expect(change).toMatchObject({ by: MANAGER.id, oldQty: 24, newQty: 20 })
  })

  test('return and reject need a reason; a returned request resubmits as a new revision', async () => {
    await stock(COKE, 100)
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const s = await T.submitTransfer(d.id, WAREHOUSE_STAFF, [line(COKE, 24)])
    await expect(T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'return' })).rejects.toThrow()
    const r = await T.reviewTransfer({ transferId: s.id, expectedRevision: s.revision, actor: MANAGER, action: 'return', note: 'ลดเหลือ 12' })
    expect(r).toMatchObject({ status: 'returned', returnReason: 'ลดเหลือ 12' })
    const again = await T.submitTransfer(s.id, WAREHOUSE_STAFF, [line(COKE, 12)])
    expect(again).toMatchObject({ status: 'pendingApproval', revision: 2 })
    // The old revision number no longer approves anything.
    await expect(T.reviewTransfer({ transferId: s.id, expectedRevision: 1, actor: MANAGER, action: 'approve' })).rejects.toThrow()
  })

  test('the same product twice, or a zero line, is refused', async () => {
    const d = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    await expect(T.saveItems(d.id, [line(COKE, 1), line(COKE, 2, undefined, 1)], WAREHOUSE_STAFF)).rejects.toThrow()
    await expect(T.saveItems(d.id, [{ ...line(COKE, 1), requestedQty: 0, dispatchQty: 0 }], WAREHOUSE_STAFF)).rejects.toThrow()
  })

  test('document numbers count TR-00001, TR-00002 per brand', async () => {
    const a = await T.createDraft({ fromLocationId: MAIN, toLocationId: SARASIN, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const b = await T.createDraft({ fromLocationId: MAIN, toLocationId: ONNUT, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    expect([a.docNo, b.docNo]).toEqual(['TR-00001', 'TR-00002'])
    expect(T.transferCounterFloors(docs())).toEqual([['transfer', 2]])
  })

  test('the active list is read by status, not by reading every transfer ever made', async () => {
    await stock(COKE, 100)
    await approved(SARASIN, [line(COKE, 24)])
    await T.createDraft({ fromLocationId: MAIN, toLocationId: ONNUT, dispatchDate: Date.now(), actor: WAREHOUSE_STAFF })
    const active = await T.listActiveTransfers(SARASIN)
    expect(active.map((t) => t.status)).toEqual(['inTransit'])
  })
})

describe('the ledger rows a transfer made', () => {
  test('cannot be edited or voided in place — only through the transfer', async () => {
    const { editMovement, voidMovement } = await import('../src/services/stock')
    await stock(COKE, 100)
    const t = await approved(SARASIN, [line(COKE, 24)])
    const row = movements().find((m) => m.transferId === t.id)!
    await expect(editMovement({ movementId: row.id, patch: { qty: 1 }, actor: ADMIN })).rejects.toThrow()
    await expect(voidMovement(row.id, ADMIN)).rejects.toThrow()
    expect(level(TRANSIT, COKE.id)).toBe(24)
  })
})
