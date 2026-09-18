// The cron Worker: its jobs against an in-memory Firestore, its value codec, and the
// signed assertion it trades for a token.
//
//   npm test

import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import { signAssertion } from '../../worker/src/auth'
import { decode, encode } from '../../worker/src/codec'
import { CRONS, runForBrand, runJob } from '../../worker/src/jobs'
import { assertWritable } from '../../worker/src/store'
import { fakeStore } from './fakeStore'

// Friday 2026-09-18, 07:00 Bangkok — the morning job's slot.
const MORNING = bkkAtTime(bkkDayStart(Date.UTC(2026, 8, 18, 3)), '07:00')

let db: ReturnType<typeof fakeStore>
beforeEach(() => {
  db = fakeStore()
})

describe('stock-count generation', () => {
  const schedule = { id: 'sc1', kind: 'stockCount', name: 'นับคลังหลัก', locationId: 'main', frequency: 'daily', startTime: '09:00', priority: 'normal', enabled: true, createdBy: 'a', createdAt: 1, updatedAt: 1 }

  test('two weeks of tasks; the second run writes nothing', async () => {
    db.seed('inventorySchedules', [schedule])
    const first = await runForBrand(db.store, 'generate', '', MORNING)
    expect(first.tasksWritten).toBe(15)
    expect(db.all('stockEvents')[0]).toMatchObject({ sourceType: 'schedule', createdBy: 'worker', status: 'upcoming' })
    expect((await runForBrand(db.store, 'generate', '', MORNING)).tasksWritten).toBe(0)
    expect(db.all('stockEvents')).toHaveLength(15)
  })

  test('each brand from its own schedules', async () => {
    db.seed('lelapin__inventorySchedules', [schedule])
    const r = await runJob(db.store, 'generate', MORNING)
    expect(r.tasksWritten).toBe(15)
    expect(db.all('stockEvents')).toHaveLength(0)
    expect(db.all('lelapin__stockEvents')).toHaveLength(15)
  })

  test('purges what is past its thirty days', async () => {
    db.seed('notifications', [
      { id: 'dailyBrief__old', expiresAt: MORNING - 1 },
      { id: 'dailyBrief__new', expiresAt: MORNING + DAY_MS },
    ])
    expect((await runForBrand(db.store, 'generate', '', MORNING)).purged).toBe(1)
    expect(db.all('notifications').map((n) => n.id)).toEqual(['dailyBrief__new'])
  })
})

describe('the morning job', () => {
  const seedStock = (qty: number) => {
    db.seed('locations', [{ id: 'main', name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 }])
    db.seed('products', [{ id: 'p1', sku: 'S1', name: 'Cheese', unitType: 'KG', minStock: 5, active: true, hasImage: false }])
    db.seed('stockLevels', [{ id: 'main__p1', locationId: 'main', productId: 'p1', qty, updatedAt: 1 }])
  }

  test('low stock and the brief, once; a second run writes nothing', async () => {
    seedStock(2)
    const first = await runForBrand(db.store, 'morning', '', MORNING)
    const ids = db.all('notifications').map((n) => n.id).sort()
    expect(ids).toContain('lowStock__p1__main')
    expect(ids).toContain('dailyBrief__20260918')
    expect(ids).toContain('reorder__p1__main')
    expect(first.notificationsWritten).toBe(ids.length)
    expect((await runForBrand(db.store, 'morning', '', MORNING)).notificationsWritten).toBe(0)
    expect(db.doc('notifications', 'lowStock__p1__main')).toMatchObject({ source: 'worker', active: true, readBy: {}, category: 'inventory' })
  })

  test('recovered: resolved. Low again: re-armed, unread for everyone', async () => {
    seedStock(2)
    await runForBrand(db.store, 'morning', '', MORNING)
    db.seed('stockLevels', [{ id: 'main__p1', locationId: 'main', productId: 'p1', qty: 50, updatedAt: 2 }])
    await runForBrand(db.store, 'morning', '', MORNING + DAY_MS)
    expect(db.doc('notifications', 'lowStock__p1__main')).toMatchObject({ active: false, resolvedAt: MORNING + DAY_MS })
    db.seed('notifications', [{ ...db.doc('notifications', 'lowStock__p1__main')!, readBy: { m: 1 } }])
    db.seed('stockLevels', [{ id: 'main__p1', locationId: 'main', productId: 'p1', qty: 1, updatedAt: 3 }])
    await runForBrand(db.store, 'morning', '', MORNING + 2 * DAY_MS)
    expect(db.doc('notifications', 'lowStock__p1__main')).toMatchObject({ active: true, readBy: {}, createdAt: MORNING + 2 * DAY_MS })
  })
})

describe('the half-hourly job', () => {
  test('an overdue task, once', async () => {
    db.seed('locations', [])
    db.seed('stockEvents', [{ id: 't1', title: 'นับ', type: 'stockCount', startAt: MORNING - 10 * 3_600_000, dueAt: MORNING - 9 * 3_600_000, status: 'upcoming', priority: 'normal', createdBy: 'm', createdAt: 1, updatedAt: 1 }])
    expect((await runForBrand(db.store, 'frequent', '', MORNING)).notificationsWritten).toBe(2) // overdue + escalated
    expect((await runForBrand(db.store, 'frequent', '', MORNING)).notificationsWritten).toBe(0)
  })

  test('stays inside a free-plan invocation: few queries per brand', async () => {
    await runJob(db.store, 'morning', MORNING)
    // 50 outgoing requests per invocation, one of which is the token; writes are batched.
    expect(db.counts().queries).toBeLessThanOrEqual(24)
  })
})

describe('what it may write', () => {
  test('tasks, notifications and its own status — nothing else, either brand', () => {
    for (const c of ['stockEvents', 'lelapin__notifications', 'meta']) expect(() => assertWritable(c)).not.toThrow()
    for (const c of ['products', 'stockMovements', 'lelapin__stockLevels', 'users']) expect(() => assertWritable(c)).toThrow()
  })

  test('every write in the source goes through the allow-listed store', () => {
    for (const f of readdirSync(new URL('../../worker/src/', import.meta.url))) {
      const src = readFileSync(new URL(`../../worker/src/${f}`, import.meta.url), 'utf8')
      expect(src).not.toMatch(/documents:commit|:commit'/)
    }
  })

  test('the crons in wrangler.toml are the ones the code knows', () => {
    const toml = readFileSync(new URL('../../worker/wrangler.toml', import.meta.url), 'utf8')
    const line = toml.split(/\r?\n/).find((l) => l.startsWith('crons'))!
    const listed = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(listed.sort()).toEqual(Object.keys(CRONS).sort())
  })
})

describe('codec', () => {
  test('whole numbers as integers, the rest as they are, and back', () => {
    expect(encode(3)).toEqual({ integerValue: '3' })
    expect(encode(1.5)).toEqual({ doubleValue: 1.5 })
    const doc = { a: 1, b: 'x', c: [1, true, null], d: { e: 2.5, f: {} } }
    expect(decode(encode(doc))).toEqual(doc)
  })
})

describe('auth', () => {
  test('the assertion is an RS256 JWT the key verifies, scoped to Firestore', async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
    const jwt = await signAssertion({ client_email: 'cron@x.iam.gserviceaccount.com', private_key: pem, project_id: 'x' }, 1000)
    const [h, c, s] = jwt.split('.')
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'cron@x.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/datastore', iat: 1000, exp: 4600 })
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
  })
})
