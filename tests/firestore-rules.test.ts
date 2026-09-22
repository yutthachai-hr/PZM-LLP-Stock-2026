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
const MANAGER = 'uid-manager' // หัวหน้า: reviews purchase requests, nothing admin-only
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
    await setDoc(doc(db, 'users', MANAGER), { name: 'Manager', role: 'manager', active: true })
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

// Reference multipliers for the entry screens — "1 ลัง = 288 EA" — shown as a hint beside
// the quantity box and never fed into a movement. The rules bound the list the same way an
// order's lines are bounded: a size limit, not a check of every element, since the service
// and the UI are what write it and the shape they write is fixed.
describe('product unit reference conversions', () => {
  test('a list of reference conversions is accepted', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(ADMIN), 'products/p9'),
        product('p9', { unitConversions: [{ label: 'ลัง', size: 288 }] }),
      ),
    )
  })

  test('the list is bounded', async () => {
    await assertFails(
      setDoc(
        doc(as(ADMIN), 'products/p9'),
        product('p9', { unitConversions: Array(21).fill({ label: 'x', size: 1 }) }),
      ),
    )
  })

  test('a price history rides on the product, bounded to 100 entries (22 Sep 2026)', async () => {
    const entry = { price: 297.9, unit: 'Carton', factor: 300, cost: 0.993, effectiveAt: 1, at: 1, by: 'admin', byName: 'A' }
    await assertSucceeds(setDoc(doc(as(ADMIN), 'products/p9'), product('p9', { cost: 0.993, costHistory: [entry] })))
    await assertFails(setDoc(doc(as(ADMIN), 'products/p9'), product('p9', { costHistory: Array(101).fill(entry) })))
  })

  test('a product without any reference conversions is still valid', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'products/p9'), product('p9')))
  })

  test('staff still cannot write products', async () => {
    await assertFails(
      setDoc(
        doc(as(STAFF), 'products/p9'),
        product('p9', { unitConversions: [{ label: 'ลัง', size: 288 }] }),
      ),
    )
  })
})

describe('calendar events', () => {
  test('a manager or admin creates one, in their own name, not already decided', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1')))
    await assertSucceeds(setDoc(doc(as(MANAGER), 'stockEvents/e4'), event('e4', { createdBy: MANAGER })))
    await assertFails(setDoc(doc(as(STAFF), 'stockEvents/e2'), event('e2', { createdBy: STAFF })))
    // Nobody files an event as someone else, or born finished.
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e3'), event('e3', { createdBy: STAFF })))
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e5'), event('e5', { status: 'completed' })))
  })

  test('a generated task names its schedule and its id is the dedup key', async () => {
    const id = 'sc__sched1__20260917'
    await assertSucceeds(
      setDoc(doc(as(MANAGER), 'stockEvents', id), event(id, { createdBy: MANAGER, sourceType: 'schedule', sourceId: 'sched1', scheduleId: 'sched1', refKey: id, requiresApproval: true, history: [{ at: ts(), by: MANAGER, byName: 'M', action: 'generated' }] })),
    )
    // refKey has to be the document's own id, or the dedup means nothing.
    await assertFails(
      setDoc(doc(as(MANAGER), 'stockEvents/other'), event('other', { createdBy: MANAGER, sourceType: 'schedule', sourceId: 'sched1', scheduleId: 'sched1', refKey: id })),
    )
    await assertFails(setDoc(doc(as(MANAGER), 'stockEvents/e9'), event('e9', { createdBy: MANAGER, sourceType: 'robot' })))
  })

  test('staff read them — the work is theirs to do', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertSucceeds(getDoc(doc(as(STAFF), 'stockEvents/e1')))
    await assertSucceeds(getDocs(collection(as(STAFF), 'stockEvents')))
    await assertFails(getDoc(doc(as(PENDING), 'stockEvents/e1')))
  })

  test('staff may move the status forward and sign it, and nothing else', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { status: 'inProgress', startedBy: STAFF, startedByName: 'Staff', startedAt: ts(), history: [{ at: ts(), by: STAFF, byName: 'Staff', action: 'started' }], updatedAt: ts() }),
    )
    // Not in a colleague's name, not backwards, not approved by themselves.
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/e1'), { status: 'completed', completedBy: ADMIN, updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/e1'), { status: 'upcoming', updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/e1'), { status: 'completed', approvedBy: STAFF, approvedAt: ts(), updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/e1'), { startAt: ts() + 86400000, updatedAt: ts() }))
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

  test('every move along the workflow, or to another day, writes a history line signed by the mover', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/h1'), event('h1', { history: [{ at: 1, by: ADMIN, byName: 'A', action: 'created' }] }))
    })
    const prev = { at: 1, by: ADMIN, byName: 'A', action: 'created' }
    // No line at all: refused, for staff and managers alike.
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/h1'), { status: 'inProgress', updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(MANAGER), 'stockEvents/h1'), { startAt: ts() + 86400000, updatedAt: ts() }))
    // A line in a colleague's name: refused.
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/h1'), { status: 'inProgress', history: [prev, { at: ts(), by: ADMIN, byName: 'A', action: 'started' }], updatedAt: ts() }))
    // Dropping the old line to make room: refused.
    await assertFails(updateDoc(doc(as(MANAGER), 'stockEvents/h1'), { title: 'x', history: [], updatedAt: ts() }))
    // Signed and appended: fine.
    await assertSucceeds(updateDoc(doc(as(STAFF), 'stockEvents/h1'), { status: 'inProgress', history: [prev, { at: ts(), by: STAFF, byName: 'S', action: 'started' }], updatedAt: ts() }))
    // A manager's title edit needs no line; the editor adds one anyway.
    await assertSucceeds(updateDoc(doc(as(MANAGER), 'stockEvents/h1'), { title: 'renamed', updatedAt: ts() }))
  })

  test('a task assigned to others is not the staff member\'s to move; one for everyone or nobody is', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/mine'), event('mine', { assignedTo: [STAFF] }))
      await setDoc(doc(ctx.firestore(), 'stockEvents/theirs'), event('theirs', { assignedTo: [MANAGER] }))
      await setDoc(doc(ctx.firestore(), 'stockEvents/all'), event('all', { assignedToAll: true }))
    })
    await assertSucceeds(updateDoc(doc(as(STAFF), 'stockEvents/mine'), { status: 'completed', completedBy: STAFF, completedByName: 'S', completedAt: ts(), history: [{ at: ts(), by: STAFF, byName: 'S', action: 'completed' }], updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/theirs'), { status: 'completed', updatedAt: ts() }))
    await assertSucceeds(updateDoc(doc(as(STAFF), 'stockEvents/all'), { status: 'inProgress', history: [{ at: ts(), by: STAFF, byName: 'S', action: 'started' }], updatedAt: ts() }))
    // A manager may take any task on, re-date it with the history growing, and sign off.
    await assertSucceeds(
      updateDoc(doc(as(MANAGER), 'stockEvents/theirs'), { startAt: ts() + 86400000, rescheduledFrom: ts(), history: [{ at: ts(), by: MANAGER, byName: 'M', action: 'rescheduled', oldValue: '1', newValue: '2' }], updatedAt: ts() }),
    )
    await assertFails(updateDoc(doc(as(MANAGER), 'stockEvents/theirs'), { status: 'completed', approvedBy: ADMIN, approvedAt: ts(), updatedAt: ts() }))
    await assertSucceeds(updateDoc(doc(as(MANAGER), 'stockEvents/theirs'), { status: 'completed', approvedBy: MANAGER, approvedByName: 'M', approvedAt: ts(), history: [{ at: 1, by: MANAGER, byName: 'M', action: 'rescheduled' }, { at: ts(), by: MANAGER, byName: 'M', action: 'approved' }], updatedAt: ts() }))
    // Once it is closed it is not staff's to reopen.
    await assertFails(updateDoc(doc(as(STAFF), 'stockEvents/mine'), { status: 'inProgress', history: [{ at: 1, by: STAFF, byName: 'S', action: 'completed' }, { at: ts(), by: STAFF, byName: 'S', action: 'started' }], updatedAt: ts() }))
    // The history never shrinks, whoever writes.
    await assertFails(updateDoc(doc(as(MANAGER), 'stockEvents/theirs'), { history: [], updatedAt: ts() }))
    // A manager clears a task they set or the schedule set, not one an admin set by hand.
    await assertFails(deleteDoc(doc(as(MANAGER), 'stockEvents/theirs')))
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/gen'), event('gen', { sourceType: 'schedule' }))
    })
    await assertSucceeds(deleteDoc(doc(as(MANAGER), 'stockEvents/gen')))
    await assertFails(deleteDoc(doc(as(STAFF), 'stockEvents/mine')))
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
    await assertSucceeds(setDoc(doc(as(ADMIN), 'stockEvents/e6'), event('e6', { requiresApproval: true })))
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

// Who a task is for. The owner asked for one person, several, or everyone. Several is a
// list of uids; everyone is a flag rather than a list of every uid, which would go stale
// the day someone joins. A single uid as a plain string is still accepted, because that is
// what every event written before this looks like.
describe('calendar event assignees', () => {
  test('a list of people, a flag for everyone, and the old single string all pass', async () => {
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { assignedTo: [STAFF, ADMIN], assignedToName: 'A, B' })),
    )
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'stockEvents/e2'), event('e2', { assignedToAll: true, assignedToName: 'ทุกคน' })),
    )
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'stockEvents/e3'), event('e3', { assignedTo: STAFF, assignedToName: 'A' })),
    )
  })

  test('the list is bounded, and the flag is a boolean', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { assignedTo: [] })))
    await assertFails(
      setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { assignedTo: Array(51).fill(STAFF) })),
    )
    await assertFails(setDoc(doc(as(ADMIN), 'stockEvents/e1'), event('e1', { assignedToAll: 'yes' })))
  })

  test('staff still cannot reassign work to themselves', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stockEvents/e1'), event('e1'))
    })
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { assignedTo: [STAFF], updatedAt: ts() }),
    )
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockEvents/e1'), { assignedToAll: true, updatedAt: ts() }),
    )
  })
})

