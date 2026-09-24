// What firestore.rules enforces for transfers (24 Sep 2026), against the real rules engine.
//
//   npm run test:rules      (starts the emulator, needs Java)
//
// For someone writing to the database directly with their own token: staff move stock
// between sites only through a transfer; a transfer is born an empty draft in the
// requester's name; approval is a manager's, signed by them; receipt belongs to the
// destination's people; settling a problem is a manager's; a transfer's ledger rows are
// never edited in place. Each document here is shaped like what services/transfers.ts
// writes, so a refusal is about permission and not about a skeleton document.

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'

let env: RulesTestEnvironment

const ADMIN = 'uid-admin'
const MANAGER = 'uid-manager'
const WAREHOUSE = 'uid-wh' // staff at the main warehouse
const SARASIN = 'uid-sr' // staff at Sarasin
const ONNUT = 'uid-on' // staff at On Nut
const ANYWHERE = 'uid-any' // staff with no sites assigned

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'pzm-rules-test',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => env?.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: Date.now() })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Admin', role: 'admin', active: true })
    await setDoc(doc(db, 'users', MANAGER), { name: 'Manager', role: 'manager', active: true })
    await setDoc(doc(db, 'users', WAREHOUSE), { name: 'WH', role: 'staff', active: true, siteIds: ['main'] })
    await setDoc(doc(db, 'users', SARASIN), { name: 'SR', role: 'staff', active: true, siteIds: ['sarasin'] })
    await setDoc(doc(db, 'users', ONNUT), { name: 'ON', role: 'staff', active: true, siteIds: ['onnut'] })
    await setDoc(doc(db, 'users', ANYWHERE), { name: 'Any', role: 'staff', active: true })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const ts = () => Date.now()
const h = (by: string, action: string) => ({ at: ts(), by, byName: 'x', action })
const item = { idx: 0, productId: 'p1', productName: 'COKE', sku: 'BEV', unit: 'EA', requestedQty: 24, dispatchQty: 24 }

function draft(id: string, by = WAREHOUSE, over: Record<string, unknown> = {}) {
  return {
    id,
    docNo: 'TR-00001',
    status: 'draft',
    revision: 1,
    fromLocationId: 'main',
    toLocationId: 'sarasin',
    dispatchDate: ts(),
    requestedBy: by,
    requestedByName: 'WH',
    items: [],
    history: [h(by, 'created')],
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

type Doc = ReturnType<typeof draft>

const pending = (id: string): Doc => draft(id, WAREHOUSE, { status: 'pendingApproval', items: [item], submittedAt: ts(), history: [h(WAREHOUSE, 'created'), h(WAREHOUSE, 'submitted')] })
const inTransit = (id: string): Doc =>
  ({ ...pending(id), status: 'inTransit', approvedBy: MANAGER, approvedByName: 'Manager', approvedAt: ts(), items: [{ ...item, inTransitQty: 24 }] }) as Doc

async function seedDoc(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data)
  })
}

/** The same document, moved on one step by `by`, the history one entry longer. */
const step = (d: Doc, by: string, patch: Record<string, unknown>) => ({ ...d, ...patch, history: [...d.history, h(by, 'x')], updatedAt: ts() })

describe('creating a transfer', () => {
  test('staff file an empty draft in their own name', async () => {
    await assertSucceeds(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), draft('t1')))
    await assertSucceeds(setDoc(doc(as(WAREHOUSE), 'lelapin__transfers/t1'), draft('t1')))
  })

  test('not in a colleague’s name, not born approved, not to the same site', async () => {
    await assertFails(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), draft('t1', SARASIN)))
    await assertFails(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), inTransit('t1')))
    await assertFails(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), draft('t1', WAREHOUSE, { toLocationId: 'main' })))
  })

  test('a manager may create a leg that starts in transit, naming its parent, signed by them', async () => {
    const leg = { ...inTransit('t2'), requestedBy: MANAGER, approvedBy: MANAGER, parentId: 't1', legKind: 'forward', fromLocationId: 'onnut' }
    await assertSucceeds(setDoc(doc(as(MANAGER), 'transfers/t2'), leg))
    await assertFails(setDoc(doc(as(WAREHOUSE), 'transfers/t3'), { ...leg, id: 't3', requestedBy: WAREHOUSE, approvedBy: WAREHOUSE }))
    const { parentId: _p, ...orphan } = leg
    await assertFails(setDoc(doc(as(MANAGER), 'transfers/t4'), { ...orphan, id: 't4' }))
  })
})

