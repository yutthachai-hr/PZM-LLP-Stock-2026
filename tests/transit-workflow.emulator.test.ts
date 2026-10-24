import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import type { Product, StockLevel, StockLocation, StockMovement, TransferItem } from '../src/types'

const connection = vi.hoisted(() => ({ db: undefined as Firestore | undefined }))
vi.mock('../src/firebase/app', () => ({ getDb: () => {
  if (!connection.db) throw new Error('emulator identity not selected')
  return connection.db
} }))
vi.mock('../src/backend', async () => ({
  backend: (await import('../src/backend/firestore')).createFirestoreBackend(), BACKEND_MODE: 'cloud',
}))
// Delivery notifications are outside this stock integration test; no external send is allowed.
vi.mock('../src/services/notifications', () => ({ deliver: vi.fn(async () => {}) }))

const { createFirestoreBackend } = await import('../src/backend/firestore')
const { setActiveBrand, resolveCollection } = await import('../src/brand/brand')
const T = await import('../src/services/transfers')
const S = await import('../src/services/stock')
const { balancesFromLedger } = await import('../src/lib/levelKey')
const { stockView, stockValue } = await import('../src/lib/inventoryRules/stockView')
let env: RulesTestEnvironment
const actor = { id: 'r39-admin', name: 'Synthetic admin', role: 'admin' as const }
const product: Product = { id: 'p1', sku: 'R39', name: 'Synthetic flour', category: 'c', unit: 'KG', unitType: 'KG', minStock: 0, hasImage: false, active: true, cost: 37.25, createdAt: 1, updatedAt: 1 }
const locations: StockLocation[] = [
  { id: 'wh', name: 'Synthetic warehouse', type: 'warehouse', active: true, createdAt: 1 },
  { id: 'branch', name: 'Synthetic branch', type: 'branch', active: true, createdAt: 2 },
  { id: 'transit', name: 'Synthetic transit', type: 'transit', active: true, createdAt: 3 },
  { id: 'transit2', name: 'Synthetic second transit', type: 'transit', active: true, createdAt: 4 },
]
const line = (qty: number): TransferItem => ({ idx: 0, productId: product.id, productName: product.name, sku: product.sku, unit: 'KG', requestedQty: qty, dispatchQty: qty })
const db = () => createFirestoreBackend()

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^127\.0\.0\.1:8080$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('local emulator only')
  env = await initializeTestEnvironment({ projectId: 'pzm-rules-test', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } })
})
afterAll(async () => { connection.db = undefined; await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  setActiveBrand('pizza')
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore()
    await setDoc(doc(f, 'meta/bootstrap'), { claimedBy: actor.id, at: 1 })
    await setDoc(doc(f, 'users', actor.id), { name: actor.name, role: 'admin', active: true })
    for (const brand of ['pizza', 'lelapin'] as const) {
      await setDoc(doc(f, resolveCollection('products', brand), product.id), product)
      for (const loc of locations) await setDoc(doc(f, resolveCollection('locations', brand), loc.id), loc)
    }
  })
  // Match src/firebase/app.ts; optional undefined fields are omitted by the shipped client.
  connection.db = env.authenticatedContext(actor.id).firestore({ ignoreUndefinedProperties: true })
})

async function receive(qty = 100) {
  await S.receiveStock({ lines: [{ productId: product.id, productName: product.name, unit: 'KG', qty }], toLocationId: 'wh', date: Date.now(), actor })
}
async function dispatch(qty = 10) {
  const draft = await T.createDraft({ fromLocationId: 'wh', toLocationId: 'branch', dispatchDate: Date.now(), actor })
  const submitted = await T.submitTransfer(draft.id, actor, [line(qty)])
  return T.reviewTransfer({ transferId: draft.id, expectedRevision: submitted.revision, actor, action: 'approve' })
}
async function books(expected: { wh: number; transit: number; branch: number; transit2?: number; company?: number }) {
  const [levels, moves, sites] = await Promise.all([
    db().getAll<StockLevel>('stockLevels'), db().getAll<StockMovement>('stockMovements'), db().getAll<StockLocation>('locations'),
  ])
  const ledger = balancesFromLedger(moves)
  expect([...levels].map((l) => [l.id, l.qty]).sort()).toEqual([...ledger].map(([id, qty]) => [id, qty]).sort())
  const view = stockView({ levels, locations: sites, minOverrides: [] })
  for (const id of ['wh', 'branch', 'transit', 'transit2'] as const) expect(view.qtyAt(id, product.id)).toBeCloseTo(expected[id] ?? 0, 6)
  const company = expected.company ?? 100
  expect(view.companyQty(product.id)).toBeCloseTo(company, 6)
  expect(view.transitQty(product.id)).toBeCloseTo(expected.transit + (expected.transit2 ?? 0), 6)
  expect(stockValue([product], view.companyQty)).toBeCloseTo(company * 37.25, 6)
  return { levels, moves }
}

