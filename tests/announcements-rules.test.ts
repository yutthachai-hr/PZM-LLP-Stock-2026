// What firestore.rules enforces for company announcements and the company profile
// (24 Sep 2026), against the real rules engine.
//
//   npm run test:rules      (starts the emulator, needs Java)
//
// The owner's rules, as the database must hold them even for someone calling it directly:
// a หัวหน้า or admin writes announcements, staff only read them; the number is issued only
// by publishing a ready announcement, and after that the words, the number and the files
// are frozen while the send log only grows; nobody deletes one; the logo and prefix are
// an admin's.

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'

let env: RulesTestEnvironment

const ADMIN = 'uid-admin'
const STAFF = 'uid-staff'
const MANAGER = 'uid-manager'

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
    await setDoc(doc(db, 'users', STAFF), { name: 'Staff', role: 'staff', active: true })
    await setDoc(doc(db, 'users', MANAGER), { name: 'Manager', role: 'manager', active: true })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const ts = () => Date.now()

function draft(id: string, by = MANAGER, over: Record<string, unknown> = {}) {
  return {
    id,
    status: 'draft',
    company: 'pizza',
    announcementDate: ts(),
    subject: 'ปรับเวลารับสินค้า',
    body: 'รับสินค้า 8:00–11:00',
    format: 'text',
    target: { mode: 'personal', companyScope: ['pizza'] },
    publisherId: by,
    publisherName: 'Manager',
    sends: [],
    history: [{ at: ts(), by, byName: 'Manager', action: 'created' }],
    createdBy: by,
    createdByName: 'Manager',
    createdAt: ts(),
    updatedAt: ts(),
    ...over,
  }
}

/** What publishing adds to a document, and nothing else — so a test fails only for its own reason. */
function publishOf(d: ReturnType<typeof draft>, by = MANAGER) {
  return {
    ...d,
    status: 'published',
    docNo: 'PZM-ANN-2569-0001',
    publishedAt: ts(),
    publishedBy: by,
    snapshot: { subject: d.subject, body: d.body, text: 'x', companyName: 'Pizza Mania', logoVersion: 0, layoutVersion: 1 },
    history: grow(d.history, 'published', by),
  }
}

function published(id: string, over: Record<string, unknown> = {}) {
  return draft(id, MANAGER, {
    status: 'published',
    docNo: 'PZM-ANN-2569-0001',
    publishedAt: ts(),
    publishedBy: MANAGER,
    snapshot: { subject: 'ปรับเวลารับสินค้า', body: 'รับสินค้า 8:00–11:00', text: 'x', companyName: 'Pizza Mania', logoVersion: 0, layoutVersion: 1 },
    history: [
      { at: ts(), by: MANAGER, byName: 'Manager', action: 'created' },
      { at: ts(), by: MANAGER, byName: 'Manager', action: 'published' },
    ],
    ...over,
  })
}

async function seedDoc(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data)
  })
}

const grow = (h: unknown[], action: string, by = MANAGER) => [...h, { at: ts(), by, byName: 'x', action }]

describe('who writes announcements', () => {
  test('a หัวหน้า and an admin may write a draft in their own name', async () => {
    await assertSucceeds(setDoc(doc(as(MANAGER), 'announcements/a1'), draft('a1')))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'lelapin__announcements/a1'), draft('a1', ADMIN, { company: 'lelapin' })))
  })

  test('staff may read them but not write one', async () => {
    await seedDoc('announcements/a1', draft('a1'))
    await assertSucceeds(getDoc(doc(as(STAFF), 'announcements/a1')))
    await assertFails(setDoc(doc(as(STAFF), 'announcements/a2'), draft('a2', STAFF)))
    await assertFails(updateDoc(doc(as(STAFF), 'announcements/a1'), { subject: 'x', updatedAt: ts() }))
  })

  test('not in a colleague’s name, and never born numbered', async () => {
    await assertFails(setDoc(doc(as(MANAGER), 'announcements/a1'), draft('a1', ADMIN)))
    await assertFails(setDoc(doc(as(MANAGER), 'announcements/a1'), { ...published('a1') }))
  })

  test('nobody deletes one, admins included', async () => {
    await seedDoc('announcements/a1', draft('a1'))
    await assertFails(deleteDoc(doc(as(ADMIN), 'announcements/a1')))
    await assertFails(deleteDoc(doc(as(MANAGER), 'announcements/a1')))
  })
})