describe('product barcodes (22 Sep 2026)', () => {
  test('are allowed, bounded, and still nothing else is', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'products/b1'), product('b1', { barcode: '8851000654321' })))
    await assertFails(setDoc(doc(as(ADMIN), 'products/b2'), product('b2', { barcode: '8'.repeat(65) })))
    await assertFails(setDoc(doc(as(ADMIN), 'products/b3'), product('b3', { barcode: 8851000654321 })))
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

  test('order days and a cut-off time are kept for the calendar, within their shape', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('s1', { orderDays: [1, 3, 5], cutoffTime: '14:00' })))
    await assertFails(setDoc(doc(as(ADMIN), 'suppliers/s2'), supplier('s2', { orderDays: 'Mon' })))
  })

  test('a cut-off has to look like a time', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'suppliers/s9'), supplier('s9', { cutoffTime: 'two in the afternoon' })))
  })

  test('the details the owner asked for (22 Sep 2026) are optional, bounded, and nothing else gets in', async () => {
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'suppliers/s3'), supplier('s3', {
        code: 'V-00001',
        contactName: 'คุณเอ',
        phone2: '02-000-0000',
        address: '99/1 ถนนสุขุมวิท',
        taxId: '0105500000000',
        paymentTerms: 'เครดิต 30 วัน',
        category: 'ผัก',
        links: [{ label: 'ใบทะเบียน', url: 'https://drive.example/abc' }],
      })),
    )
    // Too long, wrong type, and a field nobody agreed on.
    await assertFails(setDoc(doc(as(ADMIN), 'suppliers/s4'), supplier('s4', { taxId: '0'.repeat(31) })))
    await assertFails(setDoc(doc(as(ADMIN), 'suppliers/s5'), supplier('s5', { links: 'https://drive.example' })))
    await assertFails(setDoc(doc(as(ADMIN), 'suppliers/s6'), supplier('s6', { creditLimit: 5000 })))
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

  // The import from product names writes exactly these two documents, in this order. It
  // shipped writing `type: 'general'` on the first one, which the rule above turns away —
  // so the owner pressed the button, waited, and got "Missing or insufficient permissions"
  // for the whole batch. The unit tests could not see it: their backend accepts anything.
  test('the catalogue import writes a supplier and a product link the rules accept', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'products/p1'), product('p1', { name: 'MUSHROOMS (SIMUMMUANG)' }))
    })
    // What createSupplier() writes for a name the import found, nothing filled in yet.
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'suppliers/s1'), supplier('s1', { contactNumber: '', email: '' })),
    )
    await assertSucceeds(
      updateDoc(doc(as(ADMIN), 'products/p1'), { supplierId: 's1', updatedAt: ts() }),
    )
    // And the value it used to write, so this stays a regression test and not a tautology.
    await assertFails(
      setDoc(doc(as(ADMIN), 'suppliers/s2'), supplier('s2', { contactNumber: '', email: '', type: 'general' })),
    )
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
    // Not { active: true } — STAFF is already active, and stating a field's own current
    // value again changes nothing, so that write is harmless and the rule lets it through
    // (the self-rename branch below only refuses an actual change to a field besides name).
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { active: false }))
  })

  test('can read their own profile', async () => {
    await assertSucceeds(getDoc(doc(as(STAFF), 'users', STAFF)))
  })

  // 22 Sep 2026, "edit profile": renaming yourself decides nothing the access model
  // depends on, so it needs no admin — but it is the ONLY field a self-update may touch.
  test('can rename themselves, and only themselves, and only the name', async () => {
    await assertSucceeds(updateDoc(doc(as(STAFF), 'users', STAFF), { name: 'New Name' }))
    await assertFails(updateDoc(doc(as(STAFF), 'users', MANAGER), { name: 'Hijacked' }))
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { name: 'X', role: 'admin' }))
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { name: 'X', active: false }))
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { name: '' }))
    await assertFails(updateDoc(doc(as(STAFF), 'users', STAFF), { name: 42 }))
  })

  test('a pending (inactive) account cannot rename itself', async () => {
    await assertFails(updateDoc(doc(as(PENDING), 'users', PENDING), { name: 'New Name' }))
  })
})

