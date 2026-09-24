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

test('staff can check in one more delivery on the widest partly received order (24 Sep 2026)', async () => {
  // A PO delivered in many goes: forty receipts of every line, paperwork on each, and the
  // order still open. The next delivery appends one; the one after that closes it short.
  const lines = Array.from({ length: 200 }, (_, i) => ({ productId: 'p' + i, productName: 'X', sku: 'S', unit: 'KG', entryUnit: 'Carton', orderedQty: 50, receivedQty: 40, baseQty: 100, note: 'n' }))
  const receipt = (n: number) => ({ docNo: 'RC-' + n, date: ts(), invoiceNo: 'IV-' + n, byId: STAFF, byName: 'AA', lines: lines.map((l) => ({ productId: l.productId, qty: 1, note: 'short' })) })
  const po = {
    id: 'po1', docNo: 'PO-00001', supplierId: 's1', supplierName: 'S', status: 'ordered', locationId: 'loc',
    orderedAt: ts(), expectedAt: ts(), lines, note: 'n', eventId: 'e1', batchId: 'b1', requestId: 'r1', approvedBy: STAFF, approvedByName: 'AA', approvedAt: ts(),
    shareStatus: 'sent', shareOpenedAt: ts(), sentAt: ts(), sentBy: STAFF, sentByName: 'AA', imageVersion: 3,
    revision: 2, revisions: Array.from({ length: 49 }, (_, i) => ({ rev: i, at: ts(), by: STAFF, byName: 'AA', reason: 'r', changes: [] })),
    invoiceNo: 'IV-40', movementDocNo: 'RC-40', receivedAt: ts(), receivedBy: STAFF, receivedByName: 'AA',
    receipts: Array.from({ length: 40 }, (_, i) => receipt(i + 1)),
    createdBy: STAFF, createdByName: 'AA', createdAt: ts(), updatedAt: ts(),
  }
  for (const brand of ['purchaseOrders', 'lelapin__purchaseOrders']) {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), `${brand}/po1`), po))
    await replace(STAFF, `${brand}/po1`, (cur) => ({
      ...cur, lines: (cur.lines as typeof lines).map((l) => ({ ...l, receivedQty: 41 })),
      receipts: [...(cur.receipts as unknown[]), receipt(41)], invoiceNo: 'IV-41', movementDocNo: 'RC-41',
      receivedAt: ts(), receivedBy: STAFF, receivedByName: 'AA', updatedAt: ts(),
    }))
    await replace(STAFF, `${brand}/po1`, (cur) => ({
      ...cur, lines: (cur.lines as typeof lines).map((l) => ({ ...l, receivedQty: 42 })),
      receipts: [...(cur.receipts as unknown[]), receipt(42)], invoiceNo: 'IV-42', movementDocNo: 'RC-42',
      receivedAt: ts(), receivedBy: STAFF, receivedByName: 'AA', status: 'received',
      closedShortReason: 'r'.repeat(2000), closedShortBy: STAFF, closedShortByName: 'AA', closedShortAt: ts(), updatedAt: ts(),
    }))
  }
})

test('staff can file the widest receipt row with all its paperwork', async () => {
  const db = env.authenticatedContext(STAFF).firestore()
  const row = (i: number) => ({
    id: 'm' + i, docNo: 'RC-00001', type: 'receive', productId: 'p' + i, productName: 'X'.repeat(300), unit: 'KG', entryUnit: 'Carton', entryQty: 2, qty: 48,
    toLocationId: 'loc', note: 'n'.repeat(2000), hasPhoto: true,
    supplierId: 's'.repeat(200), supplierName: 'S'.repeat(200), invoiceNo: 'I'.repeat(100), docDate: ts(), poId: 'p'.repeat(200), poDocNo: 'PO-00001',
    date: ts(), byUserId: STAFF, byUserName: 'AA', createdAt: ts(),
  })
  await assertSucceeds(runTransaction(db, async (tx) => {
    for (let i = 0; i < 40; i++) tx.set(doc(db, 'stockMovements/m' + i), row(i))
  }))
})

