// Release hardening: the devices' cache epoch (meta/cacheEpoch_<brand>) — read by every
// active user, bumped only by an admin, numbers only.
//
//
//   npm run test:rules      (starts the emulator, needs Java)

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
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

describe('the cache epoch', () => {
  test('any active user reads it; only an admin writes it, numbers only, known fields only', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'meta', 'cacheEpoch_pizza'), { id: 'cacheEpoch_pizza', stockMovements: 1 }))
    await assertSucceeds(getDoc(doc(as(STAFF), 'meta', 'cacheEpoch_pizza')))
    await assertFails(setDoc(doc(as(MANAGER), 'meta', 'cacheEpoch_pizza'), { id: 'cacheEpoch_pizza', stockMovements: 2 }))
    await assertFails(setDoc(doc(as(STAFF), 'meta', 'cacheEpoch_pizza'), { id: 'cacheEpoch_pizza', stockMovements: 2 }))
    await assertFails(setDoc(doc(as(ADMIN), 'meta', 'cacheEpoch_pizza'), { id: 'cacheEpoch_pizza', stockMovements: 'x' }))
    await assertFails(setDoc(doc(as(ADMIN), 'meta', 'cacheEpoch_pizza'), { id: 'cacheEpoch_pizza', other: 1 }))
    await assertFails(setDoc(doc(as(ADMIN), 'meta', 'cacheEpoch_other'), { id: 'cacheEpoch_other', products: 1 }))
    await assertFails(deleteDoc(doc(as(ADMIN), 'meta', 'cacheEpoch_pizza')))
  })

  test('the generic meta match opens nothing else', async () => {
    await assertFails(getDoc(doc(as(STAFF), 'meta', 'anything')))
    await assertFails(setDoc(doc(as(ADMIN), 'meta', 'bootstrap'), { claimedBy: ADMIN }))
  })
})