describe('the ledger is append-only', () => {
  test('staff and admins may add and amend movements', async () => {
    const trail = (uid: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ by: uid, byName: uid, at: ts(), changed: ['qty'] }))
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockMovements/m3'), movement('m3')))
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'stockMovements/m1'), { qty: 3, edits: trail(STAFF, 1) }),
    )
    await assertSucceeds(
      updateDoc(doc(as(ADMIN), 'stockMovements/m1'), { qty: 9, edits: [...trail(STAFF, 1), ...trail(ADMIN, 1)] }),
    )
    // Voiding is the one amendment staff may not make. The UI only ever offered the button
    // to admins; now the database agrees, so the API cannot be used to skip that.
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements/m1'), { voided: true }))
    await assertSucceeds(updateDoc(doc(as(ADMIN), 'stockMovements/m1'), { voided: true }))
  })

  test('a correction has to name the person making it, and cannot lose the ones before', async () => {
    // "ถ้ามีคนแก้มากกว่า 1 ครั้ง ต้องใส่รายงานว่าแอคเคาท์ไหนบ้างที่แก้ไขไป กันการทุจริต."
    const entry = (uid: string) => ({ by: uid, byName: uid, at: ts(), changed: ['qty'] })
    const at = (uid: string) => doc(as(uid), 'stockMovements/m1')

    // Changing a quantity while leaving no trace at all.
    await assertFails(updateDoc(at(STAFF), { qty: 3 }))
    // Signing the edit with a colleague's account.
    await assertFails(updateDoc(at(STAFF), { qty: 3, edits: [entry(ADMIN)] }))
    // Adding two entries at once, or none, so the count stops matching the corrections.
    await assertFails(updateDoc(at(STAFF), { qty: 3, edits: [entry(STAFF), entry(STAFF)] }))
    await assertFails(updateDoc(at(STAFF), { qty: 3, edits: [] }))

    await assertSucceeds(updateDoc(at(STAFF), { qty: 3, edits: [entry(STAFF)] }))
    // A second editor appends; dropping the first one's entry is refused.
    await assertFails(updateDoc(at(ADMIN), { qty: 4, edits: [entry(ADMIN)] }))
    await assertSucceeds(
      updateDoc(at(ADMIN), { qty: 4, edits: [entry(STAFF), entry(ADMIN)] }),
    )
  })

  test("restamping a row's unit signs itself like any other correction", async () => {
    // Correcting a product whose unit was set up wrong rewrites every row filed under the
    // old one, so each of those rows has to name whoever did it.
    const entry = (uid: string) => ({ by: uid, byName: uid, at: ts(), changed: ['unit'] })
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements/m1'), { unit: 'EA' }))
    await assertFails(
      updateDoc(doc(as(STAFF), 'stockMovements/m1'), { unit: 'EA', edits: [entry(ADMIN)] }),
    )
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'stockMovements/m1'), { unit: 'EA', edits: [entry(STAFF)] }),
    )
  })

  test('the history cannot grow without bound', async () => {
    const many = Array.from({ length: 201 }, () => ({ by: STAFF, byName: 'S', at: ts(), changed: [] }))
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements/m1'), { qty: 3, edits: many }))
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
    // A location may carry an English label for the English interface; nothing else.
    await assertSucceeds(setDoc(doc(as(ADMIN), 'locations/loc3'), location('loc3', { name: 'คลังหลัก', nameEn: 'Main Warehouse' })))
    await assertFails(setDoc(doc(as(ADMIN), 'locations/loc4'), location('loc4', { nameEn: 42 })))
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

describe('a balance counted in a unit somebody keyed', () => {
  const lvl = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    productId: 'p1',
    locationId: 'loc1',
    qty: 10,
    updatedAt: ts(),
    updatedBy: STAFF,
    ...over,
  })

  test('a balance in the product own unit keeps the shape it always had', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), 'stockLevels/loc1__p1'), lvl('loc1__p1')))
  })

  test('a balance in another unit carries that unit', async () => {
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'stockLevels/loc1__p1#Pack'), lvl('loc1__p1#Pack', { unit: 'Pack' })),
    )
  })

  test('the unit is bounded, like every other stored name', async () => {
    await assertFails(
      setDoc(
        doc(as(STAFF), 'stockLevels/loc1__p1#x'),
        lvl('loc1__p1#x', { unit: 'x'.repeat(21) }),
      ),
    )
    await assertFails(
      setDoc(doc(as(STAFF), 'stockLevels/loc1__p1#x'), lvl('loc1__p1#x', { unit: 12 })),
    )
  })

  test('a balance still cannot carry anything else, or go negative', async () => {
    await assertFails(setDoc(doc(as(STAFF), 'stockLevels/loc1__p1'), lvl('loc1__p1', { hmm: 1 })))
    await assertFails(setDoc(doc(as(STAFF), 'stockLevels/loc1__p1'), lvl('loc1__p1', { qty: -1 })))
  })

  test('a movement may name the unit it was keyed in', async () => {
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'stockMovements/m-pack'), movement('m-pack', STAFF, { entryUnit: 'Pack' })),
    )
  })

  test('that name is bounded too, and still cannot be anything else', async () => {
    await assertFails(
      setDoc(
        doc(as(STAFF), 'stockMovements/m-long'),
        movement('m-long', STAFF, { entryUnit: 'y'.repeat(21) }),
      ),
    )
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements/m-num'), movement('m-num', STAFF, { entryUnit: 7 })),
    )
  })

  test('a converted row carries what was keyed beside the base quantity (20 Sep 2026)', async () => {
    await assertSucceeds(
      setDoc(doc(as(STAFF), 'stockMovements/m-conv'), movement('m-conv', STAFF, { qty: 1000, entryUnit: 'Carton', entryQty: 2 })),
    )
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements/m-zero'), movement('m-zero', STAFF, { qty: 1000, entryUnit: 'Carton', entryQty: 0 })),
    )
    await assertFails(
      setDoc(doc(as(STAFF), 'stockMovements/m-str'), movement('m-str', STAFF, { qty: 1000, entryUnit: 'Carton', entryQty: '2' })),
    )
    // Re-keying the entry quantity is an edit like any other: signed, or refused.
    await assertFails(updateDoc(doc(as(STAFF), 'stockMovements/m-conv'), { qty: 1500, entryQty: 3, updatedAt: ts() }))
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'stockMovements/m-conv'), {
        qty: 1500,
        entryQty: 3,
        edits: [{ by: STAFF, byName: 'Staff', at: ts(), changed: ['จำนวน'] }],
        updatedBy: STAFF,
        updatedByName: 'Staff',
        updatedAt: ts(),
      }),
    )
  })

  test('staff may state a rate on a product, and nothing else about it', async () => {
    // The first person to key "Carton" on a product states what a Carton is (owner, 20 Sep 2026).
    await assertSucceeds(
      updateDoc(doc(as(STAFF), 'products/p1'), { unitConversions: [{ label: 'Carton', size: 500 }], updatedAt: ts() }),
    )
    await assertFails(updateDoc(doc(as(STAFF), 'products/p1'), { unitConversions: [], name: 'X', updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'products/p1'), { minStock: 3, updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(PENDING), 'products/p1'), { unitConversions: [], updatedAt: ts() }))
  })
})

