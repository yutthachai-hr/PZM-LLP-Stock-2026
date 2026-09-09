// Proves what firestore.rules actually enforces, against the real rules engine.
//
//   npm run test:rules      (starts the emulator, needs Java)
//
// The UI already hides admin buttons from staff; these tests are about the case the UI
// cannot cover — someone calling the database directly with their own token.

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

let env: RulesTestEnvironment

const ADMIN = 'uid-admin'
const STAFF = 'uid-staff'
const PENDING = 'uid-pending' // signed up, not approved yet
const OUTSIDER = 'uid-outsider' // has an auth account, no profile

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
  // Seed the world with rules disabled, so setup never depends on the rules under test.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: Date.now() })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Admin', role: 'admin', active: true })
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    await setDoc(doc(db, 'users', PENDING), { name: 'Pending', role: 'staff', active: false })
    await setDoc(doc(db, 'products/p1'), { sku: 'VGT-01-01-001', name: 'MUSHROOMS' })
    await setDoc(doc(db, 'lelapin__products/p1'), { sku: 'VGT-LL-01-01-001', name: 'COS' })
    await setDoc(doc(db, 'stockMovements/m1'), { docNo: 'RCV-00001', qty: 5 })
    await setDoc(doc(db, 'stockLevels/l1'), { qty: 5 })
    await setDoc(doc(db, 'notes/n1'), { title: 'note' })
    await setDoc(doc(db, 'locations/loc1'), { name: 'Main Warehouse' })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

describe('outsiders', () => {
  test('signed-out users read nothing', async () => {
    await assertFails(getDoc(doc(anon(), 'products/p1')))
    await assertFails(getDocs(collection(anon(), 'products')))
  })

  test('an account with no profile reads nothing', async () => {
    await assertFails(getDoc(doc(as(OUTSIDER), 'products/p1')))
  })

  test('an unapproved account reads nothing, in either brand', async () => {
    await assertFails(getDoc(doc(as(PENDING), 'products/p1')))
    await assertFails(getDoc(doc(as(PENDING), 'lelapin__products/p1')))
    await assertFails(getDoc(doc(as(PENDING), 'stockMovements/m1')))
  })

  test('an unapproved account cannot write', async () => {
    await assertFails(setDoc(doc(as(PENDING), 'stockMovements/m9'), { qty: 1 }))
  })
})

describe('staff', () => {
  test('can read the catalogue and the ledger', async () => {
    await assertSucceeds(getDoc(doc(as(STAFF), 'products/p1')))
    await assertSucceeds(getDocs(collection(as(STAFF), 'products')))
    await assertSucceeds(getDoc(doc(as(STAFF), 'stockMovements/m1')))
  })

  test('can record stock: movements, balances, counters, notes', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockMovements/m2'), { docNo: 'RCV-2', qty: 1 }))
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockLevels/l2'), { qty: 1 }))
    await assertSucceeds(setDoc(doc(as(STAFF), 'counters/receive'), { value: 2 }))
    await assertSucceeds(setDoc(doc(as(STAFF), 'notes/n2'), { title: 'x' }))
    await assertSucceeds(deleteDoc(doc(as(STAFF), 'notes/n1')))
  })

  test('cannot touch the catalogue or the warehouse layout', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'products/p2'), { sku: 'X' }))
    await assertFails(updateDoc(doc(as(STAFF), 'products/p1'), { name: 'renamed' }))
    await assertFails(deleteDoc(doc(as(STAFF), 'products/p1')))
    await assertFails(setDoc(doc(as(STAFF), 'locations/loc2'), { name: 'New' }))
    // The other brand's catalogue is no different.
    await assertFails(setDoc(doc(as(STAFF), 'lelapin__products/p2'), { sku: 'X' }))
  })

  test('cannot see the user roster or promote themselves', async () => {
    await assertFails(getDocs(collection(as(STAFF), 'users')))
    await assertFails(getDoc(doc(as(STAFF), 'users', ADMIN)))
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { role: 'admin' }))
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { active: true }))
  })

  test('can read their own profile', async () => {
    await assertSucceeds(getDoc(doc(as(STAFF), 'users', STAFF)))
  })
})

describe('the ledger is append-only', () => {
  test('staff and admins may add and amend movements', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockMovements/m3'), { qty: 1 }))
    await assertSucceeds(updateDoc(doc(as(STAFF), 'stockMovements/m1'), { voided: true }))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'stockMovements/m1'), { qty: 9 }))
  })

  test('nobody may delete a movement — not even an admin', async () => {
    await assertFails(deleteDoc(doc(as(STAFF), 'stockMovements/m1')))
    await assertFails(deleteDoc(doc(as(ADMIN), 'stockMovements/m1')))
    await assertFails(deleteDoc(doc(as(ADMIN), 'lelapin__stockMovements/m1')))
  })
})