describe('the number and the frozen words', () => {
  test('a ready announcement may be published by the caller, with a number and a snapshot', async () => {
    const d = draft('a1', MANAGER, { status: 'ready' })
    await seedDoc('announcements/a1', d)
    await assertSucceeds(setDoc(doc(as(MANAGER), 'announcements/a1'), publishOf(d)))
  })

  test('a draft cannot skip straight to published', async () => {
    const d = draft('a1')
    await seedDoc('announcements/a1', d)
    await assertFails(setDoc(doc(as(MANAGER), 'announcements/a1'), publishOf(d)))
  })

  test('publishing is signed by whoever does it', async () => {
    const d = draft('a1', MANAGER, { status: 'ready' })
    await seedDoc('announcements/a1', d)
    await assertFails(setDoc(doc(as(ADMIN), 'announcements/a1'), publishOf(d, MANAGER)))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'announcements/a1'), publishOf(d, ADMIN)))
  })

  test('once numbered, the words and the number do not change', async () => {
    const p = published('a1')
    await seedDoc('announcements/a1', p)
    await assertFails(updateDoc(doc(as(ADMIN), 'announcements/a1'), { subject: 'แก้แล้ว', history: grow(p.history, 'edited', ADMIN), updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(ADMIN), 'announcements/a1'), { docNo: 'PZM-ANN-2569-0099', history: grow(p.history, 'x', ADMIN), updatedAt: ts() }))
    await assertFails(updateDoc(doc(as(ADMIN), 'announcements/a1'), { status: 'draft', history: grow(p.history, 'x', ADMIN), updatedAt: ts() }))
  })

  test('the send log and history only grow; files are written once', async () => {
    const p = published('a1')
    await seedDoc('announcements/a1', p)
    const send = { at: ts(), by: MANAGER, byName: 'Manager', mode: 'personal', outcome: 'sent', via: 'liff' }
    await assertSucceeds(
      updateDoc(doc(as(MANAGER), 'announcements/a1'), {
        status: 'sent',
        sends: [send],
        files: { pdfUrl: 'https://x/a/1.pdf', imageUrl: 'https://x/a/2.jpg', previewUrl: 'https://x/a/3.jpg', pdfBytes: 1, createdAt: ts() },
        history: grow(p.history, 'send:sent'),
        updatedAt: ts(),
      }),
    )
    await assertFails(updateDoc(doc(as(MANAGER), 'announcements/a1'), { sends: [], history: grow(grow(p.history, 'x'), 'y'), updatedAt: ts() }))
    await assertFails(
      updateDoc(doc(as(MANAGER), 'announcements/a1'), {
        files: { pdfUrl: 'https://evil/a.pdf', imageUrl: 'x', previewUrl: 'x', pdfBytes: 1, createdAt: ts() },
        history: grow(grow(p.history, 'x'), 'y'),
        updatedAt: ts(),
      }),
    )
    await assertFails(updateDoc(doc(as(MANAGER), 'announcements/a1'), { history: [], updatedAt: ts() }))
  })

  test('cancelling is signed by the caller and needs a reason', async () => {
    const p = published('a1')
    await seedDoc('announcements/a1', p)
    await assertFails(
      updateDoc(doc(as(MANAGER), 'announcements/a1'), { status: 'cancelled', cancelledBy: MANAGER, cancelledAt: ts(), history: grow(p.history, 'cancelled'), updatedAt: ts() }),
    )
    await assertFails(
      updateDoc(doc(as(MANAGER), 'announcements/a1'), { status: 'cancelled', cancelReason: 'ซ้ำ', cancelledBy: ADMIN, cancelledAt: ts(), history: grow(p.history, 'cancelled'), updatedAt: ts() }),
    )
    await assertSucceeds(
      updateDoc(doc(as(MANAGER), 'announcements/a1'), { status: 'cancelled', cancelReason: 'ซ้ำ', cancelledBy: MANAGER, cancelledAt: ts(), history: grow(p.history, 'cancelled'), updatedAt: ts() }),
    )
  })

  test('the per-year counter only goes forward', async () => {
    await seedDoc('counters/announcement__2569', { id: 'announcement__2569', value: 3 })
    await assertSucceeds(setDoc(doc(as(MANAGER), 'counters/announcement__2569'), { id: 'announcement__2569', value: 4 }))
    await assertFails(setDoc(doc(as(MANAGER), 'counters/announcement__2569'), { id: 'announcement__2569', value: 2 }))
  })
})

describe('the company profile', () => {
  const profile = (over: Record<string, unknown> = {}) => ({
    id: 'main',
    docPrefix: 'PZM',
    announcementCode: 'ANN',
    logoDataUrl: 'data:image/png;base64,AAAA',
    logoVersion: 1,
    updatedBy: ADMIN,
    updatedAt: ts(),
    ...over,
  })

  test('an admin sets it; a หัวหน้า and staff only read it', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'companyProfile/main'), profile()))
    await assertSucceeds(getDoc(doc(as(STAFF), 'companyProfile/main')))
    await assertFails(setDoc(doc(as(MANAGER), 'companyProfile/main'), profile({ updatedBy: MANAGER })))
    await assertFails(setDoc(doc(as(STAFF), 'lelapin__companyProfile/main'), profile({ updatedBy: STAFF })))
  })

  test('one document per company, and the prefix reads safely in a document number', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'companyProfile/other'), profile({ id: 'other' })))
    await assertFails(setDoc(doc(as(ADMIN), 'companyProfile/main'), profile({ docPrefix: 'pzm-/x' })))
    await assertFails(setDoc(doc(as(ADMIN), 'companyProfile/main'), profile({ logoDataUrl: 'x'.repeat(900001) })))
  })
})