describe('inventory schedules and settings', () => {
  const schedule = (id: string, over: Record<string, unknown> = {}) => ({
    id, kind: 'stockCount', name: 'นับคลังหลักทุกจันทร์', locationId: 'loc1', frequency: 'weekly', daysOfWeek: [1],
    startTime: '09:00', priority: 'normal', enabled: true, createdBy: ADMIN, createdAt: ts(), updatedAt: ts(), ...over,
  })

  test('an admin writes schedules and settings; staff and managers read them', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'inventorySchedules/s1'), schedule('s1')))
    await assertFails(setDoc(doc(as(MANAGER), 'inventorySchedules/s2'), schedule('s2')))
    await assertFails(setDoc(doc(as(STAFF), 'inventorySchedules/s3'), schedule('s3')))
    await assertSucceeds(getDoc(doc(as(STAFF), 'inventorySchedules/s1')))
    await assertSucceeds(getDocs(collection(as(MANAGER), 'inventorySchedules')))
    await assertFails(getDoc(doc(as(PENDING), 'inventorySchedules/s1')))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'inventorySchedules/settings'), { id: 'settings', kind: 'settings', adjustValueBaht: 1000, adjustPct: 20, wasteValueBaht: 500, coverDays: 7, reminderBeforeMin: 60, escalateAfterHours: 4, usageWindowDays: 30, updatedAt: ts() }))
    await assertFails(setDoc(doc(as(ADMIN), 'inventorySchedules/settings'), { id: 'settings', kind: 'settings', adjustPct: 200, updatedAt: ts() }))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'inventorySchedules/s1')))
  })

  test('the schedule shape is pinned', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'inventorySchedules/s1'), schedule('s1', { frequency: 'hourly' })))
    await assertFails(setDoc(doc(as(ADMIN), 'inventorySchedules/s1'), schedule('s1', { dayOfMonth: 32 })))
    await assertFails(setDoc(doc(as(ADMIN), 'inventorySchedules/s1'), schedule('s1', { cron: '* * * * *' })))
    await assertFails(setDoc(doc(as(ADMIN), 'inventorySchedules/s1'), schedule('s1', { kind: 'audit' })))
  })

  test('everyone keeps their own preferences and nobody else\'s; snoozes are anyone\'s', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), `inventorySchedules/prefs__${STAFF}`), { id: `prefs__${STAFF}`, kind: 'prefs', userId: STAFF, mute: { inventory: ['info'] }, updatedAt: ts() }))
    await assertFails(setDoc(doc(as(STAFF), `inventorySchedules/prefs__${MANAGER}`), { id: `prefs__${MANAGER}`, kind: 'prefs', userId: MANAGER, mute: {}, updatedAt: ts() }))
    await assertFails(setDoc(doc(as(STAFF), `inventorySchedules/prefs__${STAFF}`), { id: `prefs__${STAFF}`, kind: 'prefs', userId: MANAGER, mute: {}, updatedAt: ts() }))
    await assertSucceeds(setDoc(doc(as(STAFF), 'inventorySchedules/snooze__reorder__p1__loc1'), { id: 'snooze__reorder__p1__loc1', kind: 'snooze', until: ts() + 86400000, by: STAFF, byName: 'S', createdAt: ts() }))
    await assertFails(setDoc(doc(as(STAFF), 'inventorySchedules/snooze__x'), { id: 'snooze__x', kind: 'snooze', until: ts(), by: ADMIN, byName: 'A', createdAt: ts() }))
    // The other brand has its own.
    await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__inventorySchedules/s1'), schedule('s1')))
  })

  test('the cron status is readable and never written from a client', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'meta/cronStatus'), { pizza: { lastRunAt: ts() } })
    })
    await assertSucceeds(getDoc(doc(as(STAFF), 'meta/cronStatus')))
    await assertFails(setDoc(doc(as(ADMIN), 'meta/cronStatus'), { pizza: { lastRunAt: ts() } }))
  })
})

