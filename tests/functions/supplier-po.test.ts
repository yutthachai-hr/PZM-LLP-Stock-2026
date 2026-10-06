// The supplier-confirmation endpoints (functions/_lib/*): the signed link, the store's
// write allow-list, and the four handlers against an in-memory database and a fake clock.
//
//   npm test

import { describe, expect, test, beforeEach } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { assertServerWrite, brandCollection } from '../../functions/_lib/serverStore'
import { answerLink, decideDate, mintLink, viewLink, type Deps } from '../../functions/_lib/supplierPo'
import { signSupplierToken, verifySupplierToken } from '../../functions/_lib/supplierToken'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import type { PurchaseOrder } from '../../src/types'

const SECRET = 'test-secret-0123456789-abcdefghijklmnop'
const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 5, 3)), '10:00')
const day = (n: number) => bkkDayStart(NOW) + n * DAY_MS
const claims = { brand: 'pizza' as const, poId: 'po1', supplierId: 's1', version: 1, expMs: NOW + DAY_MS }

describe('the signed link', () => {
  test('round-trips, and fits in a LINE postback', async () => {
    const t = await signSupplierToken(claims, SECRET)
    expect(t.length).toBeLessThan(300)
    expect(await verifySupplierToken(t, SECRET, NOW)).toEqual({ ...claims, expMs: Math.floor(claims.expMs / 1000) * 1000 })
  })

  test('an edited, re-signed, expired or garbled token is nothing', async () => {
    const t = await signSupplierToken(claims, SECRET)
    const [v, payload, sig] = t.split('.')
    const other = await signSupplierToken({ ...claims, poId: 'po2' }, SECRET)
    expect(await verifySupplierToken(`${v}.${other.split('.')[1]}.${sig}`, SECRET, NOW)).toBeNull()
    expect(await verifySupplierToken(`${v}.${payload}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBeNull()
    expect(await verifySupplierToken(t, `${SECRET}x`, NOW)).toBeNull()
    expect(await verifySupplierToken(t, SECRET, claims.expMs + 1000)).toBeNull()
    for (const junk of ['', 'v1', 'v2.a.b', 'v1.!!.??', 'x'.repeat(500)]) expect(await verifySupplierToken(junk, SECRET, NOW)).toBeNull()
  })

  test('a short secret is refused outright', async () => {
    await expect(signSupplierToken(claims, 'short')).rejects.toThrow()
    expect(await verifySupplierToken(await signSupplierToken(claims, SECRET), 'short', NOW)).toBeNull()
  })
})

describe('what the functions may write (service accounts are outside the rules)', () => {
  test("an order's supplier fields, expectedAt and updatedAt — nothing else", () => {
    expect(() => assertServerWrite('purchaseOrders', { supplierConfirmationStatus: 'confirmed', expectedAt: 1, updatedAt: 1 }, 'patch')).not.toThrow()
    expect(() => assertServerWrite('lelapin__purchaseOrders', { deliveryDateHistory: [] }, 'patch')).not.toThrow()
    for (const field of ['status', 'lines', 'docNo', 'requestedQty', 'sentBy', 'receipts']) {
      expect(() => assertServerWrite('purchaseOrders', { [field]: 1 }, 'patch')).toThrow()
    }
  })
  test('new notifications; no other collection, no other kind of write', () => {
    expect(() => assertServerWrite('notifications', {}, 'create')).not.toThrow()
    expect(() => assertServerWrite('notifications', {}, 'patch')).toThrow()
    for (const c of ['users', 'stockMovements', 'stockLevels', 'suppliers', 'meta']) {
      expect(() => assertServerWrite(c, {}, 'patch')).toThrow()
      expect(() => assertServerWrite(c, {}, 'create')).toThrow()
    }
    expect(() => assertServerWrite('purchaseOrders', {}, 'create')).toThrow()
  })
  test('brand collections are named as the app names them', () => {
    expect(brandCollection('pizza', 'purchaseOrders')).toBe('purchaseOrders')
    expect(brandCollection('lelapin', 'purchaseOrders')).toBe('lelapin__purchaseOrders')
    expect(brandCollection('lelapin', 'users')).toBe('users')
  })
})

function baseOrder(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po1',
    docNo: 'PO-00007',
    supplierId: 's1',
    supplierName: 'BETAGRO',
    status: 'ordered',
    locationId: 'main',
    orderedAt: NOW,
    expectedAt: day(3),
    lines: [{ productId: 'p1', productName: 'BACON', unit: 'kg', entryUnit: 'แพ็ค', orderedQty: 4 }],
    sentBy: 'staff1',
    createdBy: 'staff1',
    createdByName: 'Nok',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

let db: ReturnType<typeof memoryServerStore>
let clock: number
let deps: Deps
const auth = (uid: string) => `Bearer ${uid}`

beforeEach(() => {
  clock = NOW
  let n = 0
  db = memoryServerStore({
    users: {
      staff1: { name: 'Nok', role: 'staff', active: true },
      boss: { name: 'Boss', role: 'manager', active: true },
      gone: { name: 'Gone', role: 'admin', active: false },
      revoked: { name: 'Rev', role: 'admin', active: true },
    },
    revokedUsers: { revoked: {} },
    purchaseOrders: { po1: baseOrder() as unknown as Record<string, unknown> },
    lelapin__purchaseOrders: { po1: baseOrder({ docNo: 'PO-00001' }) as unknown as Record<string, unknown> },
  })
  deps = {
    store: db,
    secret: SECRET,
    now: () => clock,
    makeId: () => `c${++n}`,
    verifyUser: async (h) => h?.replace(/^Bearer /, '') ?? null,
    origin: 'https://pzmstock.pages.dev',
  }
})

const po = () => db.data.get('purchaseOrders/po1')!.doc as unknown as PurchaseOrder
const notes = () => [...db.data.keys()].filter((k) => k.startsWith('notifications/')).map((k) => db.data.get(k)!.doc)

async function link(): Promise<string> {
  const r = await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: 'po1' })
  expect(r.status).toBe(200)
  return r.body.token as string
}

describe('POST /api/supplier-po/link', () => {
  test('needs an active, unrevoked signed-in user', async () => {
    for (const who of [null, 'nobody', 'gone', 'revoked']) {
      expect((await mintLink(deps, who ? auth(who) : null, { brand: 'pizza', poId: 'po1' })).status).toBe(401)
    }
  })
  test('gives one link per order version, pointing at /supplier/po/', async () => {
    const r = await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: 'po1' })
    expect(r.body.url).toBe(`https://pzmstock.pages.dev/supplier/po/${r.body.token}`)
    expect(po().supplierConfirmationStatus).toBe('waiting')
    const again = await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: 'po1' })
    expect(again.body.token).toBe(r.body.token)
  })
  test('refuses a cancelled order and bad input', async () => {
    db.touch('purchaseOrders', 'po1', { status: 'cancelled' })
    expect((await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: 'po1' })).status).toBe(409)
    expect((await mintLink(deps, auth('staff1'), { brand: 'nope', poId: 'po1' })).status).toBe(400)
    expect((await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: '../users/x' })).status).toBe(400)
    expect((await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: 'missing' })).status).toBe(404)
  })
  test('the brands stay apart', async () => {
    await mintLink(deps, auth('staff1'), { brand: 'lelapin', poId: 'po1' })
    expect(po().supplierLink).toBeUndefined()
    expect((db.data.get('lelapin__purchaseOrders/po1')!.doc as unknown as PurchaseOrder).supplierLink?.version).toBe(1)
  })
})

