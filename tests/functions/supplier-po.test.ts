// The supplier-confirmation endpoints (functions/_lib/*): the signed link, the store's
// write allow-list, and the four handlers against an in-memory database and a fake clock.
//
//   npm test

import { describe, expect, test, beforeEach } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { assertServerWrite, brandCollection } from '../../functions/_lib/serverStore'
import { answerLink as postAnswer, decideDate, mintLink, revokeLink, viewLink, type Deps } from '../../functions/_lib/supplierPo'
import { signSupplierToken, verifySupplierToken } from '../../functions/_lib/supplierToken'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import type { PurchaseOrder } from '../../src/types'
import { supplierStateOf } from '../../src/lib/supplierConfirmation'

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

/** Existing endpoint scenarios submit against the current synthetic snapshot.
 * Stale-state tests call postAnswer directly with the original page response. */
async function answerLink(d: Deps, token: string, body: Record<string, unknown>) {
  const c = await verifySupplierToken(token, d.secret, d.now())
  const row = c ? db.data.get(`${brandCollection(c.brand, 'purchaseOrders')}/${c.poId}`) : undefined
  return postAnswer(d, token, { expectedState: row ? supplierStateOf(row.doc as unknown as PurchaseOrder) : undefined, ...body })
}

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
  test('time does not end a link (owner, 21 Oct 2026); an order that closed says so', async () => {
    const token = await link()
    clock = day(40) // past the delivery day and the old 30-day token cap
    expect((await viewLink(deps, token)).status).toBe(200)
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

describe('supplier tabs must confirm the state they actually saw', () => {
  async function approvedFarDate() {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-11', requestId: 'stale-approve-1' })
    await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId: po().pendingDeliveryDate!.changeId, decision: 'approve' })
    return token
  }
  async function seen(token: string) {
    return ((await viewLink(deps, token)).body.view as { expectedState: string }).expectedState
  }

  test('an old tab cannot withdraw a pending date it never saw', async () => {
    const token = await approvedFarDate()
    const expectedState = await seen(token)
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', requestId: 'stale-other-tab' })
    const snapshot = structuredClone(po())
    const before = db.writes
    const r = await postAnswer(deps, token, { action: 'propose', date: '2026-10-11', requestId: 'stale-old-tab', expectedState })
    expect(r).toEqual({ status: 409, body: { error: 'stale_state' } })
    expect(po()).toEqual(snapshot)
    expect(db.writes).toBe(before)
  })

  test('a lost CAS race rechecks the seen state instead of withdrawing the winner', async () => {
    const token = await approvedFarDate()
    const expectedState = await seen(token)
    const patch = db.patchIf.bind(db)
    let raced = false
    db.patchIf = async (col, id, fields, time) => {
      if (!raced) {
        raced = true
        expect((await answerLink(deps, token, { action: 'propose', date: '2026-10-12', requestId: 'stale-race-winner' })).status).toBe(200)
      }
      return patch(col, id, fields, time)
    }
    // An in-range proposal would withdraw P, too; no answer may race blindly. (Before PO-00003 this
    // used 'accept', which is now refused outright while an approved date stands, before any write.)
    const r = await postAnswer(deps, token, { action: 'propose', date: '2026-10-09', requestId: 'stale-race-loser', expectedState })
    expect(r).toEqual({ status: 409, body: { error: 'stale_state' } })
    expect(po().pendingDeliveryDate?.date).toBe(day(7))
    expect(po().deliveryDateHistory!.some((h) => h.requestId === 'stale-race-loser')).toBe(false)
    expect(notes().filter((n) => n.kind === 'supplierDatePending')).toHaveLength(2)
  })

  test('a lost response replays its recorded requestId even after another answer', async () => {
    const token = await link()
    const expectedState = await seen(token)
    const body = { action: 'propose', date: '2026-10-11', requestId: 'lost-response-id', expectedState }
    expect((await postAnswer(deps, token, body)).status).toBe(200)
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', requestId: 'lost-response-later' })
    const snapshot = structuredClone(po())
    const before = db.writes
    expect((await postAnswer(deps, token, body)).body).toMatchObject({ replayed: true, outcome: null })
    expect(po()).toEqual(snapshot)
    expect(db.writes).toBe(before)
  })

  test('missing state fails closed, but an already-recorded retry is still safe', async () => {
    const token = await link()
    expect(await postAnswer(deps, token, { action: 'accept', requestId: 'missing-state-id' })).toEqual({ status: 409, body: { error: 'stale_state' } })
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'recorded-retry-id' })).status).toBe(200)
    const before = db.writes
    expect((await postAnswer(deps, token, { action: 'accept', requestId: 'recorded-retry-id' })).body.replayed).toBe(true)
    expect(db.writes).toBe(before)
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

