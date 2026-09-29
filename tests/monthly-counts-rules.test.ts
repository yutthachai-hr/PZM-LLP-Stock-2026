// What firestore.rules enforces for monthly count sheets (29 Sep 2026), against the real
// rules engine: counting is everyone's, confirming is a manager's and signed, a sheet that
// touched the books is final.
//
//   npm run test:rules      (starts the emulator, needs Java)

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore'
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
const ID = 'main__2026-09'
const sheet = (by = STAFF, over: Record<string, unknown> = {}) => ({
  id: ID,
  locationId: 'main',
  month: '2026-09',
  countDate: Date.UTC(2026, 8, 29, 17),
  status: 'counting',
  lines: {},
  createdBy: by,
  createdByName: 'x',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
})
const counted = { mozz: { qty: 110, by: STAFF, byName: 'x', at: Date.now() } }
const results = { mozz: { systemQty: 120, countedQty: 110, diff: -10, value: -2300 } }

async function seed(over: Record<string, unknown> = {}, col = 'monthlyCounts') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, ID), sheet(STAFF, { lines: counted, ...over }))
  })
}

describe('starting a sheet', () => {
  test('anyone active starts an empty sheet, at the id its location and month give', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), 'monthlyCounts', ID), sheet()))
    await assertSucceeds(setDoc(doc(as(STAFF), 'lelapin__monthlyCounts', ID), sheet()))
  })

  test('not at another id, not with counts already in, not in someone else’s name', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'monthlyCounts', 'main__2026-08'), sheet()))
    await assertFails(setDoc(doc(as(STAFF), 'monthlyCounts', ID), sheet(STAFF, { lines: counted })))
    await assertFails(setDoc(doc(as(STAFF), 'monthlyCounts', ID), sheet(MANAGER)))
    await assertFails(setDoc(doc(as(STAFF), 'monthlyCounts', ID), sheet(STAFF, { status: 'posted' })))
  })
})

describe('counting', () => {
  test('anyone active changes the figures while counting, signed', async () => {
    await seed()
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'monthlyCounts', ID), { lines: { mozz: { ...counted.mozz, qty: 111 } }, updatedAt: Date.now(), updatedBy: STAFF, updatedByName: 'x' }),
    )
    await assertFails(updateDoc(doc(as(STAFF), 'monthlyCounts', ID), { lines: {}, updatedAt: Date.now(), updatedBy: MANAGER, updatedByName: 'x' }))
  })

  test('staff cannot confirm', async () => {
    await seed()
    await assertFails(
      updateDoc(doc(as(STAFF), 'monthlyCounts', ID), { status: 'recorded', results, confirmedBy: STAFF, confirmedByName: 'x', confirmedAt: Date.now(), updatedAt: Date.now() }),
    )
  })
})

describe('confirming', () => {
  test('a manager keeps it as a record, signed; the figures are then frozen', async () => {
    await seed()
    await assertSucceeds(
      updateDoc(doc(as(MANAGER), 'monthlyCounts', ID), { status: 'recorded', results, confirmedBy: MANAGER, confirmedByName: 'x', confirmedAt: Date.now(), updatedAt: Date.now() }),
    )
    await assertFails(updateDoc(doc(as(STAFF), 'monthlyCounts', ID), { lines: {}, updatedAt: Date.now(), updatedBy: STAFF, updatedByName: 'x' }))
    await assertFails(updateDoc(doc(as(MANAGER), 'monthlyCounts', ID), { lines: {}, status: 'posted', confirmedBy: MANAGER, confirmedAt: Date.now(), updatedAt: Date.now() }))
  })

  test('a manager files it in parts; posted is final', async () => {
    await seed()
    const sign = { confirmedBy: MANAGER, confirmedByName: 'x', confirmedAt: Date.now(), updatedAt: Date.now(), results }
    await assertSucceeds(updateDoc(doc(as(MANAGER), 'monthlyCounts', ID), { ...sign, status: 'posting', postedIds: ['a'], adjDocNos: ['ADJ-00001'] }))
    await assertSucceeds(updateDoc(doc(as(MANAGER), 'monthlyCounts', ID), { ...sign, status: 'posted', postedIds: ['a', 'mozz'], adjDocNos: ['ADJ-00001', 'ADJ-00002'] }))
    await assertFails(updateDoc(doc(as(ADMIN), 'monthlyCounts', ID), { ...sign, confirmedBy: ADMIN, status: 'posted', note: 'again' }))
  })

  test('a confirmation must be signed by the one confirming', async () => {
    await seed()
    await assertFails(
      updateDoc(doc(as(MANAGER), 'monthlyCounts', ID), { status: 'recorded', results, confirmedBy: ADMIN, confirmedByName: 'x', confirmedAt: Date.now(), updatedAt: Date.now() }),
    )
  })
})

describe('deleting', () => {
  test('an admin may delete a sheet that did not touch the books; never a posted one', async () => {
    await seed()
    await assertFails(deleteDoc(doc(as(MANAGER), 'monthlyCounts', ID)))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'monthlyCounts', ID)))
    await seed({ status: 'posted' })
    await assertFails(deleteDoc(doc(as(ADMIN), 'monthlyCounts', ID)))
  })
})
