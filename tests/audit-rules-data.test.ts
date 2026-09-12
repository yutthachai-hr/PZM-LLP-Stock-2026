// Regression tests for the data-integrity findings in AUDIT_FOR_CLAUDE.md
// (F01, F02, F03, F06, and the id/document-id mismatch behind F12).
//
//   npm run test:rules
//
// The theme: the stock engine keeps its invariants, but the stock engine is just client
// code. These cases go straight at the database with a staff token, the way anyone holding
// the public API key could, and check that the rules refuse on their own.

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
const STAFF = 'uid-staff'
const OTHER = 'uid-other'

const now = () => Date.now()

/** A movement exactly as src/services/stock.ts writes one. */
function movement(over: Record<string, unknown> = {}) {
  return {
    id: 'mv1',
    docNo: 'RC-00001',
    type: 'receive',
    productId: 'p1',
    productName: 'Mozzarella',
    unit: 'Kilogram',
    qty: 5,
    toLocationId: 'loc1',
    date: now(),
    byUserId: STAFF,
    byUserName: 'Staff',
    createdAt: now(),
    ...over,
  }
}

function level(over: Record<string, unknown> = {}) {
  return {
    id: 'loc1__p1',
    productId: 'p1',
    locationId: 'loc1',
    qty: 5,
    updatedAt: now(),
    updatedBy: STAFF,
    ...over,
  }
}

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
    await setDoc(doc(db, 'meta/bootstrap'), { claimedBy: ADMIN, at: 1 })
    await setDoc(doc(db, 'users', ADMIN), { name: 'Owner', role: 'admin', active: true })
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    await setDoc(doc(db, 'users', OTHER), { name: 'Other', role: 'staff', active: true })
    await setDoc(doc(db, 'stockMovements', 'mv1'), movement())
    await setDoc(doc(db, 'stockLevels', 'loc1__p1'), level())
    await setDoc(doc(db, 'counters', 'receive'), { id: 'receive', value: 1 })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()

describe('F06 — only the collections the model actually declares', () => {
  test('a made-up suffix no longer inherits stockLevels permissions', async () => {
    // 'lelapin__stockLevels__unregistered'.split('__')[1] used to read as 'stockLevels'.
    await assertFails(
      setDoc(doc(as(STAFF), 'lelapin__stockLevels__unregistered', 'x'), level({ id: 'x' })),
    )
  })

  test('a made-up suffix on the unprefixed name is refused too', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'stockLevels__extra', 'x'), level({ id: 'x' })))
  })

  test('the real Le Lapin namespace still works', async () => {
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'lelapin__stockLevels', 'loc1__p1'), level()),
    )
  })
})

describe('F02 — the ledger records who, and keeps it', () => {
  test('a movement cannot be filed under someone else', async () => {
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements', 'mv2'), movement({ id: 'mv2', byUserId: OTHER })),
    )
  })

  test('a movement filed under yourself is fine', async () => {
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'stockMovements', 'mv2'), movement({ id: 'mv2' })),
    )
  })

  test('the recorded author cannot be rewritten afterwards', async () => {
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements', 'mv1'), { byUserId: OTHER }))
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockMovements', 'mv1'), { byUserName: 'Someone else' }),
    )
  })

  test('what the movement was about cannot be rewritten afterwards', async () => {
    const db = as(STAFF)
    await assertFails(updateDoc(doc(db, 'stockMovements', 'mv1'), { productId: 'p2' }))
    await assertFails(updateDoc(doc(db, 'stockMovements', 'mv1'), { type: 'issue' }))
    await assertFails(updateDoc(doc(db, 'stockMovements', 'mv1'), { toLocationId: 'loc2' }))
    await assertFails(updateDoc(doc(db, 'stockMovements', 'mv1'), { docNo: 'RC-99999' }))
    await assertFails(updateDoc(doc(db, 'stockMovements', 'mv1'), { createdAt: 0 }))
  })

  test('overwriting the whole row is not a way around that', async () => {
    // setDoc replaces the document, which is still an update as far as the rules go.
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements', 'mv1'), movement({ byUserId: OTHER, qty: 999 })),
    )
  })

  test('a negative or absurd quantity is refused', async () => {
    const db = as(STAFF)
    await assertFails(updateDoc(doc(db, 'stockMovements', 'mv1'), { qty: -5 }))
    await assertFails(
      setDoc(doc(db, 'stockMovements', 'mv3'), movement({ id: 'mv3', qty: 0 })),
    )
  })

  test('correcting the quantity, date and note is still allowed', async () => {
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'stockMovements', 'mv1'), {
        qty: 7,
        date: now(),
        note: 'corrected',
        edits: [{ by: STAFF, byName: 'Staff', at: now(), changed: ['qty'] }],
        updatedBy: STAFF,
        updatedByName: 'Staff',
        updatedAt: now(),
      }),
    )
  })

  test('a correction that leaves no trace is refused', async () => {
    // The whole point of the history: you cannot change what a row says anonymously.
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockMovements', 'mv1'), {
        qty: 7,
        updatedBy: STAFF,
        updatedByName: 'Staff',
        updatedAt: now(),
      }),
    )
  })

  test('a correction cannot be signed with someone else name', async () => {
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockMovements', 'mv1'), { qty: 7, updatedBy: OTHER }),
    )
  })

  test('voiding is an admin decision, whatever the UI shows', async () => {
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements', 'mv1'), { voided: true }))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'stockMovements', 'mv1'), { voided: true }))
  })

  test('a movement still cannot be deleted by anyone', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'stockMovements', 'mv1'), { id: 'mv1' }))
  })
})