// Owner, 12 Oct 2026: PPN SEAFOOD's confirmation of PO-00005 reached the bell at least five
// times. Exactly once per business event: the same answer again, from a retry, a second tab,
// another phone or a double tap, writes nothing and tells nobody.
describe('one confirmation, one notification', () => {
  const confirmed = () => notes().filter((x) => x.kind === 'supplierConfirmed')
  const supplierEntries = () => po().deliveryDateHistory!.filter((h) => h.source === 'supplier')
  /** Count the reads and the write attempts the handlers make. */
  function meter() {
    const m = { gets: 0, patchTries: 0 }
    const get = db.get.bind(db)
    const patchIf = db.patchIf.bind(db)
    db.get = (async (c: string, id: string) => {
      m.gets++
      return get(c, id)
    }) as typeof db.get
    db.patchIf = async (c, id, f, t) => {
      m.patchTries++
      return patchIf(c, id, f, t)
    }
    return m
  }
  /** Hold every reader of the order until `n` of them have read it: all see one version. */
  function readTogether(n: number) {
    const get = db.get.bind(db)
    const waiting: (() => void)[] = []
    let held = 0
    db.get = (async (c: string, id: string) => {
      const row = await get(c, id)
      // Only the first n reads of the order wait; the loser's re-read goes straight through.
      if (c === 'purchaseOrders' && held < n) {
        held++
        await new Promise<void>((go) => {
          waiting.push(go)
          if (waiting.length === n) waiting.forEach((f) => f())
        })
      }
      return row
    }) as typeof db.get
    return () => {
      db.get = get
    }
  }

  test('1. the first acceptance: one order write and one notification', async () => {
    const token = await link()
    const before = db.writes
    const r = await answerLink(deps, token, { action: 'accept', requestId: 'dup-0001' })
    expect(r.body).toMatchObject({ replayed: false, outcome: 'confirmed' })
    expect(db.writes - before).toBe(2)
    expect(confirmed()).toHaveLength(1)
    expect(supplierEntries()).toHaveLength(1)
  })

  test('2. the same requestId again writes nothing', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0002' })
    const before = db.writes
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'dup-0002' })).body).toMatchObject({ replayed: true, outcome: null })
    expect(db.writes).toBe(before)
  })

  test('3. a new requestId with the same answer: success, no new event', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0003' })
    const snapshot = structuredClone(po())
    const before = db.writes
    clock += 60_000
    const r = await answerLink(deps, token, { action: 'accept', requestId: 'dup-0004' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ replayed: true, unchanged: true, outcome: null, view: { status: 'confirmed', confirmedDate: '2026-10-08' } })
    expect(db.writes).toBe(before)
    expect(po()).toEqual(snapshot)
    expect(confirmed()).toHaveLength(1)
  })

  test('4. a double tap (the same request sent twice at once) lands once', async () => {
    const token = await link()
    const body = { action: 'accept', requestId: 'dup-0005' }
    const rs = await Promise.all([answerLink(deps, token, body), answerLink(deps, token, body)])
    expect(rs.map((r) => r.status)).toEqual([200, 200])
    expect(supplierEntries()).toHaveLength(1)
    expect(confirmed()).toHaveLength(1)
  })

  test('5. two tabs answering at the same moment: one wins, the other must refresh', async () => {
    const token = await link()
    const m = meter()
    const release = readTogether(2)
    const rs = await Promise.all([
      answerLink(deps, token, { action: 'accept', requestId: 'dup-tab-1' }),
      answerLink(deps, token, { action: 'accept', requestId: 'dup-tab-2' }),
    ])
    release()
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    expect(rs.find((r) => r.status === 409)?.body).toEqual({ error: 'stale_state' })
    // Both tried to write one snapshot; after losing CAS, a new request cannot apply
    // to the winner's unseen state. A same-ID lost-response retry remains safe.
    expect(m.patchTries).toBe(2)
    expect(rs.filter((r) => r.body.replayed === false)).toHaveLength(1)
    expect(supplierEntries()).toHaveLength(1)
    expect(confirmed()).toHaveLength(1)
  })

  test('6. five phones with five requestIds and five names: one confirmation', async () => {
    const token = await link()
    const expectedState = supplierStateOf(po())
    const before = db.writes
    let releaseLate: () => void
    const barrier = new Promise<void>((r) => {
      releaseLate = r
    })
    const realPatch = db.patchIf.bind(db)
    db.patchIf = async (c, id, f, t) => {
      const res = await realPatch(c, id, f, t)
      if (c === 'purchaseOrders' && res) releaseLate()
      return res
    }
    try {
      const rs = await Promise.all([
        answerLink(deps, token, { action: 'accept', name: 'คนที่ 1', requestId: 'dup-dev-1', expectedState }),
        ...[2, 3, 4, 5].map(async (i) => {
          await barrier
          return answerLink(deps, token, { action: 'accept', name: `คนที่ ${i}`, requestId: `dup-dev-${i}`, expectedState })
        }),
      ])
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409])
      expect(db.writes - before).toBe(2)
      expect(supplierEntries()).toHaveLength(1)
      expect(confirmed()).toHaveLength(1)
    } finally {
      db.patchIf = realPatch
    }
  })

  test('7. a lost response: the retry (same id) and a reload (new id) both find it done', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0006' }) // reply never arrived
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'dup-0006' })).body.replayed).toBe(true)
    expect((await answerLink(deps, token, { action: 'accept', requestId: 'dup-0007' })).body.unchanged).toBe(true)
    expect(confirmed()).toHaveLength(1)
  })

  test('8. a new delivery date after confirming is a new event', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0008' })
    const r = await answerLink(deps, token, { action: 'propose', date: '2026-10-09', requestId: 'dup-0009' })
    expect(r.body).toMatchObject({ replayed: false, outcome: 'changed' })
    expect(notes().filter((x) => x.kind === 'supplierDateChanged')).toHaveLength(1)
    await answerLink(deps, token, { action: 'propose', date: '2026-10-09', requestId: 'dup-0010' })
    expect(notes().filter((x) => x.kind === 'supplierDateChanged')).toHaveLength(1)
  })

  test('9. an amended order is confirmed again on its new link, and that is heard', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0011' })
    db.touch('purchaseOrders', 'po1', { revision: 1, revisions: [{ rev: 1, at: NOW, by: 'staff1', byName: 'Nok', reason: 'x', changes: [] }] })
    const next = await link()
    expect(next).not.toBe(token)
    expect(po().supplierConfirmationStatus).toBe('waiting')
    expect((await answerLink(deps, next, { action: 'accept', requestId: 'dup-0012' })).body).toMatchObject({ replayed: false, outcome: 'confirmed' })
    expect(confirmed()).toHaveLength(2)
    await answerLink(deps, next, { action: 'accept', requestId: 'dup-0013' })
    expect(confirmed()).toHaveLength(2)
  })

  test('10. the same date beyond the range, asked again: one request to the หัวหน้า', async () => {
    const token = await link()
    const rs = await Promise.all(
      ['dup-pend-1', 'dup-pend-2', 'dup-pend-3'].map((requestId) => answerLink(deps, token, { action: 'propose', date: '2026-10-11', requestId })),
    )
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.error === 'stale_state')).toBe(true)
    await answerLink(deps, token, { action: 'propose', date: '2026-10-11', note: 'ขอย้ำ', requestId: 'dup-pend-4' })
    expect(notes().filter((x) => x.kind === 'supplierDatePending')).toHaveLength(1)
    expect(po().deliveryDateHistory!.filter((h) => h.action === 'proposed')).toHaveLength(1)
    expect(po().deliveryDateHistory!.filter((h) => h.action === 'superseded')).toHaveLength(0)
  })

  test('11. the same order id and number in two brands stay two orders', async () => {
    const pizza = await link()
    const r = await mintLink(deps, auth('staff1'), { brand: 'lelapin', poId: 'po1' })
    const lelapin = r.body.token as string
    await answerLink(deps, pizza, { action: 'accept', requestId: 'dup-0014' })
    await answerLink(deps, pizza, { action: 'accept', requestId: 'dup-0015' })
    expect((await answerLink(deps, lelapin, { action: 'accept', requestId: 'dup-0016' })).body).toMatchObject({ replayed: false, outcome: 'confirmed' })
    const keys = [...db.data.keys()].filter((k) => k.includes('supplierConfirmed'))
    expect(keys.filter((k) => k.startsWith('notifications/'))).toHaveLength(1)
    expect(keys.filter((k) => k.startsWith('lelapin__notifications/'))).toHaveLength(1)
  })

  test('12. a different name or note alone leaves the order and its note as they were', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', name: 'Somchai', note: 'ส่งเช้า', requestId: 'dup-0017' })
    await answerLink(deps, token, { action: 'accept', name: 'Somsri', note: 'ส่งบ่าย', requestId: 'dup-0018' })
    expect(po()).toMatchObject({ supplierDeliveryNote: 'ส่งเช้า', supplierConfirmedBy: { via: 'link', name: 'Somchai' } })
    expect(confirmed()).toHaveLength(1)
  })

  test('13. the notifications already there, and who has read them, are left alone', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0019' })
    const id = [...db.data.keys()].find((k) => k.startsWith('notifications/supplierConfirmed'))!.split('/')[1]
    db.touch('notifications', id, { readBy: { staff1: NOW + 5 } })
    const before = structuredClone([...db.data.entries()].filter(([k]) => k.startsWith('notifications/')))
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0020' })
    expect([...db.data.entries()].filter(([k]) => k.startsWith('notifications/'))).toEqual(before)
  })

  test('14. an unchanged answer costs no more reads than the first, and no write', async () => {
    const token = await link()
    let m = meter()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0021' })
    const first = m.gets
    m = meter()
    await answerLink(deps, token, { action: 'accept', requestId: 'dup-0022' })
    expect(m.gets).toBeLessThanOrEqual(first)
    expect(m.patchTries).toBe(0)
  })

  test('15. a far date already approved, sent again from a stale tab: nothing re-opens', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-11', requestId: 'dup-far-1' })
    const changeId = po().pendingDeliveryDate!.changeId
    expect((await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })).status).toBe(200)
    const snapshot = structuredClone(po())
    const before = db.writes
    clock += 60_000
    const r = await answerLink(deps, token, { action: 'propose', date: '2026-10-11', requestId: 'dup-far-2' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ replayed: true, unchanged: true, outcome: null, view: { status: 'changed' } })
    expect(db.writes).toBe(before)
    expect(po()).toEqual(snapshot)
    expect(notes().filter((x) => x.kind === 'supplierDatePending')).toHaveLength(1)
  })

  test('16. going back to the far date already approved: no second request to the หัวหน้า', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-11', requestId: 'dup-far-3' })
    const changeId = po().pendingDeliveryDate!.changeId
    await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', requestId: 'dup-far-4' })
    expect(notes().filter((x) => x.kind === 'supplierDatePending')).toHaveLength(2)
    const r = await answerLink(deps, token, { action: 'propose', date: '2026-10-11', requestId: 'dup-far-5' })
    expect(r.body).toMatchObject({ replayed: false, outcome: 'changed', view: { status: 'changed', confirmedDate: '2026-10-11', agreedDate: '2026-10-11', pending: null } })
    expect(po().pendingDeliveryDate).toBeUndefined()
    expect(notes().filter((x) => x.kind === 'supplierDatePending')).toHaveLength(2)
  })
})