describe('the review', () => {
  test('the requester submits; a manager approves, returns or rejects, in their own name', async () => {
    const d = draft('t1')
    await seedDoc('transfers/t1', d)
    const p = step(d, WAREHOUSE, { status: 'pendingApproval', items: [item], submittedAt: ts() })
    await assertSucceeds(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), p))
    const approve = step(p as Doc, MANAGER, { status: 'inTransit', approvedBy: MANAGER, approvedByName: 'Manager', approvedAt: ts() })
    await assertFails(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), { ...approve, approvedBy: WAREHOUSE }))
    await assertFails(setDoc(doc(as(ADMIN), 'transfers/t1'), approve)) // signed as someone else
    await assertSucceeds(setDoc(doc(as(MANAGER), 'transfers/t1'), approve))
  })

  test('return and reject are the manager’s; a rejection is reopened only by an admin', async () => {
    const p = pending('t1')
    await seedDoc('transfers/t1', p)
    await assertFails(setDoc(doc(as(WAREHOUSE), 'transfers/t1'), step(p, WAREHOUSE, { status: 'returned', returnReason: 'x' })))
    await assertSucceeds(setDoc(doc(as(MANAGER), 'transfers/t1'), step(p, MANAGER, { status: 'rejected', rejectReason: 'ไม่จำเป็น' })))
    const rejected = step(p, MANAGER, { status: 'rejected', rejectReason: 'ไม่จำเป็น' }) as Doc
    await seedDoc('transfers/t1', rejected)
    await assertFails(setDoc(doc(as(MANAGER), 'transfers/t1'), step(rejected, MANAGER, { status: 'pendingApproval', revision: 2 })))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'transfers/t1'), step(rejected, ADMIN, { status: 'pendingApproval', revision: 2 })))
  })

  test('once stock has moved it cannot be cancelled, and the route never changes after draft', async () => {
    const t = inTransit('t1')
    await seedDoc('transfers/t1', t)
    await assertFails(setDoc(doc(as(MANAGER), 'transfers/t1'), step(t, MANAGER, { status: 'cancelled', cancelReason: 'x', cancelledBy: MANAGER, cancelledAt: ts() })))
    await assertFails(setDoc(doc(as(MANAGER), 'transfers/t1'), step(t, MANAGER, { toLocationId: 'onnut' })))
  })

  test('the history never shrinks', async () => {
    const d = draft('t1')
    await seedDoc('transfers/t1', d)
    await assertFails(updateDoc(doc(as(WAREHOUSE), 'transfers/t1'), { history: [], updatedAt: ts() }))
  })
})

describe('receipt and problems', () => {
  test('the destination’s people receive; another branch’s staff do not; no sites assigned = every site', async () => {
    const t = inTransit('t1')
    await seedDoc('transfers/t1', t)
    const got = step(t, SARASIN, { status: 'completed', receivedBy: SARASIN, receivedByName: 'SR', receivedAt: ts() })
    await assertFails(setDoc(doc(as(ONNUT), 'transfers/t1'), { ...got, receivedBy: ONNUT }))
    await assertSucceeds(setDoc(doc(as(SARASIN), 'transfers/t1'), got))
    await seedDoc('transfers/t1', t)
    await assertSucceeds(setDoc(doc(as(ANYWHERE), 'transfers/t1'), { ...got, receivedBy: ANYWHERE }))
  })

  test('the branch that found the goods may report them — the document stays in transit', async () => {
    const t = inTransit('t1')
    await seedDoc('transfers/t1', t)
    await assertSucceeds(setDoc(doc(as(ONNUT), 'transfers/t1'), step(t, ONNUT, { items: [{ ...item, inTransitQty: 24, misroutes: [{ id: 'm', qty: 2 }] }] })))
  })

  test('settling a problem is the manager’s; the leg that arrives last closes its parent', async () => {
    const received = { ...inTransit('t1'), status: 'pendingDiscrepancyApproval', receivedBy: SARASIN, receivedByName: 'SR', receivedAt: ts() } as Doc
    await seedDoc('transfers/t1', received)
    await assertFails(setDoc(doc(as(SARASIN), 'transfers/t1'), step(received, SARASIN, { status: 'completed' })))
    await assertSucceeds(setDoc(doc(as(MANAGER), 'transfers/t1'), step(received, MANAGER, { status: 'resolved' })))
    const waiting = step(received, MANAGER, { status: 'resolved' }) as Doc
    await seedDoc('transfers/t1', waiting)
    await assertSucceeds(setDoc(doc(as(SARASIN), 'transfers/t1'), step(waiting, SARASIN, { status: 'completed' })))
  })
})

describe('the ledger rows of a transfer', () => {
  const mv = (id: string, by: string, over: Record<string, unknown> = {}) => ({
    id, docNo: 'IS-00001', type: 'issue', productId: 'p1', productName: 'COKE', unit: 'EA', qty: 24,
    fromLocationId: 'main', toLocationId: 'transit', date: ts(), byUserId: by, byUserName: 'x', createdAt: ts(), ...over,
  })

  test('staff move stock between sites only through a transfer; a manager may still do it directly', async () => {
    await assertFails(setDoc(doc(as(WAREHOUSE), 'stockMovements/m1'), mv('m1', WAREHOUSE, { toLocationId: 'sarasin' })))
    await assertSucceeds(setDoc(doc(as(WAREHOUSE), 'stockMovements/m2'), mv('m2', WAREHOUSE, { transferId: 't1' })))
    await assertSucceeds(setDoc(doc(as(MANAGER), 'stockMovements/m3'), mv('m3', MANAGER, { toLocationId: 'sarasin' })))
    // Using stock up at the counter (no destination) is still everyday work.
    const { toLocationId: _to, ...used } = mv('m4', WAREHOUSE, { type: 'consume', fromLocationId: 'main' })
    await assertSucceeds(setDoc(doc(as(WAREHOUSE), 'stockMovements/m4'), used))
  })

  test('are never edited or voided in place, admins included', async () => {
    await seedDoc('stockMovements/m1', mv('m1', WAREHOUSE, { transferId: 't1' }))
    const edit = { qty: 20, edits: [{ by: ADMIN, byName: 'A', at: ts(), changed: ['qty'] }], updatedBy: ADMIN, updatedAt: ts() }
    await assertFails(updateDoc(doc(as(ADMIN), 'stockMovements/m1'), edit))
    await assertFails(updateDoc(doc(as(ADMIN), 'stockMovements/m1'), { voided: true, updatedBy: ADMIN, updatedAt: ts() }))
  })
})
