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
    await setDoc(doc(db, 'products/p1'), product('p1'))
    await setDoc(
      doc(db, 'lelapin__products/p1'),
      product('p1', { sku: 'VGT-LL-01-01-001', name: 'COS' }),
    )
    await setDoc(doc(db, 'stockMovements/m1'), movement('m1'))
    await setDoc(doc(db, 'lelapin__stockMovements/m1'), movement('m1'))
    await setDoc(doc(db, 'stockLevels/l1'), level('l1'))
    await setDoc(doc(db, 'notes/n1'), note('n1'))
    await setDoc(doc(db, 'locations/loc1'), location('loc1'))
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

// The rules validate the shape of every document now, so these tests write records that
// look like the ones src/services actually produce. A skeleton document would be refused
// for the wrong reason and prove nothing about permissions.
const ts = () => Date.now()

function movement(id: string, by = STAFF, over: Record<string, unknown> = {}) {
  return {
    id,
    docNo: 'RC-00001',
    type: 'receive',
    productId: 'p1',
    productName: 'MUSHROOMS',
    unit: 'Kilogram',
    qty: 5,
    toLocationId: 'loc1',
    date: ts(),
    byUserId: by,
    byUserName: 'Staff',
    createdAt: ts(),
    ...over,
  }
}

function level(id: string, by = STAFF, over: Record<string, unknown> = {}) {
  return {
    id,
    productId: 'p1',
    locationId: 'loc1',
    qty: 5,
    updatedAt: ts(),
    updatedBy: by,
    ...over,
  }
}

function product(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    sku: 'VGT-01-01-001',
    name: 'MUSHROOMS',
    category: 'Vegetable',
    unit: 'Kilogram',
    unitType: 'KG',
    minStock: 0,
    hasImage: false,
    active: true,
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

function location(id: string, over: Record<string, unknown> = {}) {
  return { id, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: ts(), ...over }
}

function note(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: 'note',
    body: '',
    byUserName: 'Staff',
    pinned: false,
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

function supplier(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'SIMUMMUANG',
    contactNumber: '021234567',
    email: 'order@simummuang.example',
    type: 'takingReturn',
    active: true,
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

function supplierItem(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    supplierId: 's1',
    productId: 'p1',
    active: true,
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

function event(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: 'นับสต๊อกประจำสัปดาห์',
    type: 'stockCount',
    startAt: ts(),
    status: 'upcoming',
    priority: 'normal',
    createdBy: ADMIN,
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

describe('product pack size', () => {
  test('an optional pack size and label are accepted', async () => {
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'products/p9'), product('p9', { packSize: 300, packLabel: 'ลัง' })),
    )
  })

  test('a pack size of zero or less is refused', async () => {
    // It is a multiplier: zero would collapse every keyed quantity to nothing.
    await assertFails(setDoc(doc(as(ADMIN), 'products/p9'), product('p9', { packSize: 0 })))
    await assertFails(setDoc(doc(as(ADMIN), 'products/p9'), product('p9', { packSize: -3 })))
  })

  test('a pack size that is not a number is refused', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'products/p9'), product('p9', { packSize: '300' })))
  })

  test('a product without a pack is still valid', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'products/p9'), product('p9')))
  })

  test('staff still cannot write products', async () => {
    await assertFails(
      setDoc(doc(as(STAFF), 'products/p9'), product('p9', { packSize: 300 })),
    )
  })
})

describe('calendar events', () => {
  test('only an admin creates one, and only in their own name', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1')))
    await assertFails(setDoc(doc(as(STAFF), 'stockEvents/e2'), event('e2')))
    // An admin cannot file an event as someone else.
    await assertFails(
      setDoc(doc(as(ADMIN), 'stockEvents/e3'), event('e3', { createdBy: STAFF })),
    )
  })

  test('staff read them — the work is theirs to do', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertSucceeds(getDoc(doc(as(STAFF), 'stockEvents/e1')))
    await assertSucceeds(getDocs(collection(as(STAFF), 'stockEvents')))
    await assertFails(getDoc(doc(as(PENDING), 'stockEvents/e1')))
  })

  test('staff may move the status and nothing else', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { status: 'inProgress', updatedAt: ts() }),
    )
    // The things a staff member must not be able to rewrite on work assigned to them.
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { title: 'something else', updatedAt: ts() }),
    )
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { assignedTo: STAFF, updatedAt: ts() }),
    )
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/e1'), { createdBy: STAFF }))
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { priority: 'critical', updatedAt: ts() }),
    )
  })

  test('an admin may edit the rest', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertSucceeds(
      updateDoc(doc(as(ADMIN), 'stockEvents/e1'), {
        title: 'ตรวจนับรายเดือน',
        priority: 'high',
        updatedAt: ts(),
      }),
    )
  })

  test('a staff set() cannot wipe the document under the edit guard', async () => {
    // editedHonestly() used to default to true, which let an active user replace a whole
    // document as long as the shape validated — rewriting who created it.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertFails(
      setDoc(doc(as(STAFF), 'stockEvents/e1'), event('e1', { createdBy: STAFF })),
    )
  })

  test('the unions are closed', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { type: 'poDelay' })))
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e2'), event('e2', { status: 'waiting' })))
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e3'), event('e3', { priority: 'p1' })))
  })

  test('a deadline before the start is refused by the rules too, not just the service', async () => {
    await assertFails(
      setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { dueAt: ts() - 86400000 })),
    )
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'stockEvents/e2'), event('e2', { dueAt: ts() + 86400000 })),
    )
  })

  test('an unknown field is refused', async () => {
    await assertFails(
      setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { escalationLevel: 2 })),
    )
  })

  test('both brands are covered', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__stockEvents/e1'), event('e1')))
    await assertFails(setDoc(doc(as(STAFF), 'lelapin__stockEvents/e2'), event('e2')))
  })

  test('an admin may delete one; staff may not', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertFails(deleteDoc(doc(as(STAFF), 'stockEvents/e1')))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'stockEvents/e1')))
  })
})