describe('POST /api/supplier-po/revoke (R30)', () => {
  test('a หัวหน้า takes the link back: the leaked URL is dead, a new one works, the answer stands', async () => {
    const old = await link()
    await answerLink(deps, old, { action: 'accept', requestId: 'req-before-revoke' })
    const r = await revokeLink(deps, auth('boss'), { brand: 'pizza', poId: 'po1' })
    expect(r.status).toBe(200)
    expect(po().supplierLink?.version).toBe(2)
    expect(po().revision ?? 0).toBe(0)
    expect(po().supplierConfirmationStatus).toBe('confirmed')
    expect(await viewLink(deps, old)).toEqual({ status: 404, body: { error: 'not_found' } })
    expect((await answerLink(deps, old, { action: 'propose', date: '2026-10-12', requestId: 'req-old-after-revoke' })).status).toBe(404)
    expect((await viewLink(deps, r.body.token as string)).status).toBe(200)
    expect(po().supplierActivity?.find((a) => a.kind === 'linkRevoked')).toMatchObject({ byName: 'Boss' })
  })
  test('staff, signed-out, a closed order or an order with no link are refused, writing nothing', async () => {
    expect((await revokeLink(deps, null, { brand: 'pizza', poId: 'po1' })).status).toBe(401)
    expect((await revokeLink(deps, auth('staff1'), { brand: 'pizza', poId: 'po1' })).status).toBe(403)
    expect((await revokeLink(deps, auth('boss'), { brand: 'pizza', poId: 'po1' })).status).toBe(409) // no link yet
    const token = await link()
    db.touch('purchaseOrders', 'po1', { status: 'received' })
    expect((await revokeLink(deps, auth('boss'), { brand: 'pizza', poId: 'po1' })).status).toBe(409)
    expect(po().supplierLink?.version).toBe(1)
    expect((await viewLink(deps, token)).status).toBe(410)
  })
  test('a past waiting date cannot be approved through the endpoint', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', name: 'Somchai', requestId: 'req-past-decide' })
    const changeId = po().pendingDeliveryDate!.changeId
    clock = day(9)
    expect(await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })).toMatchObject({ status: 422, body: { error: 'past' } })
    expect(po().pendingDeliveryDate?.changeId).toBe(changeId)
  })
})