describe('orders placed with suppliers', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: 'po1',
    docNo: 'PO-00001',
    supplierId: 'sup1',
    supplierName: 'OLIVA',
    status: 'ordered',
    locationId: 'loc1',
    orderedAt: ts(),
    lines: [{ productId: 'p1', productName: 'X', unit: 'KG', orderedQty: 3 }],
    createdBy: STAFF,
    createdByName: 'Staff',
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  })
  const at = (uid: string, id = 'po1') => doc(as(uid), 'purchaseOrders', id)

  test('staff place orders — it is everyday work, like recording stock', async () => {
    await assertSucceeds(setDoc(at(STAFF), order()))
  })

  test('an order cannot be filed in a colleague name', async () => {
    // The dashboard's "who ordered this" has to mean something when goods do not turn up.
    await assertFails(setDoc(at(STAFF), order({ createdBy: ADMIN })))
  })

  test('an order cannot be born already received', async () => {
    await assertFails(setDoc(at(STAFF), order({ status: 'received' })))
  })

  test('the delivery date is kept, and is an epoch', async () => {
    await assertSucceeds(setDoc(at(STAFF), order({ expectedAt: ts() + 86_400_000 })))
    await assertFails(setDoc(at(STAFF, 'po2'), order({ id: 'po2', expectedAt: 'Thursday' })))
  })

  test('a placed order changes only as a numbered, signed, explained revision', async () => {
    // The supplier holds the number; a silent change to the lines or the date is exactly
    // what an audit cannot follow (owner, 18 Sep 2026).
    await assertSucceeds(setDoc(at(STAFF), order({ expectedAt: ts() + 86_400_000 })))
    const lines = [{ productId: 'p1', productName: 'X', unit: 'KG', orderedQty: 5 }]
    await assertFails(updateDoc(at(STAFF), { lines, updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { expectedAt: ts() + 2 * 86_400_000, updatedAt: ts() }))
    const rev = (n: number) => ({ rev: n, at: ts(), by: STAFF, byName: 'Staff', reason: 'short', changes: [] })
    await assertSucceeds(updateDoc(at(STAFF), { lines, expectedAt: ts() + 2 * 86_400_000, revision: 1, revisions: [rev(1)], updatedAt: ts() }))
    // Revisions only grow.
    await assertFails(updateDoc(at(STAFF), { lines, revision: 2, revisions: [], updatedAt: ts() }))
    await assertSucceeds(updateDoc(at(STAFF), { lines, revision: 2, revisions: [rev(1), rev(2)], updatedAt: ts() }))
    // A draft is still being written: its lines move freely.
    await assertSucceeds(setDoc(at(STAFF, 'po2'), order({ id: 'po2', status: 'draft', batchId: 'b1' })))
    await assertSucceeds(updateDoc(at(STAFF, 'po2'), { lines, updatedAt: ts() }))
  })

  test('the shape is pinned, and an empty order is not one', async () => {
    await assertFails(setDoc(at(STAFF), order({ extra: 'x' })))
    await assertFails(setDoc(at(STAFF), order({ lines: [] })))
    await assertFails(setDoc(at(STAFF), order({ status: 'sent' })))
    await assertFails(setDoc(at(STAFF), order({ orderedAt: 'today' })))
  })

  test('received means there is an invoice number and a stock receipt behind it', async () => {
    // Without this the invoice number is a habit the form could be talked out of.
    await assertSucceeds(setDoc(at(STAFF), order()))
    await assertFails(updateDoc(at(STAFF), { status: 'received', updatedAt: ts() }))
    await assertFails(
      updateDoc(at(STAFF), { status: 'received', invoiceNo: 'IV-1', updatedAt: ts() }),
    )
    await assertSucceeds(
      updateDoc(at(STAFF), {
        status: 'received',
        invoiceNo: 'IV-1',
        movementDocNo: 'RC-00007',
        receivedBy: STAFF,
        receivedByName: 'Staff',
        receivedAt: ts(),
        updatedAt: ts(),
      }),
    )
  })

  test('what the order IS cannot be rewritten after the fact', async () => {
    await assertSucceeds(setDoc(at(STAFF), order()))
    await assertFails(updateDoc(at(STAFF), { supplierId: 'sup2', updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { docNo: 'PO-09999', updatedAt: ts() }))
    // The one exception: an admin putting the per-supplier sequence right (15 Sep 2026).
    await assertSucceeds(updateDoc(at(ADMIN), { docNo: 'PO-00002', updatedAt: ts() }))
    await assertFails(updateDoc(at(ADMIN), { supplierId: 'sup2', updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { locationId: 'loc2', updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { createdBy: ADMIN, updatedAt: ts() }))
  })

  test('renumbering reaches received orders and lowers a counter (owner report 18 Sep)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'purchaseOrders/po1'), order({
        docNo: 'PO-00008', status: 'received', invoiceNo: 'IV1', movementDocNo: 'RC-00001',
        receivedBy: STAFF, receivedByName: 'Staff', receivedAt: ts(), shareStatus: 'sent',
      }))
      await setDoc(doc(ctx.firestore(), 'counters/purchaseOrder__sup1'), { id: 'purchaseOrder__sup1', value: 9 })
    })
    await assertSucceeds(updateDoc(at(ADMIN), { docNo: 'PO-00001', updatedAt: ts() }))
    // A counter only ever goes up by update, so coming down is delete + create.
    await assertFails(setDoc(doc(as(ADMIN), 'counters/purchaseOrder__sup1'), { id: 'purchaseOrder__sup1', value: 1 }))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'counters/purchaseOrder__sup1')))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'counters/purchaseOrder__sup1'), { id: 'purchaseOrder__sup1', value: 1 }))
  })

  test('whoever checks the delivery in signs for it themselves', async () => {
    await assertSucceeds(setDoc(at(STAFF), order()))
    await assertFails(
      updateDoc(at(STAFF), { receivedBy: ADMIN, receivedByName: 'Admin', updatedAt: ts() }),
    )
  })

  test('a placed order is cancelled in the caller name with a reason, never deleted', async () => {
    // The number stays on the books with who called it off and why (owner, 18 Sep 2026).
    await assertSucceeds(setDoc(at(STAFF), order()))
    await assertFails(deleteDoc(at(STAFF)))
    await assertFails(updateDoc(at(STAFF), { status: 'cancelled', updatedAt: ts() }))
    await assertFails(
      updateDoc(at(STAFF), { status: 'cancelled', cancelReason: 'x', cancelledBy: ADMIN, cancelledByName: 'Admin', cancelledAt: ts(), updatedAt: ts() }),
    )
    await assertSucceeds(
      updateDoc(at(STAFF), { status: 'cancelled', cancelReason: 'supplier out of stock', cancelledBy: STAFF, cancelledByName: 'Staff', cancelledAt: ts(), updatedAt: ts() }),
    )
    // Cancelled is final for staff: it cannot be revived or received.
    await assertFails(updateDoc(at(STAFF), { status: 'ordered', updatedAt: ts() }))
    await assertFails(deleteDoc(at(STAFF)))
  })

  test('a draft nobody approved can still be dropped; one that reached the books cannot', async () => {
    await assertSucceeds(setDoc(at(STAFF), order({ status: 'draft', batchId: 'b1' })))
    await assertSucceeds(deleteDoc(at(STAFF)))
    await assertSucceeds(
      setDoc(at(STAFF, 'po2'), order({ id: 'po2', docNo: 'PO-00002' })),
    )
    await assertSucceeds(
      updateDoc(at(STAFF, 'po2'), {
        status: 'received',
        invoiceNo: 'IV-2',
        movementDocNo: 'RC-1',
        receivedBy: STAFF,
        receivedByName: 'Staff',
        receivedAt: ts(),
        updatedAt: ts(),
      }),
    )
    await assertFails(deleteDoc(at(STAFF, 'po2')))
    await assertFails(deleteDoc(at(ADMIN, 'po2')))
  })

  test('someone waiting for approval sees no orders at all', async () => {
    await assertSucceeds(setDoc(at(STAFF), order()))
    await assertFails(getDoc(at(PENDING)))
    await assertFails(getDoc(doc(anon(), 'purchaseOrders/po1')))
  })
})

