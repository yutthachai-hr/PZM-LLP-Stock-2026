// Regression tests for the identity findings in AUDIT_FOR_CLAUDE.md (F04, F05, F07, F11).
//
//   npm run test:rules
//
// Every case here is something the database MUST refuse. They all passed against the
// original rules, which is the bug: the UI hides these actions, but the REST API does not.

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'

let env: RulesTestEnvironment

const ADMIN = 'uid-admin'
const ADMIN2 = 'uid-admin2'
const STAFF = 'uid-staff'
const OUTSIDER = 'uid-outsider' // a real auth account with no profile

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

async function seed(fn?: (db: ReturnType<RulesTestEnvironment['authenticatedContext']>) => void) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: 1 })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Owner', role: 'admin', active: true })
    await setDoc(doc(db, 'users', ADMIN2), { name: 'Admin2', role: 'admin', active: true })
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    void fn
  })
}

beforeEach(() => seed())

describe('F04 — nobody can appoint themselves admin', () => {
  test('an account with no profile cannot claim the bootstrap sentinel', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'meta/bootstrap'))
    })
    const db = env.authenticatedContext(OUTSIDER).firestore()
    await assertFails(setDoc(doc(db, 'meta/bootstrap'), { claimedBy: OUTSIDER, at: 2 }))
  })

  test('an account with no profile cannot create itself an active admin', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'meta/bootstrap'))
    })
    const db = env.authenticatedContext(OUTSIDER).firestore()
    await assertFails(
      setDoc(doc(db, 'users', OUTSIDER), { name: 'Me', role: 'admin', active: true }),
    )
  })

  test('the sentinel cannot be overwritten to name someone else', async () => {
    const db = env.authenticatedContext(OUTSIDER).firestore()
    await assertFails(setDoc(doc(db, 'meta/bootstrap'), { claimedBy: OUTSIDER, at: 3 }))
  })
})

describe('F05 — a removed admin stays removed', () => {
  test('a revoked uid cannot re-create its own profile', async () => {
    // How an admin removes someone: tombstone first, then the profile.
    const adminDb = env.authenticatedContext(ADMIN2).firestore()
    await assertSucceeds(setDoc(doc(adminDb, 'revokedUsers', ADMIN), { at: 4, by: ADMIN2 }))
    await assertSucceeds(deleteDoc(doc(adminDb, 'users', ADMIN)))

    // The auth account still exists and the sentinel still names it.
    const ownerDb = env.authenticatedContext(ADMIN).firestore()
    await assertFails(
      setDoc(doc(ownerDb, 'users', ADMIN), { name: 'Owner', role: 'admin', active: true }),
    )
    await assertFails(
      setDoc(doc(ownerDb, 'users', ADMIN), { name: 'Owner', role: 'staff', active: false }),
    )
  })

  test('a profile cannot be deleted without leaving a tombstone', async () => {
    const db = env.authenticatedContext(ADMIN).firestore()
    await assertFails(deleteDoc(doc(db, 'users', STAFF)))
  })

  test('not even an admin can re-add a revoked account without lifting the revocation', async () => {
    const db = env.authenticatedContext(ADMIN).firestore()
    // The full removal: tombstone, then profile.
    await assertSucceeds(setDoc(doc(db, 'revokedUsers', STAFF), { at: 5, by: ADMIN }))
    await assertSucceeds(deleteDoc(doc(db, 'users', STAFF)))

    // Re-adding them now would create a profile the revocation check still blocks, leaving
    // an account that looks restored in the roster but cannot read anything.
    await assertFails(
      setDoc(doc(db, 'users', STAFF), { name: 'Back', role: 'staff', active: true }),
    )

    // Lifting the revocation first is the supported way back.
    await assertSucceeds(deleteDoc(doc(db, 'revokedUsers', STAFF)))
    await assertSucceeds(
      setDoc(doc(db, 'users', STAFF), { name: 'Back', role: 'staff', active: true }),
    )
  })

  test('a revoked user cannot clear their own tombstone', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'revokedUsers', STAFF), { at: 5, by: ADMIN })
    })
    const db = env.authenticatedContext(STAFF).firestore()
    await assertFails(deleteDoc(doc(db, 'revokedUsers', STAFF)))
  })

  test('a revoked user loses access even while their profile still exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore()
      await setDoc(doc(d, 'revokedUsers', STAFF), { at: 6, by: ADMIN })
      await setDoc(doc(d, 'products', 'p1'), { id: 'p1', name: 'Cheese' })
    })
    const db = env.authenticatedContext(STAFF).firestore()
    await assertFails(getDoc(doc(db, 'products', 'p1')))
  })
})

describe('F07 — an admin cannot lock themselves out', () => {
  test('an admin cannot deactivate their own account', async () => {
    const db = env.authenticatedContext(ADMIN).firestore()
    await assertFails(updateDoc(doc(db, 'users', ADMIN), { active: false }))
  })

  test('an admin cannot demote themselves', async () => {
    const db = env.authenticatedContext(ADMIN).firestore()
    await assertFails(updateDoc(doc(db, 'users', ADMIN), { role: 'staff' }))
  })

  test('an admin can still rename themselves', async () => {
    const db = env.authenticatedContext(ADMIN).firestore()
    await assertSucceeds(updateDoc(doc(db, 'users', ADMIN), { name: 'Owner renamed' }))
  })

  test('an admin can still deactivate someone else', async () => {
    const db = env.authenticatedContext(ADMIN).firestore()
    await assertSucceeds(updateDoc(doc(db, 'users', STAFF), { active: false }))
  })
})

describe('F11 — a half-finished bootstrap does not lock the owner out', () => {
  test('signing up with no profile yields a pending staff account, never a dead end', async () => {
    const db = env.authenticatedContext(OUTSIDER).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'users', OUTSIDER), {
        name: 'New',
        email: 'new@example.com',
        role: 'staff',
        active: false,
        createdAt: 7,
      }),
    )
  })

  test('the sentinel claimant gets no special power to self-create', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', ADMIN))
    })
    const db = env.authenticatedContext(ADMIN).firestore()
    await assertFails(
      setDoc(doc(db, 'users', ADMIN), { name: 'Owner', role: 'admin', active: true }),
    )
  })
})
