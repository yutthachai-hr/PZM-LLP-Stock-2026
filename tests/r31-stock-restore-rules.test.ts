import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

let env: RulesTestEnvironment
const ADMIN = 'restore-admin', HISTORICAL = 'historical-staff'
const NOW = 1_792_620_000_000
const needsRevision = process.env.R31_RULES_REQUIRE_REV === '1'
const movement = (by: string) => ({ id: 'm1', docNo: 'RC-00001', type: 'receive', productId: 'p1', productName: 'Synthetic product', unit: 'KG', qty: 5, toLocationId: 'loc1', date: NOW, byUserId: by, byUserName: 'Historical author', createdAt: NOW })
const level = (by: string) => ({ id: 'loc1__p1', productId: 'p1', locationId: 'loc1', qty: 5, updatedAt: NOW, updatedBy: by })

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'pzm-r31-restore', firestore: { rules: readFileSync(process.env.RULES_FILE ?? new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } })
})
afterAll(async () => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: NOW })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Admin', role: 'admin', active: true })
    await setDoc(doc(db, 'users', HISTORICAL), { name: 'Staff', role: 'staff', active: true })
    await setDoc(doc(db, 'products/p1'), { id: 'p1', sku: 'SYN-1', name: 'Synthetic product', category: 'Test', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: NOW, updatedAt: NOW })
    await setDoc(doc(db, 'locations/loc1'), { id: 'loc1', name: 'Synthetic warehouse', type: 'warehouse', active: true, createdAt: NOW })
    await setDoc(doc(db, 'counters/ledgerRev'), { id: 'ledgerRev', value: 0 })
  })
})
function restore(by: string, bump: boolean) {
  const db = env.authenticatedContext(ADMIN).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'stockMovements/m1'), movement(by))
  if (bump) batch.set(doc(db, 'counters/ledgerRev'), { id: 'ledgerRev', value: 1 })
  return batch.commit()
}

test('positive control: valid own-author movement with a revision increment commits', async () => {
  await assertSucceeds(restore(ADMIN, true))
  const db = env.authenticatedContext(ADMIN).firestore()
  expect((await getDoc(doc(db, 'stockMovements/m1'))).data()?.byUserId).toBe(ADMIN)
  expect((await getDoc(doc(db, 'counters/ledgerRev'))).data()?.value).toBe(1)
})
test('own-author movement without revision characterizes the selected rules, not a fixture error', async () => {
  await (needsRevision ? assertFails : assertSucceeds)(restore(ADMIN, false))
})
test.each([false, true])('historical actor identity cannot be replayed by client admin, revision=%s', async (bump) => {
  await assertFails(restore(HISTORICAL, bump))
})
test('positive control: rebuilt balance signed by current admin commits in one Firestore instance', async () => {
  const db = env.authenticatedContext(ADMIN).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'stockLevels/loc1__p1'), level(ADMIN))
  batch.set(doc(db, 'counters/ledgerRev'), { id: 'ledgerRev', value: 1 })
  await assertSucceeds(batch.commit())
  expect((await getDoc(doc(db, 'stockLevels/loc1__p1'))).data()?.qty).toBe(5)
})
test('restored balance must name its current writer, not the historical actor', async () => {
  const db = env.authenticatedContext(ADMIN).firestore()
  await assertFails(setDoc(doc(db, 'stockLevels/loc1__p1'), level(HISTORICAL)))
})
test('old probe movement was invalid independently of its actor check', async () => {
  const db = env.authenticatedContext(ADMIN).firestore()
  const { byUserName: _, ...bad } = movement(ADMIN)
  await assertFails(setDoc(doc(db, 'stockMovements/m1'), { ...bad, byName: 'Old probe field' }))
})
test('old probe balance omitted the required current-writer field', async () => {
  const db = env.authenticatedContext(ADMIN).firestore()
  const { updatedBy: _, ...bad } = level(ADMIN)
  await assertFails(setDoc(doc(db, 'stockLevels/loc1__p1'), bad))
})
test('known S2 hole: a phantom transfer ID admits a cross-location issue', async () => {
  const db = env.authenticatedContext(HISTORICAL).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'stockMovements/m1'), { ...movement(HISTORICAL), type: 'issue', fromLocationId: 'loc1', toLocationId: 'loc2', transferId: 'does-not-exist' })
  batch.set(doc(db, 'counters/ledgerRev'), { id: 'ledgerRev', value: 1 })
  await assertSucceeds(batch.commit())
  expect((await getDoc(doc(db, 'transfers/does-not-exist'))).exists()).toBe(false)
})
test('known S5 hole: a signed historical quantity edit needs no matching balance adjustment', async () => {
  await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'stockMovements/m1'), movement(HISTORICAL)))
  const db = env.authenticatedContext(HISTORICAL).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'stockMovements/m1'), { qty: 999, edits: [{ by: HISTORICAL, byName: 'Staff', at: NOW + 1, changed: ['qty'] }], updatedBy: HISTORICAL, updatedByName: 'Staff', updatedAt: NOW + 1 })
  batch.set(doc(db, 'counters/ledgerRev'), { id: 'ledgerRev', value: 1 })
  await assertSucceeds(batch.commit())
  expect((await getDoc(doc(db, 'stockMovements/m1'))).data()?.qty).toBe(999)
  expect((await getDoc(doc(db, 'stockLevels/loc1__p1'))).exists()).toBe(false)
})
const order = () => ({ id: 'po1', docNo: 'PO-00001', supplierId: 'sup1', supplierName: 'Synthetic supplier', status: 'ordered', locationId: 'loc1', orderedAt: NOW, lines: [{ productId: 'p1', productName: 'Synthetic product', unit: 'KG', orderedQty: 5 }], createdBy: HISTORICAL, createdByName: 'Staff', createdAt: NOW, updatedAt: NOW })
test.each(['purchaseOrders', 'lelapin__purchaseOrders', 'rnd__purchaseOrders'])('known B4 boundary gap: direct ordered create in %s has no trusted command or brand grant', async collection => {
  const db = env.authenticatedContext(HISTORICAL).firestore()
  await assertSucceeds(setDoc(doc(db, collection + '/po1'), order()))
  expect((await getDoc(doc(db, collection + '/po1'))).data()?.status).toBe('ordered')
})
test('known approval timestamp gap: an approved PO timestamp can be rewritten independently', async () => {
  const db = env.authenticatedContext(HISTORICAL).firestore()
  await assertSucceeds(setDoc(doc(db, 'purchaseOrders/po1'), { ...order(), approvedBy: HISTORICAL, approvedByName: 'Staff', approvedAt: NOW }))
  await assertSucceeds(updateDoc(doc(db, 'purchaseOrders/po1'), { approvedAt: NOW - 86_400_000, updatedAt: NOW + 1 }))
  expect((await getDoc(doc(db, 'purchaseOrders/po1'))).data()?.approvedAt).toBe(NOW - 86_400_000)
})

test('known S1 hole: an active writer can invent a balance even while incrementing ledgerRev', async () => {
  const db = env.authenticatedContext(HISTORICAL).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'stockLevels/loc1__p1'), { ...level(HISTORICAL), qty: 999 })
  batch.set(doc(db, 'counters/ledgerRev'), { id: 'ledgerRev', value: 1 })
  await assertSucceeds(batch.commit())
  expect((await getDoc(doc(db, 'stockLevels/loc1__p1'))).data()?.qty).toBe(999)
})