describe('the list of entry units', () => {
  const units = (over: Record<string, unknown> = {}) => ({
    id: 'entryUnits',
    names: ['Lot', 'Pack', 'EA', 'Carton'],
    updatedAt: ts(),
    ...over,
  })
  const at = (uid: string) => doc(as(uid), 'meta/entryUnits')

  test('an admin maintains it', async () => {
    await assertSucceeds(setDoc(at(ADMIN), units()))
  })

  test('everyone signed in and active can read it — every entry screen needs it', async () => {
    await assertSucceeds(setDoc(at(ADMIN), units()))
    await assertSucceeds(getDoc(at(STAFF)))
  })

  test('staff cannot rewrite the vocabulary the whole company keys against', async () => {
    await assertFails(setDoc(at(STAFF), units()))
  })

  test('someone waiting for approval, or with no profile, sees nothing', async () => {
    await assertSucceeds(setDoc(at(ADMIN), units()))
    await assertFails(getDoc(at(PENDING)))
    await assertFails(getDoc(at(OUTSIDER)))
    await assertFails(getDoc(doc(anon(), 'meta/entryUnits')))
  })

  test('the document keeps its shape', async () => {
    await assertFails(setDoc(at(ADMIN), units({ extra: 'x' })))
    await assertFails(setDoc(at(ADMIN), units({ names: 'Lot' })))
    await assertFails(setDoc(at(ADMIN), units({ updatedAt: 'now' })))
    await assertFails(setDoc(at(ADMIN), units({ id: 'somethingElse' })))
  })

  test('it can be shortened but not emptied, and never deleted', async () => {
    await assertSucceeds(setDoc(at(ADMIN), units({ names: ['Carton'] })))
    await assertFails(setDoc(at(ADMIN), units({ names: [] })))
    await assertFails(deleteDoc(at(ADMIN)))
  })

  test('one write cannot stuff the dropdown', async () => {
    const many = Array.from({ length: 41 }, (_, i) => `U${i}`)
    await assertFails(setDoc(at(ADMIN), units({ names: many })))
  })

  test('it is not a way into the meta collection', async () => {
    // Only this one document is reachable; the catch-all denies the rest of /meta.
    await assertFails(setDoc(doc(as(ADMIN), 'meta/anythingElse'), { id: 'anythingElse' }))
    await assertFails(getDocs(collection(as(ADMIN), 'meta')))
  })
})

describe('orders from an imported list', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: 'po9',
    docNo: 'PO-00009',
    supplierId: 'sup1',
    supplierName: 'OLIVA',
    status: 'draft',
    locationId: 'loc1',
    orderedAt: ts(),
    lines: [{ productId: 'p1', productName: 'X', unit: 'KG', orderedQty: 3 }],
    batchId: 'pb1',
    createdBy: STAFF,
    createdByName: 'Staff',
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  })
  const at = (uid: string) => doc(as(uid), 'purchaseOrders', 'po9')

  test('a draft may be filed, and approved by whoever signs it', async () => {
    await assertSucceeds(setDoc(at(STAFF), order()))
    await assertFails(
      updateDoc(at(STAFF), { status: 'ordered', orderedAt: ts(), approvedBy: ADMIN, approvedByName: 'Admin', approvedAt: ts(), updatedAt: ts() }),
    )
    await assertSucceeds(
      updateDoc(at(STAFF), { status: 'ordered', orderedAt: ts(), approvedBy: STAFF, approvedByName: 'Staff', approvedAt: ts(), updatedAt: ts() }),
    )
  })

  test('the order date moves only when a draft is placed', async () => {
    await assertSucceeds(setDoc(at(STAFF), order({ status: 'ordered' })))
    await assertFails(updateDoc(at(STAFF), { orderedAt: ts() + 1, updatedAt: ts() }))
  })

  test("where the sheet got to is recorded in the sender's own name, and only as one of the known words", async () => {
    await assertSucceeds(setDoc(at(STAFF), order({ status: 'ordered' })))
    await assertSucceeds(updateDoc(at(STAFF), { shareStatus: 'shareOpened', shareOpenedAt: ts(), updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { shareStatus: 'delivered', updatedAt: ts() }))
    await assertFails(
      updateDoc(at(STAFF), { shareStatus: 'sent', sentAt: ts(), sentBy: ADMIN, sentByName: 'Admin', updatedAt: ts() }),
    )
    await assertSucceeds(
      updateDoc(at(STAFF), { shareStatus: 'sent', sentAt: ts(), sentBy: STAFF, sentByName: 'Staff', imageVersion: 1, updatedAt: ts() }),
    )
  })
})