describe('admins', () => {
  test('own the catalogue, locations and the roster', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'products/p2'), { sku: 'X' }))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'products/p1')))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'locations/loc2'), { name: 'New' }))
    await assertSucceeds(getDocs(collection(as(ADMIN), 'users')))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'users', PENDING), { active: true }))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'users/uid-new'), { role: 'staff', active: true }))
    // Removing someone is two writes: the tombstone that keeps their auth account out,
    // then the profile itself.
    await assertSucceeds(setDoc(doc(as(ADMIN), 'revokedUsers', STAFF), { at: 1, by: ADMIN }))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'users', STAFF)))
  })

  test('cannot delete their own profile and lock themselves out', async () => {
    await assertFails(deleteDoc(doc(as(ADMIN), 'users', ADMIN)))
  })
})

describe('sign-up cannot grant privileges', () => {
  test('a newcomer may only create an inactive staff profile for themselves', async () => {
    const db = as('uid-new')
    await assertSucceeds(
      setDoc(doc(db, 'users/uid-new'), { name: 'New', role: 'staff', active: false }),
    )
  })

  test('a newcomer cannot sign up as an admin', async () => {
    const db = as('uid-new')
    await assertFails(setDoc(doc(db, 'users/uid-new'), { name: 'N', role: 'admin', active: true }))
  })

  test('a newcomer cannot sign up already active', async () => {
    const db = as('uid-new')
    await assertFails(setDoc(doc(db, 'users/uid-new'), { name: 'N', role: 'staff', active: true }))
  })

  test('a newcomer cannot create a profile for somebody else', async () => {
    await assertFails(
      setDoc(doc(as('uid-new'), 'users/uid-victim'), { role: 'staff', active: false }),
    )
  })
})

describe('the bootstrap sentinel', () => {
  test('an empty database cannot be bootstrapped from the client at all', async () => {
    // The owner is provisioned from the Firebase console, where rules do not apply.
    // Being first to reach an unprovisioned database proves nothing about owning it.
    await env.clearFirestore()
    const db = as('uid-first')
    await assertFails(
      setDoc(doc(db, 'meta/bootstrap'), { claimedBy: 'uid-first', at: Date.now() }),
    )
    await assertFails(
      setDoc(doc(db, 'users/uid-first'), { name: 'Owner', role: 'admin', active: true }),
    )
  })

  test('it cannot be claimed on behalf of someone else either', async () => {
    await env.clearFirestore()
    await assertFails(
      setDoc(doc(as('uid-first'), 'meta/bootstrap'), { claimedBy: 'uid-other', at: 1 }),
    )
  })

  test('it cannot be rewritten or removed, not even by an admin', async () => {
    await assertFails(setDoc(doc(as('uid-later'), 'meta/bootstrap'), { claimedBy: 'uid-later' }))
    await assertFails(updateDoc(doc(as(ADMIN), 'meta/bootstrap'), { claimedBy: ADMIN }))
    await assertFails(deleteDoc(doc(as(ADMIN), 'meta/bootstrap')))
  })

  test('a later sign-up cannot ride the existing sentinel to admin', async () => {
    // meta/bootstrap names ADMIN, so uid-late is an ordinary newcomer.
    await assertFails(
      setDoc(doc(as('uid-late'), 'users/uid-late'), { role: 'admin', active: true }),
    )
  })
})

describe('collections outside the model', () => {
  test('an invented collection is denied even for an admin', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'evil/x'), { a: 1 }))
    await assertFails(getDoc(doc(as(ADMIN), 'evil/x')))
  })

  test('a fake brand prefix grants nothing', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'attacker__products/p1'), { sku: 'X' }))
  })

  test('meta documents other than the sentinel are closed', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'meta/anything'), { a: 1 }))
  })
})

test('both brands enforce the same rules', async () => {
  await assertSucceeds(getDoc(doc(as(STAFF), 'lelapin__products/p1')))
  await assertSucceeds(setDoc(doc(as(STAFF), 'lelapin__stockMovements/m1'), { qty: 1 }))
  await assertFails(setDoc(doc(as(STAFF), 'lelapin__locations/l1'), { name: 'X' }))
  await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__locations/l1'), { name: 'X' }))
  expect(true).toBe(true)
})
