// Phase G9: what firestore.rules enforces for intelligence shadow snapshots — written by a
// manager in their own name, valid in shape, and immutable: never changed or deleted.
//
//
//   npm run test:rules      (starts the emulator, needs Java)

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'

let env: RulesTestEnvironment

const ADMIN = 'uid-admin'
const MANAGER = 'uid-manager'
const STAFF = 'uid-staff'

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
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const dr = (by = MANAGER, over: Record<string, unknown> = {}) => ({
  id: 'dr__po1', kind: 'deliveryRisk', engineVersion: 'delivery-rules-1', createdAt: Date.now(), inputsAsOf: Date.now(), createdBy: by,
  poId: 'po1', supplierId: 's1', dueDate: null, score: 72, level: 'HIGH', dataConfidence: 'high', reasons: [{ code: 'risk.overdue', points: 30 }], ...over,
})
const so = (by = MANAGER, over: Record<string, unknown> = {}) => ({
  id: 'so__20261006', kind: 'stockout', engineVersion: 'stockout-1', createdAt: Date.now(), inputsAsOf: Date.now(), createdBy: by, day: Date.now(),
  items: [{ productId: 'p', locationId: 'l', level: 'HIGH', stockoutDate: null, shortageQty: 3, gapDays: 2, dataConfidence: 'medium' }], ...over,
})

describe('intelligence shadow snapshots', () => {
  test('a manager or admin keeps one, in their own name', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr()))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__intelShadow', 'so__20261006'), so(ADMIN)))
  })

  test('staff may neither write nor read them; nobody writes in another name', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'intelShadow', 'dr__po1'), dr(STAFF)))
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr(ADMIN)))
    await assertFails(getDoc(doc(as(STAFF), 'intelShadow', 'dr__po1')))
  })

  test('the shape is checked: id, level, score range, list sizes, no extra fields', async () => {
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po2'), dr()))
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr(MANAGER, { score: 140 })))
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr(MANAGER, { level: 'PROBABLE' })))
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr(MANAGER, { createPo: true })))
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'so__2026'), so(MANAGER, { id: 'so__2026' })))
  })

  test('immutable: a prediction cannot be changed or deleted afterwards, by anyone', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr()))
    await assertSucceeds(getDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1')))
    await assertFails(updateDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), { score: 10 }))
    await assertFails(setDoc(doc(as(MANAGER), 'intelShadow', 'dr__po1'), dr(MANAGER, { score: 10 })))
    await assertFails(deleteDoc(doc(as(ADMIN), 'intelShadow', 'dr__po1')))
  })
})