describe('imported order lists', () => {
  const batch = (over: Record<string, unknown> = {}) => ({
    id: 'pb1',
    batchNo: 'PB-20260914-001',
    locationId: 'loc1',
    sourceFileName: 'order.xlsx',
    fileHash: 'abc',
    sheetName: 's',
    blockLabel: 'รายการสั่งของ 14/9/2026',
    status: 'ready',
    rows: [{ idx: 0, excelRow: 4, rawName: 'X', rawUnit: 'KG', rawQty: '5', issues: [] }],
    groups: [],
    history: [{ at: ts(), by: STAFF, byName: 'Staff', action: 'imported' }],
    createdBy: STAFF,
    createdByName: 'Staff',
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  })
  const at = (uid: string, id = 'pb1') => doc(as(uid), 'purchaseBatches', id)

  test('staff import; the import is in their own name and not born approved', async () => {
    await assertSucceeds(setDoc(at(STAFF), batch()))
    await assertFails(setDoc(at(STAFF, 'pb2'), batch({ id: 'pb2', createdBy: ADMIN })))
    await assertFails(setDoc(at(STAFF, 'pb3'), batch({ id: 'pb3', status: 'approved' })))
    await assertFails(setDoc(at(STAFF, 'pb4'), batch({ id: 'pb4', rows: [] })))
    await assertFails(setDoc(at(STAFF, 'pb5'), batch({ id: 'pb5', extra: 1 })))
    await assertFails(setDoc(at(PENDING, 'pb6'), batch({ id: 'pb6', createdBy: PENDING })))
  })

  test('rows, groups, status and history may change; the history never shrinks; the source never changes', async () => {
    await assertSucceeds(setDoc(at(STAFF), batch()))
    const longer = [...batch().history, { at: ts(), by: ADMIN, byName: 'Admin', action: 'approved' }]
    await assertSucceeds(updateDoc(at(ADMIN), { status: 'approved', history: longer, updatedAt: ts() }))
    await assertFails(updateDoc(at(ADMIN), { history: [], updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { fileHash: 'other', updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { batchNo: 'PB-x', updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { createdBy: ADMIN, updatedAt: ts() }))
  })

  test('staff cannot delete an import; an admin can', async () => {
    await assertSucceeds(setDoc(at(STAFF), batch()))
    await assertFails(deleteDoc(at(STAFF)))
    await assertSucceeds(deleteDoc(at(ADMIN)))
  })
})

describe('confirmed product spellings', () => {
  const alias = (over: Record<string, unknown> = {}) => ({
    id: 'alias-1',
    key: 'BLUE CHEESE 3 KG',
    productId: 'p1',
    sourceName: 'BLUE CHEESE 3 KG ',
    createdBy: STAFF,
    createdByName: 'Staff',
    createdAt: ts(),
    ...over,
  })
  const at = (uid: string) => doc(as(uid), 'productAliases', 'alias-1')

  test('staff confirm a spelling, may confirm it again, and may unlearn it', async () => {
    await assertSucceeds(setDoc(at(STAFF), alias()))
    await assertSucceeds(setDoc(at(ADMIN), alias({ productId: 'p2', createdBy: ADMIN, createdByName: 'Admin' })))
    await assertFails(setDoc(at(STAFF), alias({ productId: 'p3', createdBy: ADMIN })))
    await assertFails(setDoc(at(STAFF), alias({ extra: 1 })))
    await assertSucceeds(deleteDoc(at(STAFF)))
  })
})

describe('the manager role', () => {
  test('may record stock like staff, but may not touch the catalogue or the roster', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'stockMovements/m9'), movement('m9', MANAGER)))
    await assertFails(setDoc(doc(as(MANAGER), 'products/p9'), product('p9')))
    await assertFails(updateDoc(doc(as(MANAGER), 'users', STAFF), { role: 'admin' }))
    await assertFails(getDoc(doc(as(MANAGER), 'users', STAFF)))
  })
})

