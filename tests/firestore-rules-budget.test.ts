// Firestore evaluates at most 1,000 expressions per request. The widest documents here —
// a purchase request and a purchase order carrying every optional field — went over that
// on update, and Firestore reports it as plain "Missing or insufficient permissions": the
// owner could not approve a request (17 Sep 2026), and a received order that came through
// a request and went out by LINE would have failed the same way. The ordinary rules tests
// never noticed because their documents are skeletal.
//
// These replay the two writes the way the app makes them (a full-document set inside a
// transaction), on documents as wide as the app can make them. If a rule grows and one of
// these fails with the budget message, split the validator further (see validShape).
//
//   npm run test:rules

import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, runTransaction } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, test } from 'vitest'

let env: RulesTestEnvironment
const ADMIN = 'uid-admin'
const MANAGER = 'uid-manager'
const STAFF = 'uid-staff'

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'pzm-rules-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
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
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
  })
})

const ts = () => Date.now()

/** Replace the whole document inside a transaction — what services/purchaseRequests.ts does. */
async function replace(uid: string, path: string, next: (cur: Record<string, unknown>) => Record<string, unknown>) {
  const db = env.authenticatedContext(uid).firestore()
  const ref = doc(db, path)
  await assertSucceeds(
    runTransaction(db, async (tx) => {
      const cur = (await tx.get(ref)).data()!
      tx.set(ref, next(cur))
    }),
  )
}

test('a manager and an admin can approve the widest purchase request', async () => {
  const item = (idx: number) => ({
    idx, productId: 'p' + idx, productName: 'X' + idx, sku: 'S' + idx, unit: 'KG', entryUnit: 'Carton',
    supplierId: 's' + (idx % 7), supplierName: 'S', supplierChoice: 'custom', requestedQty: 2, approvedQty: 2, note: 'n',
  })
  const pr = {
    id: 'pr1', docNo: 'PR-00001', status: 'pendingApproval', revision: 3, locationId: 'loc', note: 'order 17/9/69',
    items: Array.from({ length: 200 }, (_, i) => item(i)),
    requestedBy: STAFF, requestedByName: 'AA', submittedAt: ts(),
    returnReason: 'r', rejectReason: 'x', approvalNote: 'n', rejectedBy: 'u', rejectedByName: 'n', rejectedAt: ts(), orders: [],
    history: Array.from({ length: 499 }, (_, i) => ({ at: ts(), by: STAFF, byName: 'AA', action: i ? 'itemAdded' : 'created', detail: 'x', itemIdx: i, oldValue: 'a', newValue: 'b' })),
    createdBy: STAFF, createdByName: 'AA', createdAt: ts(), updatedAt: ts(),
  }
  for (const [uid, brand] of [[MANAGER, 'lelapin__purchaseRequests'], [ADMIN, 'purchaseRequests']] as const) {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), `${brand}/pr1`), pr))
    await replace(uid, `${brand}/pr1`, (cur) => ({
      ...cur, status: 'approved', approvedBy: uid, approvedByName: 'M', approvedAt: ts(), approvalNote: 'ok',
      history: [...(cur.history as unknown[]), { at: ts(), by: uid, byName: 'M', action: 'approved', newValue: 'ok' }], updatedAt: ts(),
    }))
  }
})

test('an admin can reopen the widest approved request (the dearest transition)', async () => {
  const pr = {
    id: 'pr1', docNo: 'PR-00001', status: 'approved', revision: 3, locationId: 'loc', note: 'n',
    items: [{ idx: 0, productId: 'p', productName: 'X', sku: 'S', unit: 'KG', supplierId: 's', supplierName: 'S', supplierChoice: 'primary', requestedQty: 1, approvedQty: 1 }],
    requestedBy: STAFF, requestedByName: 'AA', submittedAt: ts(), returnReason: 'r', approvalNote: 'n',
    approvedBy: MANAGER, approvedByName: 'M', approvedAt: ts(),
    history: Array.from({ length: 499 }, () => ({ at: ts(), by: STAFF, byName: 'AA', action: 'x', detail: 'x' })),
    createdBy: STAFF, createdByName: 'AA', createdAt: ts(), updatedAt: ts(),
  }
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'purchaseRequests/pr1'), pr))
  await replace(ADMIN, 'purchaseRequests/pr1', (cur) => {
    const { approvedBy: _a, approvedByName: _b, approvedAt: _c, ...rest } = cur
    void [_a, _b, _c]
    return { ...rest, status: 'pendingApproval', history: [...(cur.history as unknown[]), { at: ts(), by: ADMIN, byName: 'A', action: 'reopened' }], updatedAt: ts() }
  })
})

test('staff can receive the widest purchase order, and an admin can renumber it', async () => {
  const po = {
    id: 'po1', docNo: 'PO-00001', supplierId: 's1', supplierName: 'S', status: 'ordered', locationId: 'loc',
    orderedAt: ts(), lines: Array.from({ length: 200 }, (_, i) => ({ productId: 'p' + i, productName: 'X', sku: 'S', unit: 'KG', entryUnit: 'Carton', qty: 2, note: 'n' })),
    note: 'n', eventId: 'e1', batchId: 'b1', requestId: 'r1', approvedBy: STAFF, approvedByName: 'AA', approvedAt: ts(),
    shareStatus: 'sent', shareOpenedAt: ts(), sentAt: ts(), sentBy: STAFF, sentByName: 'AA', imageVersion: 3,
    createdBy: STAFF, createdByName: 'AA', createdAt: ts(), updatedAt: ts(),
  }
  for (const brand of ['purchaseOrders', 'lelapin__purchaseOrders']) {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), `${brand}/po1`), po))
    await replace(STAFF, `${brand}/po1`, (cur) => ({
      ...cur, status: 'received', invoiceNo: 'INV-1', receivedAt: ts(), receivedBy: STAFF, receivedByName: 'AA',
      movementDocNo: 'RCV-00001', updatedAt: ts(),
    }))
    await replace(ADMIN, `${brand}/po1`, (cur) => ({ ...cur, docNo: 'PO-00002', updatedAt: ts() }))
    // The signature on the receipt still cannot be moved to someone else.
    await assertFails(updateDoc(doc(env.authenticatedContext(MANAGER).firestore(), `${brand}/po1`), { receivedBy: ADMIN, updatedAt: ts() }))
  }
})