describe('F03 — document numbers only go forwards', () => {
  test('a counter cannot be sent backwards', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'counters', 'receive'), { id: 'receive', value: 0 }))
  })

  test('a counter cannot go negative', async () => {
    await assertFails(
      setDoc(doc(as(STAFF), 'counters', 'receive'), { id: 'receive', value: -100 }),
    )
  })

  test('a counter cannot become a fraction or a string', async () => {
    const db = as(STAFF)
    await assertFails(setDoc(doc(db, 'counters', 'receive'), { id: 'receive', value: 1.5 }))
    await assertFails(setDoc(doc(db, 'counters', 'receive'), { id: 'receive', value: '99' }))
  })

  test('the next number is fine', async () => {
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'counters', 'receive'), { id: 'receive', value: 2 }),
    )
  })
})

describe('F01 — a forged balance is at least shaped like a balance, and signed', () => {
  test('a balance cannot go negative', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'stockLevels', 'loc1__p1'), level({ qty: -1 })))
  })

  test('a balance cannot be infinite or missing', async () => {
    const db = as(STAFF)
    await assertFails(
      setDoc(doc(db, 'stockLevels', 'loc1__p1'), level({ qty: Number.POSITIVE_INFINITY })),
    )
    await assertFails(setDoc(doc(db, 'stockLevels', 'loc1__p1'), level({ qty: 'lots' })))
  })

  test('a balance write is signed by whoever made it', async () => {
    // This does not stop a determined staff member editing a balance — only a trusted
    // server could, and the free plan has none. It does mean every such write is named,
    // and the ledger stays the thing balances are rebuilt from.
    await assertFails(
      setDoc(doc(as(STAFF), 'stockLevels', 'loc1__p1'), level({ qty: 999999, updatedBy: OTHER })),
    )
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'stockLevels', 'loc1__p1'), level({ qty: 999999 })),
    )
  })
})

describe('F12 — the id field cannot disagree with the document id', () => {
  test('a document claiming a different id is refused', async () => {
    await assertFails(
      setDoc(doc(as(STAFF), 'stockLevels', 'loc1__p1'), level({ id: 'loc9__p9' })),
    )
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements', 'mv2'), movement({ id: 'somewhere-else' })),
    )
  })
})

describe('schema — the shape is checked, not assumed', () => {
  test('a movement missing required fields is refused', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'stockMovements', 'mv2'), { id: 'mv2', qty: 5 }))
  })

  test('a movement carrying unknown fields is refused', async () => {
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements', 'mv2'), movement({ id: 'mv2', injected: true })),
    )
  })

  test('a movement type outside the four kinds is refused', async () => {
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements', 'mv2'), movement({ id: 'mv2', type: 'teleport' })),
    )
  })

  test('a product cannot carry a negative cost or minimum', async () => {
    const db = as(ADMIN)
    const p = {
      id: 'p9',
      sku: 'X-1',
      name: 'Test',
      category: 'Cheese',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now(),
      updatedAt: now(),
    }
    await assertFails(setDoc(doc(db, 'products', 'p9'), { ...p, cost: -1 }))
    await assertFails(setDoc(doc(db, 'products', 'p9'), { ...p, minStock: -5 }))
    await assertSucceeds(setDoc(doc(db, 'products', 'p9'), { ...p, cost: 120.5 }))
  })
})