describe('purchase requests', () => {
  const pr = (over: Record<string, unknown> = {}) => ({
    id: 'pr1',
    docNo: 'PR-00001',
    status: 'draft',
    revision: 1,
    locationId: 'loc1',
    items: [{ idx: 0, productId: 'p1', productName: 'X', sku: 'S', unit: 'KG', supplierId: 's1', supplierName: 'S', supplierChoice: 'primary', requestedQty: 5 }],
    requestedBy: STAFF,
    requestedByName: 'Staff',
    history: [{ at: ts(), by: STAFF, byName: 'Staff', action: 'created' }],
    createdBy: STAFF,
    createdByName: 'Staff',
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  })
  const at = (uid: string, id = 'pr1') => doc(as(uid), 'purchaseRequests', id)
  const grow = () => [...pr().history, { at: ts(), by: MANAGER, byName: 'Manager', action: 'x' }]

  test("staff file a draft in their own name; not someone else's, and not already approved", async () => {
    await assertSucceeds(setDoc(at(STAFF), pr()))
    await assertFails(setDoc(at(STAFF, 'pr2'), pr({ id: 'pr2', requestedBy: ADMIN })))
    await assertFails(setDoc(at(STAFF, 'pr3'), pr({ id: 'pr3', status: 'pendingApproval' })))
    await assertFails(setDoc(at(STAFF, 'pr4'), pr({ id: 'pr4', extra: 1 })))
    await assertFails(setDoc(at(PENDING, 'pr5'), pr({ id: 'pr5', createdBy: PENDING, requestedBy: PENDING })))
  })

  test('the requester submits; a manager approves, returns or rejects, in their own name; staff cannot', async () => {
    await assertSucceeds(setDoc(at(STAFF), pr()))
    await assertSucceeds(updateDoc(at(STAFF), { status: 'pendingApproval', submittedAt: ts(), history: grow(), updatedAt: ts() }))
    // Staff cannot speak the manager's words
    await assertFails(updateDoc(at(STAFF), { status: 'approved', approvedBy: STAFF, approvedByName: 'Staff', approvedAt: ts(), history: grow(), updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { status: 'returned', returnReason: 'x', history: grow(), updatedAt: ts() }))
    // A manager cannot sign as someone else
    await assertFails(updateDoc(at(MANAGER), { status: 'approved', approvedBy: ADMIN, approvedByName: 'Admin', approvedAt: ts(), history: grow(), updatedAt: ts() }))
    // Approved must carry a signature at all
    await assertFails(updateDoc(at(MANAGER), { status: 'approved', history: grow(), updatedAt: ts() }))
    await assertSucceeds(updateDoc(at(MANAGER), { status: 'approved', approvedBy: MANAGER, approvedByName: 'Manager', approvedAt: ts(), history: grow(), updatedAt: ts() }))
    // Once approved, a manager cannot quietly take it back; an admin reopens
    await assertFails(updateDoc(at(MANAGER), { status: 'pendingApproval', history: grow(), updatedAt: ts() }))
    await assertSucceeds(updateDoc(at(ADMIN), { status: 'pendingApproval', history: grow(), updatedAt: ts() }))
  })

  test('the number, the requester and the history cannot be rewritten', async () => {
    await assertSucceeds(setDoc(at(STAFF), pr()))
    await assertFails(updateDoc(at(STAFF), { docNo: 'PR-09999', updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { requestedBy: ADMIN, updatedAt: ts() }))
    await assertFails(updateDoc(at(ADMIN), { history: [], updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { status: 'approved', approvedBy: STAFF, history: grow(), updatedAt: ts() }))
  })

  test('orders come only from an approved request, and poCreated names them', async () => {
    await assertSucceeds(setDoc(at(STAFF), pr({ status: 'draft' })))
    await assertFails(updateDoc(at(STAFF), { status: 'poCreated', orders: [{ supplierId: 's1', supplierName: 'S', poId: 'po1', docNo: 'PO-00001' }], history: grow(), updatedAt: ts() }))
    await assertSucceeds(updateDoc(at(STAFF), { status: 'pendingApproval', history: grow(), updatedAt: ts() }))
    await assertSucceeds(updateDoc(at(MANAGER), { status: 'approved', approvedBy: MANAGER, approvedByName: 'M', approvedAt: ts(), history: grow(), updatedAt: ts() }))
    await assertFails(updateDoc(at(STAFF), { status: 'poCreated', history: grow(), updatedAt: ts() }))
    await assertSucceeds(updateDoc(at(STAFF), { status: 'poCreated', orders: [{ supplierId: 's1', supplierName: 'S', poId: 'po1', docNo: 'PO-00001' }], history: grow(), updatedAt: ts() }))
    // An order may say which request it came from
    await assertSucceeds(setDoc(doc(as(STAFF), 'purchaseOrders', 'po1'), {
      id: 'po1', docNo: 'PO-00001', supplierId: 's1', supplierName: 'S', status: 'ordered', locationId: 'loc1', orderedAt: ts(),
      lines: [{ productId: 'p1', productName: 'X', unit: 'KG', orderedQty: 3 }], requestId: 'pr1',
      createdBy: STAFF, createdByName: 'Staff', createdAt: ts(), updatedAt: ts(),
    }))
  })

  test('staff cannot delete a request; an admin can', async () => {
    await assertSucceeds(setDoc(at(STAFF), pr()))
    await assertFails(deleteDoc(at(STAFF)))
    await assertFails(deleteDoc(at(MANAGER)))
    await assertSucceeds(deleteDoc(at(ADMIN)))
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

describe('notifications', () => {
  const note = (id: string, over: Record<string, unknown> = {}) => ({
    id, kind: id.split('__')[0], category: 'task', priority: 'medium', to: { roles: ['manager', 'admin'] },
    params: { title: 'x' }, link: '/calendar', active: true, readBy: {}, source: 'client',
    createdBy: STAFF, createdAt: ts(), updatedAt: ts(), expiresAt: ts() + 86400000, ...over,
  })

  test('anyone active reads them; nobody signed out or pending does', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'notifications/dailyBrief__20260918'), note('dailyBrief__20260918', { source: 'worker', createdBy: 'worker' })))
    await assertSucceeds(getDoc(doc(as(STAFF), 'notifications/dailyBrief__20260918')))
    await assertSucceeds(getDocs(collection(as(STAFF), 'lelapin__notifications')))
    await assertFails(getDoc(doc(as(PENDING), 'notifications/dailyBrief__20260918')))
    await assertFails(getDoc(doc(anon(), 'notifications/dailyBrief__20260918')))
  })

  test('staff announce only what their own action caused, in their own name', async () => {
    await assertSucceeds(setDoc(doc(as(STAFF), 'notifications/taskApproval__e1__1'), note('taskApproval__e1__1')))
    await assertSucceeds(setDoc(doc(as(STAFF), 'lelapin__notifications/prSubmitted__pr1__1'), note('prSubmitted__pr1__1', { category: 'purchasing' })))
    // Not a kind their action produces, not in a colleague's name, not pretending to be the Worker.
    await assertFails(setDoc(doc(as(STAFF), 'notifications/outOfStock__p1__l1'), note('outOfStock__p1__l1', { category: 'inventory', priority: 'critical' })))
    await assertFails(setDoc(doc(as(STAFF), 'notifications/taskApproval__e2__1'), note('taskApproval__e2__1', { createdBy: MANAGER })))
    await assertFails(setDoc(doc(as(STAFF), 'notifications/taskApproval__e3__1'), note('taskApproval__e3__1', { source: 'worker' })))
    // The id has to say what it is.
    await assertFails(setDoc(doc(as(STAFF), 'notifications/random'), note('random', { kind: 'taskApproval' })))
    // Born unread and live.
    await assertFails(setDoc(doc(as(STAFF), 'notifications/taskApproval__e4__1'), note('taskApproval__e4__1', { readBy: { [MANAGER]: 1 } })))
  })

  test('a manager stands in for the Worker: any kind, re-arm and resolve', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'notifications/lowStock__p1__l1'), note('lowStock__p1__l1', { category: 'inventory', createdBy: MANAGER })))
    await assertSucceeds(updateDoc(doc(as(MANAGER), 'notifications/lowStock__p1__l1'), { active: false, resolvedAt: ts(), updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'notifications/lowStock__p1__l1'), { active: true, updatedAt: ts() }))
  })

  test('reading marks your own key and nothing else', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'notifications/poArriving__o1__20260918'), note('poArriving__o1__20260918', { to: { all: true }, readBy: { [MANAGER]: 5 } })))
    await assertSucceeds(updateDoc(doc(as(STAFF), 'notifications/poArriving__o1__20260918'), { [`readBy.${STAFF}`]: ts(), updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'notifications/poArriving__o1__20260918'), { [`readBy.${ADMIN}`]: ts(), updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'notifications/poArriving__o1__20260918'), { readBy: {}, updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(STAFF), 'notifications/poArriving__o1__20260918'), { [`readBy.${STAFF}`]: ts(), priority: 'info' }))
    // Deleting is the purge's, which is an admin's (or the Worker's).
    await assertFails(deleteDoc(doc(as(MANAGER), 'notifications/poArriving__o1__20260918')))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'notifications/poArriving__o1__20260918')))
  })
})
