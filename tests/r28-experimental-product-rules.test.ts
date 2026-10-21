// R25/R28: an R&D experimental item is created only by the trusted receive endpoint (service
// account). Afterwards the admin maintains it like any product (cost, unit, deactivate), but
// no client may mint, forge or rewrite its `experimental` provenance.
//
//   npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'

let env: RulesTestEnvironment
const ADMIN = 'uid-admin'
const STAFF = 'uid-staff'
const ID = 'rnd_other_000001'
const PATH = `rnd__products/${ID}`

const ts = () => Date.now()
const provenance = { parentId: 'cheese-other', spec: '200 g', status: 'pending', createdBy: ADMIN, createdByName: 'Admin' }
const item = (over: Record<string, unknown> = {}) => ({
  id: ID, sku: 'RND-000001', name: 'Synthetic Smoked Cheese', category: 'CHEESE', unit: 'Pack', unitType: 'Pack',
  supplierId: 'other', minStock: 0, hasImage: false, active: true, createdAt: ts(), updatedAt: ts(),
  experimental: provenance, ...over,
})

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'pzm-rules-r28-experimental',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: ts() })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Admin', role: 'admin', active: true })
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    await setDoc(doc(db, PATH), item()) // as the trusted endpoint filed it
  })
})
const as = (uid: string) => doc(env.authenticatedContext(uid).firestore(), PATH)

describe('maintaining a server-created R&D experimental item', () => {
  test('admin can set its cost, fix its unit and deactivate it', async () => {
    await assertSucceeds(updateDoc(as(ADMIN), { cost: 120, updatedAt: ts() }))
    await assertSucceeds(updateDoc(as(ADMIN), { unit: 'Box', unitType: 'Box', updatedAt: ts() }))
    await assertSucceeds(updateDoc(as(ADMIN), { active: false, updatedAt: ts() }))
  })
  test('staff still cannot write products', async () => {
    await assertFails(updateDoc(as(STAFF), { cost: 1, updatedAt: ts() }))
  })
  test('no client rewrites or drops its provenance', async () => {
    await assertFails(updateDoc(as(ADMIN), { experimental: { ...provenance, status: 'approved' }, updatedAt: ts() }))
    await assertFails(updateDoc(as(ADMIN), { experimental: { ...provenance, parentId: 'other-parent' }, updatedAt: ts() }))
    const { experimental: _dropped, ...plain } = item()
    await assertFails(setDoc(as(ADMIN), plain))
  })
  test('no client mints an experimental item', async () => {
    const fresh = doc(env.authenticatedContext(ADMIN).firestore(), 'rnd__products/rnd_other_000002')
    await assertFails(setDoc(fresh, item({ id: 'rnd_other_000002' })))
  })
  test('unit type stays within the product limit', async () => {
    await assertFails(updateDoc(as(ADMIN), { unitType: 'x'.repeat(21), updatedAt: ts() }))
  })
})
