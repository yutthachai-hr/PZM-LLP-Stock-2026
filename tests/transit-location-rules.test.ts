// The "in transit" location an admin creates from Settings → ระบบส่งสินค้า (R61, 24 Oct 2026),
// against the real rules engine.
//
//   npm run test:rules      (starts the emulator, needs Java)
//
// ensureTransitLocation() writes `<brand>locations/transit` with type 'transit'. validLocation
// accepted only warehouse/branch, so the admin's button failed with "Missing or insufficient
// permissions" in every brand. The canonical id must carry the transit type, an imported
// transit location (another id, from a backup) stays writable, and locations stay admin-only.

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
const STAFF = 'uid-staff'
const RETIRED_ADMIN = 'uid-admin-off'

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
    await setDoc(doc(db, 'users', RETIRED_ADMIN), { name: 'Old admin', role: 'admin', active: false })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()

// Exactly what ensureTransitLocation() hands to backend.set(), plus the id the backend adds.
const transit = (over: Record<string, unknown> = {}) => ({
  name: 'ระหว่างขนส่ง',
  nameEn: 'In Transit',
  type: 'transit',
  active: true,
  createdAt: Date.now(),
  id: 'transit',
  ...over,
})

const BRAND_COLLECTIONS = ['locations', 'lelapin__locations', 'rnd__locations']

describe.each(BRAND_COLLECTIONS)('%s/transit', (col) => {
  test('an admin switches logistics on', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), `${col}/transit`), transit()))
  })

  test('switching it on again writes the same document', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), `${col}/transit`), transit()))
    await assertSucceeds(setDoc(doc(as(ADMIN), `${col}/transit`), transit()))
  })

  test('a manager, staff, a deactivated admin and nobody cannot', async () => {
    await assertFails(setDoc(doc(as(MANAGER), `${col}/transit`), transit()))
    await assertFails(setDoc(doc(as(STAFF), `${col}/transit`), transit()))
    await assertFails(setDoc(doc(as(RETIRED_ADMIN), `${col}/transit`), transit()))
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), `${col}/transit`), transit()))
  })
})

describe('the transit identity', () => {
  test('the canonical id holds only the transit type', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), transit({ type: 'warehouse' })))
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), transit({ type: 'branch' })))
  })

  test('an existing canonical document of the wrong type can be repaired, not kept wrong', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'locations/transit'), transit({ type: 'warehouse' }))
    })
    await assertFails(updateDoc(doc(as(ADMIN), 'locations/transit'), { name: 'renamed' }))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'locations/transit'), { type: 'transit' }))
  })

  test('an imported transit location under another id stays writable by an admin', async () => {
    const imported = transit({ id: 'transit-b', name: 'In transit (imported)' })
    await assertSucceeds(setDoc(doc(as(ADMIN), 'locations/transit-b'), imported))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'locations/transit-b'), { active: false }))
    await assertFails(setDoc(doc(as(MANAGER), 'locations/transit-c'), transit({ id: 'transit-c' })))
  })

  test('the shape is still checked', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), transit({ type: 'virtual' })))
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), transit({ active: 'yes' })))
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), transit({ capacity: 10 })))
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), transit({ id: 'other' })))
    const { createdAt: _drop, ...noCreatedAt } = transit()
    await assertFails(setDoc(doc(as(ADMIN), 'locations/transit'), noCreatedAt))
  })

  test('warehouses and branches are unchanged', async () => {
    const site = (id: string, type: string) => ({ id, name: 'Site', type, active: true, createdAt: Date.now() })
    await assertSucceeds(setDoc(doc(as(ADMIN), 'locations/main'), site('main', 'warehouse')))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__locations/br1'), site('br1', 'branch')))
    await assertFails(setDoc(doc(as(STAFF), 'rnd__locations/br2'), site('br2', 'branch')))
  })
})