describe('P0 PO-00003: an approved date stands at the endpoint', () => {
  async function approvedFar() {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', name: 'MMP', requestId: 'po3-e-propose' })
    const changeId = po().pendingDeliveryDate!.changeId
    expect((await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId, decision: 'approve' })).status).toBe(200)
    return token
  }
  test('reopening the link shows the approved date as agreed and says purchasing approved it', async () => {
    const token = await approvedFar()
    const view = (await viewLink(deps, token)).body.view as Record<string, unknown>
    expect(view).toMatchObject({ requestedDate: '2026-10-08', agreedDate: '2026-10-12', confirmedDate: '2026-10-12', agreedByPurchasing: true })
  })
  test('a fresh "accept" of the requested date is refused and changes nothing, rings nothing', async () => {
    const token = await approvedFar()
    const before = structuredClone(po())
    const bell = notes().length
    const r = await answerLink(deps, token, { action: 'accept', requestId: 'po3-e-stale-accept' })
    expect(r).toEqual({ status: 422, body: { error: 'agreed' } })
    expect(po()).toEqual(before)
    expect(notes()).toHaveLength(bell)
  })
  test('a page loaded before the approval cannot write its stale answer', async () => {
    const token = await link()
    await answerLink(deps, token, { action: 'propose', date: '2026-10-12', requestId: 'po3-e-propose-2' })
    const seen = ((await viewLink(deps, token)).body.view as { expectedState: string }).expectedState
    await decideDate(deps, auth('boss'), { brand: 'pizza', poId: 'po1', changeId: po().pendingDeliveryDate!.changeId, decision: 'approve' })
    const r = await postAnswer(deps, token, { action: 'accept', requestId: 'po3-e-old-tab', expectedState: seen })
    expect(r).toEqual({ status: 409, body: { error: 'stale_state' } })
    expect(po().confirmedDeliveryDate).toBe(day(7))
  })
})
