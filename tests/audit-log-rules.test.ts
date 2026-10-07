// B2: what firestore.rules enforces for the audit log — append-only, written in the
// writer's own name and role, readable only by an admin and only a page at a time.
//
//   npm run test:rules      (starts the emulator, needs Java)

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc } from 'firebase/firestore'
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
const entry = (by: string, role: string, over: Record<string, unknown> = {}) => {
  const now = Date.now()
  const id = `${String(now).padStart(14, '0')}_abc123`
  return {
    id, actorId: by, actorName: 'X', actorRole: role, action: 'product.update', entityType: 'product', entityId: 'p1',
    before: { minStock: 5 }, after: { minStock: 8 }, operationId: 'op-1', createdAt: now, ...over,
  }
}
const put = (uid: string, e: Record<string, unknown>, col = 'auditLog') => setDoc(doc(as(uid), col, e.id as string), e)

describe('audit log', () => {
  test('anyone active appends in their own name and role, in either brand', async () => {
    await assertSucceeds(put(ADMIN, entry(ADMIN, 'admin')))
    await assertSucceeds(put(STAFF, entry(STAFF, 'staff', { id: `${String(Date.now()).padStart(14, '0')}_s1`, action: 'unitConversion.set', entityType: 'unitConversion' })))
    await assertSucceeds(put(MANAGER, entry(MANAGER, 'manager'), 'lelapin__auditLog'))
  })

  test('nobody writes in another name, claims another role, or forges the shape', async () => {
    await assertFails(put(STAFF, entry(ADMIN, 'admin')))
    await assertFails(put(STAFF, entry(STAFF, 'admin')))
    await assertFails(put(ADMIN, entry(ADMIN, 'admin', { entityType: 'stockLevel' })))
    await assertFails(put(ADMIN, entry(ADMIN, 'admin', { extra: 1 })))
    await assertFails(put(ADMIN, entry(ADMIN, 'admin', { action: 'drop table' })))
    await assertFails(put(ADMIN, entry(ADMIN, 'admin', { createdAt: Date.now() + 3_600_000 })))
    await assertFails(put(ADMIN, entry(ADMIN, 'admin', { createdAt: Date.now() - 8 * 86_400_000 })))
    const e = entry(ADMIN, 'admin')
    await assertFails(setDoc(doc(as(ADMIN), 'auditLog', 'free-id'), { ...e, id: 'free-id' }))
  })

  test('immutable: not even an admin may change or delete an entry', async () => {
    const e = entry(ADMIN, 'admin')
    await put(ADMIN, e)
    await assertFails(updateDoc(doc(as(ADMIN), 'auditLog', e.id), { reason: 'oops' }))
    await assertFails(setDoc(doc(as(ADMIN), 'auditLog', e.id), { ...e, after: null }))
    await assertFails(deleteDoc(doc(as(ADMIN), 'auditLog', e.id)))
  })

  test('only an admin reads, and only a bounded page', async () => {
    const e = entry(ADMIN, 'admin')
    await put(ADMIN, e)
    await assertSucceeds(getDoc(doc(as(ADMIN), 'auditLog', e.id)))
    await assertSucceeds(getDocs(query(collection(as(ADMIN), 'auditLog'), orderBy('createdAt', 'desc'), limit(50))))
    await assertFails(getDocs(query(collection(as(ADMIN), 'auditLog'), orderBy('createdAt', 'desc'), limit(51))))
    await assertFails(getDocs(collection(as(ADMIN), 'auditLog')))
    await assertFails(getDoc(doc(as(MANAGER), 'auditLog', e.id)))
    await assertFails(getDocs(query(collection(as(MANAGER), 'auditLog'), limit(10))))
    await assertFails(getDoc(doc(as(STAFF), 'auditLog', e.id)))
  })
})