test('staff can finish the widest task and a manager can move it', async () => {
  const uids = Array.from({ length: 50 }, (_, i) => (i === 0 ? STAFF : 'uid-' + i))
  const task = {
    id: 'sc__sched__20260917', docNo: undefined, title: 'x'.repeat(300), type: 'stockCount', locationId: 'loc',
    startAt: ts(), dueAt: ts() + 3_600_000, status: 'inProgress', priority: 'critical',
    assignedTo: uids, assignedToName: 'a'.repeat(1000), note: 'n'.repeat(2000), productId: 'p', supplierId: 's',
    sourceType: 'schedule', sourceId: 'sched', scheduleId: 'sched', refKey: 'sc__sched__20260917', requiresApproval: true,
    history: Array.from({ length: 99 }, () => ({ at: ts(), by: STAFF, byName: 'S', action: 'edited', detail: 'd', oldValue: 'o', newValue: 'n' })),
    rescheduledFrom: ts() - 86_400_000, startedBy: STAFF, startedByName: 'S', startedAt: ts(),
    createdBy: MANAGER, createdAt: ts(), updatedAt: ts(),
  }
  delete (task as { docNo?: unknown }).docNo
  for (const brand of ['stockEvents', 'lelapin__stockEvents']) {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), `${brand}/${task.id}`), task))
    await replace(STAFF, `${brand}/${task.id}`, (cur) => ({
      ...cur, status: 'waitingApproval', completedBy: STAFF, completedByName: 'S', completedAt: ts(),
      history: [...(cur.history as unknown[]), { at: ts(), by: STAFF, byName: 'S', action: 'completed' }], updatedAt: ts(),
    }))
    await replace(MANAGER, `${brand}/${task.id}`, (cur) => ({
      ...cur, status: 'completed', approvedBy: MANAGER, approvedByName: 'M', approvedAt: ts(), startAt: ts() + 86_400_000, dueAt: ts() + 90_000_000,
      history: [...(cur.history as unknown[]), { at: ts(), by: MANAGER, byName: 'M', action: 'approved' }].slice(-100), updatedAt: ts(),
    }))
  }
})


// Transfers (24 Sep 2026): the widest document is a received one with every optional field,
// and the dearest step is a receipt by a branch staff member (the site check reads the
// profile) or a manager's resolution.
test('staff at the destination can receive the widest transfer, and a manager can settle it', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', STAFF), { name: 'Staff', role: 'staff', active: true, siteIds: ['a', 'b', 'c', 'sarasin'] })
  })
  const item = (idx: number) => ({
    idx, productId: 'p' + idx, productName: 'X' + idx, sku: 'S' + idx, unit: 'KG',
    requestedQty: 10, requestedEntryQty: 1, requestedEntryUnit: 'Carton', dispatchQty: 10, dispatchEntryQty: 1, dispatchEntryUnit: 'Carton',
    stockAtSubmit: 50, stockAtApprove: 50, inTransitQty: 10,
    misroutes: [{ id: 'm' + idx, qty: 1, actualCustodyLocationId: 'onnut', originalDestinationId: 'sarasin', reportedBy: STAFF, reportedByName: 'S', reportedAt: ts() }],
  })
  const base = {
    id: 't1', docNo: 'TR-00001', status: 'inTransit', revision: 3, fromLocationId: 'main', toLocationId: 'sarasin',
    dispatchDate: ts(), note: 'n'.repeat(500), parentId: 'p0', legKind: 'forward', childIds: ['c1', 'c2'],
    dispatchMovementDocNo: 'IS-00001', requestedBy: MANAGER, requestedByName: 'M', submittedAt: ts(),
    returnReason: 'r', rejectReason: 'r',
    approvedBy: MANAGER, approvedByName: 'M', approvedAt: ts(),
    items: Array.from({ length: 200 }, (_, i) => item(i)),
    history: Array.from({ length: 499 }, () => ({ at: ts(), by: MANAGER, byName: 'M', action: 'qtyChanged', oldQty: 1, newQty: 2 })),
    createdAt: ts(), updatedAt: ts(),
  }
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'transfers/t1'), base)
  })
  await replace(STAFF, 'transfers/t1', (cur) => ({
    ...cur, status: 'discrepancy', receivedBy: STAFF, receivedByName: 'S', receivedAt: ts(), receiveMovementDocNo: 'IS-00002',
    history: [...(cur.history as unknown[]), { at: ts(), by: STAFF, byName: 'S', action: 'received' }], updatedAt: ts(),
  }))
  await replace(MANAGER, 'transfers/t1', (cur) => ({
    ...cur, status: 'resolved',
    history: [...(cur.history as unknown[]).slice(-499), { at: ts(), by: MANAGER, byName: 'M', action: 'discrepancyResolved' }], updatedAt: ts(),
  }))
})
