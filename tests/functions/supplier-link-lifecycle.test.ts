// P0 hotfix (owner, 21 Oct 2026): a supplier link stays usable for as long as its order is
// open — not until a delivery day or a 30-day token cap. Pizza Mania PO-00002: opened 16 Oct,
// answered 21 Oct, refused "ลิงก์นี้หมดอายุแล้ว". Synthetic orders and a fake clock only.
//
//   npm test

import { beforeEach, describe, expect, test } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { answerLink, mintLink, viewLink, type Deps } from '../../functions/_lib/supplierPo'
import { signSupplierToken, verifySupplierSignature, verifySupplierToken } from '../../functions/_lib/supplierToken'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import { supplierStateOf } from '../../src/lib/supplierConfirmation'
import type { PurchaseOrder } from '../../src/types'

const SECRET = 'test-secret-0123456789-abcdefghijklmnop'
const OCT16 = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 16, 3)), '09:00')
const day = (n: number) => bkkDayStart(OCT16) + n * DAY_MS
const OCT21 = bkkAtTime(day(5), '14:00')

function order(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po2', docNo: 'PO-00002', supplierId: 's1', supplierName: 'SYNTHETIC SUPPLIER', status: 'ordered', locationId: 'main',
    orderedAt: OCT16, expectedAt: day(2), // asked for 18 Oct
    lines: [{ productId: 'p1', productName: 'SYNTHETIC CHEESE', unit: 'kg', orderedQty: 10 }],
    sentBy: 'staff1', createdBy: 'staff1', createdByName: 'Nok', createdAt: OCT16, updatedAt: OCT16, ...over,
  }
}

let db: ReturnType<typeof memoryServerStore>
let clock: number
let deps: Deps
beforeEach(() => {
  clock = OCT16
  let n = 0
  db = memoryServerStore({
    users: { staff1: { name: 'Nok', role: 'staff', active: true } },
    purchaseOrders: { po2: order() as unknown as Record<string, unknown> },
    lelapin__purchaseOrders: { po2: order({ docNo: 'LL-00002' }) as unknown as Record<string, unknown> },
  })
  deps = { store: db, secret: SECRET, now: () => clock, makeId: () => `c${++n}`, verifyUser: async (h) => h?.replace(/^Bearer /, '') ?? null, origin: 'https://example.test' }
})
const po = (col = 'purchaseOrders') => db.data.get(`${col}/po2`)!.doc as unknown as PurchaseOrder
const mint = async () => {
  const r = await mintLink(deps, 'Bearer staff1', { brand: 'pizza', poId: 'po2' })
  expect(r.status).toBe(200)
  return r.body as { token: string; url: string }
}
const answer = (token: string, body: Record<string, unknown>) => answerLink(deps, token, { expectedState: supplierStateOf(po()), ...body })

describe('a link lives as long as its open order', () => {
  test('1. opened 16 Oct, answered 21 Oct: the page loads and a new date can be proposed', async () => {
    const { token } = await mint()
    expect((await viewLink(deps, token)).status).toBe(200)
    clock = OCT21
    const view = await viewLink(deps, token)
    expect(view.status).toBe(200)
    const r = await answer(token, { action: 'propose', date: '2026-10-23', requestId: 'oct21-propose-1' })
    expect(r.status).toBe(200)
  })

  test('2+14. after the asked date: accepting the past date is refused, proposing a new one follows the approval rule and keeps the history', async () => {
    const { token } = await mint()
    clock = OCT21
    expect((await answer(token, { action: 'accept', requestId: 'oct21-accept-1' })).body).toEqual({ error: 'past' })
    const r = await answer(token, { action: 'propose', date: '2026-10-24', requestId: 'oct21-propose-2' })
    expect(r.body).toMatchObject({ outcome: 'pending' }) // 6 days after the asked 18 Oct > 2-day range
    expect(po().requestedDeliveryDate).toBe(day(2))
    expect(po().confirmedDeliveryDate).toBeUndefined()
    expect(po().deliveryDateHistory?.map((h) => h.action)).toEqual(['requested', 'proposed'])
  })

  test('3+4. the same signed URL works 45 days later, past its token timestamp, without re-issuing', async () => {
    const { token } = await mint()
    const before = po().supplierLink
    clock = OCT16 + 45 * DAY_MS
    expect((await viewLink(deps, token)).status).toBe(200)
    expect((await answer(token, { action: 'propose', date: '2026-12-02', requestId: 'late-propose-1' })).status).toBe(200)
    expect(po().supplierLink?.version).toBe(before?.version)
  })

  test('5. sending the sheet again for an unchanged order gives the same URL and writes nothing, however late', async () => {
    const first = await mint()
    const writes = db.writes
    clock = OCT16 + 45 * DAY_MS
    const again = await mint()
    expect(again.token).toBe(first.token)
    expect(db.writes).toBe(writes)
  })

  test('opening an old link again does not reset what the supplier answered', async () => {
    const { token } = await mint()
    await answer(token, { action: 'accept', requestId: 'first-accept-1' })
    clock = OCT21
    await viewLink(deps, token)
    expect(po().supplierConfirmationStatus).toBe('confirmed')
  })

  test('6. a part-received order with goods still owed keeps its link', async () => {
    const { token } = await mint()
    db.touch('purchaseOrders', 'po2', { receipts: [{ docNo: 'RC-1', date: OCT16, invoiceNo: 'I', byId: 'u', byName: 'u', lines: [] }] })
    clock = OCT21
    expect((await viewLink(deps, token)).status).toBe(200)
    expect((await answer(token, { action: 'propose', date: '2026-10-25', requestId: 'partial-propose-1' })).status).toBe(200)
    expect((await mint()).token).toBe(token)
  })
})