describe('suppliers', () => {
  test('an admin may create one; staff may not', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('s1')))
    await assertFails(setDoc(doc(as(STAFF), 'suppliers/s2'), supplier('s2')))
  })

  test('staff may read them — they are on the receiving screen', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'suppliers/s1'), supplier('s1'))
    })
    await assertSucceeds(getDoc(doc(as(STAFF), 'suppliers/s1')))
    await assertFails(getDoc(doc(as(PENDING), 'suppliers/s1')))
  })

  test('type is constrained to the two the app knows', async () => {
    await assertFails(
      setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('s1', { type: 'sometimesMaybe' })),
    )
  })

  test('an unknown field is refused, so a rules deploy is never silently skipped', async () => {
    await assertFails(
      setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('s1', { creditTermDays: 30 })),
    )
  })

  test('note is optional, and bounded', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('s1', { note: 'ok' })))
    await assertFails(
      setDoc(doc(as(ADMIN), 'suppliers/s2'), supplier('s2', { note: 'x'.repeat(2001) })),
    )
  })

  test('the id must match the document path', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('somethingElse')))
  })

  test('both brands are covered', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__suppliers/s1'), supplier('s1')))
    await assertFails(setDoc(doc(as(STAFF), 'lelapin__suppliers/s2'), supplier('s2')))
  })

  test('an admin may delete one', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'suppliers/s1'), supplier('s1'))
    })
    await assertFails(deleteDoc(doc(as(STAFF), 'suppliers/s1')))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'suppliers/s1')))
  })
})

describe('supplier items', () => {
  test('an admin may link a product; staff may not', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'supplierItems/i1'), supplierItem('i1')))
    await assertFails(setDoc(doc(as(STAFF), 'supplierItems/i2'), supplierItem('i2')))
  })

  test('buyingPrice is optional but must be a non-negative number when present', async () => {
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'supplierItems/i1'), supplierItem('i1', { buyingPrice: 12.5 })),
    )
    await assertFails(
      setDoc(doc(as(ADMIN), 'supplierItems/i2'), supplierItem('i2', { buyingPrice: -1 })),
    )
    await assertFails(
      setDoc(doc(as(ADMIN), 'supplierItems/i3'), supplierItem('i3', { buyingPrice: 'cheap' })),
    )
  })

  test('supplierId and productId are required', async () => {
    const { supplierId: _s, ...noSupplier } = supplierItem('i1')
    await assertFails(setDoc(doc(as(ADMIN), 'supplierItems/i1'), noSupplier))
  })
})

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
    await assertFails(setDoc(doc(as(PENDING), 'stockMovements/m9'), movement('m9', PENDING)))
  })
})

describe('staff', () => {
  test('can read the catalogue and the ledger', async () => {
    await assertSucceeds(getDoc(doc(as(STAFF), 'products/p1')))
    await assertSucceeds(getDocs(collection(as(STAFF), 'products')))
    await assertSucceeds(getDoc(doc(as(STAFF), 'stockMovements/m1')))
  })

  test('can record stock: movements, balances, counters, notes', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockMovements/m2'), movement('m2')))
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockLevels/l2'), level('l2')))
    await assertSucceeds(setDoc(doc(as(STAFF), 'counters/receive'), { id: 'receive', value: 2 }))
    await assertSucceeds(setDoc(doc(as(STAFF), 'notes/n2'), note('n2')))
    await assertSucceeds(deleteDoc(doc(as(STAFF), 'notes/n1')))
  })

  test('cannot touch the catalogue or the warehouse layout', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'products/p2'), product('p2')))
    await assertFails(updateDoc(doc(as(STAFF), 'products/p1'), { name: 'renamed' }))
    await assertFails(deleteDoc(doc(as(STAFF), 'products/p1')))
    await assertFails(setDoc(doc(as(STAFF), 'locations/loc2'), location('loc2')))
    // The other brand's catalogue is no different.
    await assertFails(setDoc(doc(as(STAFF), 'lelapin__products/p2'), product('p2')))
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
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockMovements/m3'), movement('m3')))
    await assertSucceeds(updateDoc(doc(as(STAFF), 'stockMovements/m1'), { qty: 3 }))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'stockMovements/m1'), { qty: 9 }))
    // Voiding is the one amendment staff may not make. The UI only ever offered the button
    // to admins; now the database agrees, so the API cannot be used to skip that.
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements/m1'), { voided: true }))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'stockMovements/m1'), { voided: true }))
  })

  test('nobody may delete a movement — not even an admin', async () => {
    await assertFails(deleteDoc(doc(as(STAFF), 'stockMovements/m1')))
    await assertFails(deleteDoc(doc(as(ADMIN), 'stockMovements/m1')))
    await assertFails(deleteDoc(doc(as(ADMIN), 'lelapin__stockMovements/m1')))
  })
})

describe('admins', () => {
  test('own the catalogue, locations and the roster', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'products/p2'), product('p2')))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'products/p1')))
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'locations/loc2'), location('loc2', { name: 'New' })),
    )
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
  await assertSucceeds(setDoc(doc(as(STAFF), 'lelapin__stockMovements/m2'), movement('m2')))
  await assertFails(setDoc(doc(as(STAFF), 'lelapin__locations/l1'), location('l1')))
  await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__locations/l1'), location('l1')))
  expect(true).toBe(true)
})