describe('GET /api/supplier/<token>', () => {
  test('shows the order without prices or people, and records the first view once', async () => {
    const token = await link()
    const r = await viewLink(deps, token)
    expect(r.status).toBe(200)
    expect(r.body.view).toMatchObject({
      company: 'Pizza Mania',
      supplierName: 'BETAGRO',
      docNo: 'PO-00007',
      status: 'waiting',
      requestedDate: '2026-10-08',
      autoUntil: '2026-10-10',
      items: [{ name: 'BACON', qty: 4, unit: 'แพ็ค' }],
    })
    expect(JSON.stringify(r.body)).not.toMatch(/staff1|Nok|sentBy|createdBy/)
    expect(po().supplierLink?.openedAt).toBe(NOW)
    // The first view is in the sender's bell (info: listed, never popped) — once.
    expect(notes()).toEqual([expect.objectContaining({ kind: 'supplierOpened', priority: 'info', to: { roles: ['manager', 'admin'], uids: ['staff1'] } })])
    const writes = db.writes
    await viewLink(deps, token)
    expect(db.writes).toBe(writes)
    expect(notes()).toHaveLength(1)
  })
  test('every link that is not ours gets the same 404', async () => {
    const token = await link()
    const forged = await signSupplierToken({ ...claims, supplierId: 's2' }, SECRET)
    const otherSecret = await signSupplierToken(claims, 'another-secret-0123456789-abcdefghijk')
    for (const t of ['garbage', forged, otherSecret, token.slice(0, -3) + 'abc']) {
      expect(await viewLink(deps, t)).toEqual({ status: 404, body: { error: 'not_found' } })
    }
  })
  test('a link that has run out, or an order that closed, says so', async () => {
    const token = await link()
    clock = day(4)
    expect((await viewLink(deps, token)).status).toBe(410)
    clock = NOW
    db.touch('purchaseOrders', 'po1', { status: 'received' })
    expect((await viewLink(deps, token)).body).toMatchObject({ error: 'closed', docNo: 'PO-00007' })
  })
})