describe('a link ends with its order, its version or its supplier', () => {
  test('7. fully received closes it', async () => {
    const { token } = await mint()
    db.touch('purchaseOrders', 'po2', { status: 'received' })
    expect((await viewLink(deps, token)).body).toMatchObject({ error: 'closed' })
    expect((await answer(token, { action: 'propose', date: '2026-10-25', requestId: 'recv-propose-1' })).status).toBe(410)
  })
  test('8. cancelled closes it', async () => {
    const { token } = await mint()
    db.touch('purchaseOrders', 'po2', { status: 'cancelled' })
    expect((await viewLink(deps, token)).status).toBe(410)
  })
  test('9. a revised order kills the old version', async () => {
    const { token } = await mint()
    db.touch('purchaseOrders', 'po2', { revision: 1, revisions: [{ rev: 1, at: OCT16, by: 'staff1', byName: 'Nok', reason: 'x', changes: [] }] })
    expect((await viewLink(deps, token)).status).toBe(404)
    const fresh = await mint()
    expect(fresh.token).not.toBe(token)
    expect((await viewLink(deps, token)).status).toBe(404)
  })
  test('10. a changed supplier rejects the old token', async () => {
    const { token } = await mint()
    db.touch('purchaseOrders', 'po2', { supplierId: 's2' })
    expect((await viewLink(deps, token)).status).toBe(404)
  })
  test('11. forged, edited and wrongly-keyed tokens are nothing, expired or not', async () => {
    await mint()
    const v = po().supplierLink!.version
    const claims = { brand: 'pizza' as const, poId: 'po2', supplierId: 's1', version: v, expMs: OCT16 - DAY_MS }
    const wrongKey = await signSupplierToken(claims, 'another-secret-0123456789-abcdefghijk')
    const genuine = await signSupplierToken(claims, SECRET)
    const [h, , sig] = genuine.split('.')
    const otherPayload = (await signSupplierToken({ ...claims, poId: 'po9' }, SECRET)).split('.')[1]
    clock = OCT21
    for (const t of [wrongKey, `${h}.${otherPayload}.${sig}`, genuine.slice(0, -2) + 'AA', 'v1.x.y', 'v2.' + genuine.slice(3)]) {
      expect(await viewLink(deps, t)).toEqual({ status: 404, body: { error: 'not_found' } })
    }
    // The genuine, long-expired token of the current version still opens the open order.
    expect((await viewLink(deps, genuine)).status).toBe(200)
  })
  test('12. an order closed between the read and the write refuses the answer inside the write', async () => {
    const { token } = await mint()
    const get = db.get.bind(db)
    let reads = 0
    db.get = (async (c: string, id: string) => {
      const r = await get(c, id)
      if (c === 'purchaseOrders' && ++reads === 1) db.touch('purchaseOrders', 'po2', { status: 'received' })
      return r
    }) as typeof db.get
    const r = await answer(token, { action: 'propose', date: '2026-10-25', requestId: 'race-close-1' })
    expect(r.status).toBe(410)
    expect(po().deliveryDateHistory?.some((h) => h.requestId === 'race-close-1')).toBeFalsy()
  })
  test('13. a double tap after the old expiry lands once', async () => {
    const { token } = await mint()
    clock = OCT16 + 40 * DAY_MS
    const body = { action: 'propose', date: '2026-11-30', requestId: 'double-late-1' }
    await Promise.all([answer(token, body), answer(token, body)])
    expect(po().deliveryDateHistory?.filter((h) => h.requestId === 'double-late-1')).toHaveLength(1)
  })
  test('15. a pizza link never reads or writes the Le Lapin order of the same id', async () => {
    const { token } = await mint()
    const ll = JSON.stringify(po('lelapin__purchaseOrders'))
    clock = OCT21
    await answer(token, { action: 'propose', date: '2026-10-25', requestId: 'brand-iso-1' })
    expect(JSON.stringify(po('lelapin__purchaseOrders'))).toBe(ll)
  })
})

describe('only the order-scoped endpoint ignores the token timestamp', () => {
  test('verifySupplierToken still enforces expiry; verifySupplierSignature checks everything else', async () => {
    const claims = { brand: 'pizza' as const, poId: 'po2', supplierId: 's1', version: 1, expMs: OCT16 }
    const t = await signSupplierToken(claims, SECRET)
    expect(await verifySupplierToken(t, SECRET, OCT21)).toBeNull()
    expect(await verifySupplierSignature(t, SECRET)).toMatchObject({ poId: 'po2', version: 1 })
    expect(await verifySupplierSignature(t, 'another-secret-0123456789-abcdefghijk')).toBeNull()
    expect(await verifySupplierSignature(t.slice(0, -2) + 'AA', SECRET)).toBeNull()
  })
})