describe('real Firestore adapter + transaction + Rules transfer workflow', () => {
  test.each(['pizza', 'lelapin'] as const)('%s: dispatch and complete receipt preserve quantity, ledger and cents', async (brand) => {
    setActiveBrand(brand)
    await receive()
    const t = await dispatch()
    await books({ wh: 90, transit: 10, branch: 0 })
    await T.openReceiving(t.id, actor)
    const received = await T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })
    expect(received.status).toBe('completed')
    const b = await books({ wh: 90, transit: 0, branch: 10 })
    expect(b.moves.filter((m) => m.transferId === t.id).map((m) => [m.fromLocationId, m.toLocationId, m.qty])).toEqual([['wh', 'transit', 10], ['transit', 'branch', 10]])
  })

  test('partial receipt retains the remainder until a manager completes the receipt', async () => {
    await receive()
    const t = await dispatch()
    const partial = await T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 7 }] })
    expect(partial.status).toBe('discrepancy')
    await books({ wh: 90, transit: 3, branch: 7 })
    await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, actor, resolution: { code: 'WEIGHING_ERROR', note: 'Synthetic completion' } })
    await books({ wh: 90, transit: 0, branch: 10 })
  })

  test('unloaded goods return to origin without disposing of company stock', async () => {
    await receive()
    const t = await dispatch()
    await T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 0 }] })
    await T.resolveDiscrepancy({ transferId: t.id, itemIdx: 0, actor, resolution: { code: 'NOT_ACTUALLY_LOADED' } })
    await books({ wh: 100, transit: 0, branch: 0 })
  })

  test('pre-dispatch cancellation changes no stock; dispatched cancellation/reapproval is refused', async () => {
    await receive()
    const draft = await T.createDraft({ fromLocationId: 'wh', toLocationId: 'branch', dispatchDate: Date.now(), actor })
    await T.cancelTransfer(draft.id, actor, 'Synthetic duplicate draft')
    await books({ wh: 100, transit: 0, branch: 0 })
    const t = await dispatch()
    await expect(T.cancelTransfer(t.id, actor, 'Cannot cancel physical dispatch')).rejects.toThrow()
    await expect(T.reviewTransfer({ transferId: t.id, expectedRevision: t.revision, actor, action: 'approve' })).rejects.toThrow()
    await books({ wh: 90, transit: 10, branch: 0 })
    await T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })
    await expect(T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })).rejects.toThrow()
    await books({ wh: 90, transit: 0, branch: 10 })
  })

  test('closing a stocked branch after dispatch refuses receipt atomically; all ownership remains', async () => {
    await receive()
    await S.receiveStock({ lines: [{ productId: product.id, productName: product.name, unit: 'KG', qty: 5 }], toLocationId: 'branch', date: Date.now(), actor })
    const t = await dispatch()
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'locations', 'branch'), { ...locations[1], active: false }) })
    await expect(T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })).rejects.toThrow()
    await books({ wh: 90, transit: 10, branch: 5, company: 105 })
  })

  test('additional transit is counted once; moving it back allows the canonical receipt workflow', async () => {
    await receive()
    const t = await dispatch()
    const move = (fromLocationId: string, toLocationId: string) => S.issueStock({ lines: [{ productId: product.id, productName: product.name, unit: 'KG', qty: 3 }], fromLocationId, toLocationId, date: Date.now(), actor })
    await move('transit', 'transit2')
    await books({ wh: 90, transit: 7, transit2: 3, branch: 0 })
    await move('transit2', 'transit')
    await T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })
    await books({ wh: 90, transit: 0, branch: 10 })
  })

  test('negative historical transit anomaly is visible, never clamped; an impossible receipt rolls back', async () => {
    await receive()
    const t = await dispatch()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockLevels', 'transit__p1'), { id: 'transit__p1', locationId: 'transit', productId: 'p1', qty: -2, updatedBy: actor.id, updatedAt: Date.now() })
      await setDoc(doc(ctx.firestore(), 'stockMovements', 'historical-anomaly'), { id: 'historical-anomaly', docNo: 'IS-99999', type: 'issue', productId: 'p1', productName: product.name, unit: 'KG', qty: 12, fromLocationId: 'transit', date: Date.now(), byUserId: actor.id, byUserName: actor.name, createdAt: Date.now() })
    })
    await expect(T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })).rejects.toThrow()
    await books({ wh: 90, transit: -2, branch: 0, company: 88 })
  })

  test('switching brands cannot read or settle the other brand transfer', async () => {
    await receive()
    const t = await dispatch()
    setActiveBrand('lelapin')
    expect(await T.getTransfer(t.id)).toBeNull()
    await expect(T.confirmReceive({ transferId: t.id, actor, receivedLines: [{ idx: 0, receivedQty: 10 }] })).rejects.toThrow()
    expect(await db().getAll('stockLevels')).toEqual([])
    await receive(40)
    await books({ wh: 40, transit: 0, branch: 0, company: 40 })
    setActiveBrand('pizza')
    await books({ wh: 90, transit: 10, branch: 0 })
  })
})
