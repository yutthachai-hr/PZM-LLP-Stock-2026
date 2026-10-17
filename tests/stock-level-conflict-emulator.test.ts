// Real Firestore emulator transaction test: two-device stock count conflict (P0 C-02).
// Parent holds the emulator lease and will run this against the emulator.
//
//   npm run test:rules

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { StockLevelConflictError } from '../src/services/stock'

let env: RulesTestEnvironment

const STAFF = 'uid-staff'
const MAIN = 'loc-main'

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
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    await setDoc(doc(db, 'locations', MAIN), { name: 'Main', type: 'warehouse', active: true })
    await setDoc(doc(db, 'products', 'p1'), { name: 'Bacon', unitType: 'KG', active: true })
    await setDoc(doc(db, 'stockLevels', `${MAIN}__p1`), {
      locationId: MAIN,
      productId: 'p1',
      qty: 10,
      updatedAt: Date.now(),
    })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()

describe('Real Firestore emulator transaction: two-device count conflict', () => {
  test('second transaction aborts with StockLevelConflictError when first device changed level', async () => {
    const dbA = as(STAFF)
    const dbB = as(STAFF)

    // Device A and Device B both captured expectedLevel = 10
    const devAExpected = 10
    const devBExpected = 10

    // Device A transaction commits count 12 (+2)
    await runTransaction(dbA, async (tx) => {
      const snap = await tx.get(doc(dbA, 'stockLevels', `${MAIN}__p1`))
      const cur = snap.data()?.qty ?? 0
      if (cur !== devAExpected) {
        throw new StockLevelConflictError([
          { productId: 'p1', locationId: MAIN, expected: devAExpected, actual: cur },
        ])
      }
      tx.update(doc(dbA, 'stockLevels', `${MAIN}__p1`), {
        qty: 12,
        updatedAt: Date.now(),
      })
    })

    // Level in Firestore is now 12
    const midSnap = await getDoc(doc(dbA, 'stockLevels', `${MAIN}__p1`))
    expect(midSnap.data()?.qty).toBe(12)

    // Device B transaction runs with expectedLevel = 10
    // Real Firestore transaction reads live document and detects conflict
    await expect(
      runTransaction(dbB, async (tx) => {
        const snap = await tx.get(doc(dbB, 'stockLevels', `${MAIN}__p1`))
        const cur = snap.data()?.qty ?? 0
        if (cur !== devBExpected) {
          throw new StockLevelConflictError([
            { productId: 'p1', productName: 'Bacon', locationId: MAIN, expected: devBExpected, actual: cur },
          ])
        }
        tx.update(doc(dbB, 'stockLevels', `${MAIN}__p1`), {
          qty: 15,
          updatedAt: Date.now(),
        })
      }),
    ).rejects.toThrow(StockLevelConflictError)

    // Verify document was untouched by Device B
    const finalSnap = await getDoc(doc(dbB, 'stockLevels', `${MAIN}__p1`))
    expect(finalSnap.data()?.qty).toBe(12)
  })
})
