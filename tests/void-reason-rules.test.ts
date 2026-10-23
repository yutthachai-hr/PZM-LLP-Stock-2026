// P0 (owner, 22 Oct 2026): the database refuses a cancellation without a reason, signed by
// someone else, or rewritten afterwards — whatever an old or hostile client sends.
//
//   npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

let env: RulesTestEnvironment
const ADMIN = 'uid-admin'
const ADMIN2 = 'uid-admin2'
const STAFF = 'uid-staff'
const now = () => Date.now()

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'pzm-rules-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => env?.cleanup())

const movement = (id: string, over: Record<string, unknown> = {}) => ({
  id, docNo: 'RC-00001', type: 'receive', productId: 'p1', productName: 'Flour', unit: 'KG', qty: 5,
  toLocationId: 'wh', date: now(), byUserId: STAFF, byUserName: 'Staff', createdAt: now(), ...over,
})
const COLLECTIONS = ['stockMovements', 'lelapin__stockMovements']

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: 1 })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Owner', role: 'admin', active: true })
    await setDoc(doc(db, 'users', ADMIN2), { name: 'Admin2', role: 'admin', active: true })
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    for (const c of COLLECTIONS) {
      await setDoc(doc(db, c, 'm1'), movement('m1'))
      await setDoc(doc(db, c, 'legacy'), movement('legacy', { voided: true, updatedBy: ADMIN, updatedByName: 'Owner', updatedAt: now() }))
    }
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const voidPatch = (uid: string, over: Record<string, unknown> = {}) => ({
  voided: true, voidReason: 'keyed twice', voidedAt: now(), voidedBy: uid, voidedByName: 'Owner',
  updatedBy: uid, updatedByName: 'Owner', updatedAt: now(), ...over,
})
// What the app's voidMovement commits (R40): the cancellation and the receipt's 5 taken back off
// its balance, together. A cancellation without the reversal is refused (see the SECURITY test).
const cancel = (uid: string, c: string, over: Record<string, unknown> = {}) => {
  const db = as(uid)
  const b = writeBatch(db)
  b.update(doc(db, c, 'm1'), voidPatch(uid, over))
  b.set(doc(db, c.replace('stockMovements', 'stockLevels'), 'wh__p1'), { id: 'wh__p1', productId: 'p1', locationId: 'wh', qty: 0, updatedAt: now(), updatedBy: uid })
  return b.commit()
}

const seedBalance = (c: string) => env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), c.replace('stockMovements', 'stockLevels'), 'wh__p1'), {
    id: 'wh__p1', productId: 'p1', locationId: 'wh', qty: 5, updatedBy: STAFF, updatedAt: now(),
  })
})

describe.each(COLLECTIONS)('%s', (c) => {
  test('SECURITY: metadata-only cancellation without balance reversal must be denied', async () => {
    const levels = c.replace('stockMovements', 'stockLevels')
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), levels, 'wh__p1'), {
        productId: 'p1', locationId: 'wh', qty: 5, updatedBy: STAFF, updatedAt: now(),
      })
    })
    const decision = await updateDoc(doc(as(ADMIN), c, 'm1'), voidPatch(ADMIN)).then(
      () => 'ALLOW',
      (error) => { if (error.code === 'permission-denied') return 'DENY'; throw error },
    )
    await env.withSecurityRulesDisabled(async (ctx) => {
      const voided = (await getDoc(doc(ctx.firestore(), c, 'm1'))).data()?.voided ?? false
      const qty = (await getDoc(doc(ctx.firestore(), levels, 'wh__p1'))).data()?.qty
      // A receipt of 5 must not disappear from the ledger while its cached balance stays 5.
      expect({ decision, voided, qty }).toEqual({ decision: 'DENY', voided: false, qty: 5 })
    })
  })

  test('an admin cancels with a reason, in their own name', async () => {
    await seedBalance(c)
    await assertSucceeds(cancel(ADMIN, c))
  })

  test('an old client cancelling without a reason is refused', async () => {
    await assertFails(updateDoc(doc(as(ADMIN), c, 'm1'), { voided: true, updatedBy: ADMIN, updatedByName: 'Owner', updatedAt: now() }))
    await assertFails(updateDoc(doc(as(ADMIN), c, 'm1'), { voided: true }))
  })

  test.each([
    ['blank', { voidReason: '' }],
    ['whitespace only', { voidReason: '   ' }],
    ['over 500 characters', { voidReason: 'x'.repeat(501) }],
    ['not text', { voidReason: 42 }],
    ['signed as another admin', { voidedBy: ADMIN2 }],
    ['without the time', { voidedAt: null }],
  ])('a reason that is %s is refused', async (_label, over) => {
    await assertFails(updateDoc(doc(as(ADMIN), c, 'm1'), voidPatch(ADMIN, over)))
  })

  test('staff cannot cancel, even with a reason', async () => {
    await assertFails(updateDoc(doc(as(STAFF), c, 'm1'), voidPatch(STAFF)))
  })

  test('the reason cannot be added, rewritten or un-cancelled afterwards', async () => {
    await seedBalance(c)
    await assertSucceeds(cancel(ADMIN, c))
    await assertFails(updateDoc(doc(as(ADMIN2), c, 'm1'), { voidReason: 'something nicer', updatedBy: ADMIN2, updatedAt: now() }))
    await assertFails(updateDoc(doc(as(ADMIN2), c, 'm1'), voidPatch(ADMIN2)))
    await assertFails(updateDoc(doc(as(ADMIN), c, 'm1'), { voided: false, updatedBy: ADMIN, updatedAt: now() }))
    // A legacy cancellation keeps having no reason: none can be invented for it later.
    await assertFails(updateDoc(doc(as(ADMIN), c, 'legacy'), { voidReason: 'made up later', voidedBy: ADMIN, voidedAt: now(), voidedByName: 'Owner' }))
  })

  test('the cancellation fields cannot ride on an ordinary edit or a new row', async () => {
    await assertFails(updateDoc(doc(as(ADMIN), c, 'm1'), { voidReason: 'sneaky', updatedBy: ADMIN, updatedAt: now() }))
    await assertFails(setDoc(doc(as(STAFF), c, 'm2'), movement('m2', { voidReason: 'born cancelled' })))
  })
})