describe('POST /api/supplier/<token>', () => {
  test('accept: confirmed, and the people who sent it and the managers hear about it', async () => {
    const token = await link()
    const r = await answerLink(deps, token, { action: 'accept', name: 'Somchai', requestId: 'req-00001' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ replayed: false, outcome: 'confirmed', view: { status: 'confirmed', confirmedDate: '2026-10-08' } })
    expect(po()).toMatchObject({ supplierConfirmationStatus: 'confirmed', confirmedDeliveryDate: day(3), expectedAt: day(3), requestedDeliveryDate: day(3) })
    expect(notes()).toHaveLength(1)
    expect(notes()[0]).toMatchObject({ kind: 'supplierConfirmed', category: 'supplier', to: { roles: ['manager', 'admin'], uids: ['staff1'] }, link: '/orders?po=po1', source: 'worker' })
  })

  test('a date two days later moves the calendar; the asked date stays', async () => {
    const token = await link()
    const r = await answerLink(deps, token, { action: 'propose', date: '2026-10-10', requestId: 'req-00002' })
    expect(r.body.outcome).toBe('changed')
    expect(po()).toMatchObject({ expectedAt: day(5), confirmedDeliveryDate: day(5), requestedDeliveryDate: day(3) })
    expect(notes()[0]).toMatchObject({ kind: 'supplierDateChanged', params: { date: '10/10/2026' } })
  })

  test('three days later waits for a หัวหน้า, who alone is told', async () => {
    const token = await link()
    const r = await answerLink(deps, token, { action: 'propose', date: '2026-10-11', note: 'รถเสีย', requestId: 'req-00003' })
    expect(r.body.outcome).toBe('pending')
    expect(po().expectedAt).toBe(day(3))
    expect(po().pendingDeliveryDate?.date).toBe(day(6))
    expect(notes()[0]).toMatchObject({ kind: 'supplierDatePending', priority: 'high', to: { roles: ['manager', 'admin'] } })
  })

  test('a retried submit is applied once and notifies once', async () => {
    const token = await link()
    const body = { action: 'propose', date: '2026-10-09', requestId: 'req-00004' }
    await answerLink(deps, token, body)
    const again = await answerLink(deps, token, body)
    expect(again.body).toMatchObject({ replayed: true, outcome: null })
    expect(po().deliveryDateHistory!.filter((h) => h.requestId === 'req-00004')).toHaveLength(1)
    expect(notes()).toHaveLength(1)
  })

  test('two answers racing: the loser re-reads and applies on top', async () => {
    const token = await link()
    const realPatch = db.patchIf.bind(db)
    let raced = false
    db.patchIf = async (c, id, f, t) => {
      if (!raced) {
        raced = true
        db.touch(c, id, { updatedAt: NOW + 1 })
      }
      return realPatch(c, id, f, t)
    }
    const r = await answerLink(deps, token, { action: 'accept', requestId: 'req-00005' })
    expect(r.status).toBe(200)
    expect(po().supplierConfirmationStatus).toBe('confirmed')
  })

  test('bad input, bad dates, a closed order', async () => {
    const token = await link()
    expect((await answerLink(deps, token, { action: 'delete', requestId: 'req-00006' })).status).toBe(400)
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'x' })).status).toBe(400)
    expect((await answerLink(deps, token, { action: 'propose', date: '10/11/2026', requestId: 'req-00007' })).body).toEqual({ error: 'invalid' })
    expect((await answerLink(deps, token, { action: 'propose', date: '2026-10-01', requestId: 'req-00008' })).body).toEqual({ error: 'past' })
    db.touch('purchaseOrders', 'po1', { status: 'cancelled' })
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'req-00009' })).status).toBe(410)
    expect(po().supplierConfirmationStatus).toBe('waiting')
  })

  test('a link from before an amendment is dead', async () => {
    const token = await link()
    db.touch('purchaseOrders', 'po1', { revision: 1, revisions: [{ rev: 1, at: NOW, by: 'staff1', byName: 'Nok', reason: 'x', changes: [] }] })
    await mintLink(deps, auth('staff1'), { brand: 'pizza', poId: 'po1' })
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'req-00010' })).status).toBe(404)
  })
})

describe('POST /api/supplier-po/decide', () => {
  async function pending(): Promise<string> {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', name: 'Somchai', requestId: 'req-00011' })
    return po().pendingDeliveryDate!.changeId
  }

  test('staff may not decide; a หัวหน้า may', async () => {
    const changeId = await pending()
    expect((await decideDate(deps, auth('staff1'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })).status).toBe(403)
    const r = await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })
    expect(r.status).toBe(200)
    expect(po()).toMatchObject({ supplierConfirmationStatus: 'changed', expectedAt: day(7), confirmedDeliveryDate: day(7), requestedDeliveryDate: day(3) })
    expect(notes().find((x) => x.kind === 'supplierDateApproved')).toMatchObject({ to: { uids: ['staff1'] } })
  })

  test('a refusal needs a reason; a stale one is refused', async () => {
    const changeId = await pending()
    expect((await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'reject' })).body).toEqual({ error: 'reasonRequired' })
    const r = await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'reject', reason: 'ไม่ได้' })
    expect(r.status).toBe(200)
    expect(po().expectedAt).toBe(day(3))
    expect((await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })).status).toBe(409)
    expect(notes().find((x) => x.kind === 'supplierDateRejected')).toMatchObject({ params: { reason: 'ไม่ได้' } })
  })
})
