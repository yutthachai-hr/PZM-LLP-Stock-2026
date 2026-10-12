// The supplier's answer against a real Firestore (the emulator), through the very store the
// Pages Function uses in production (restServerStore): its batchGet, its updateTime
// precondition and its create-if-absent are Firestore's own here, not the in-memory copy's.
// Owner, 12 Oct 2026: one confirmation of PO-00005 reached the bell five times. Five phones
// answering the same order at the same moment must land one confirmation and one notification.
//
//   npm run test:rules        (starts the Firestore emulator; this file runs with the rules tests)

import { beforeAll, describe, expect, test } from 'vitest'
import { restServerStore } from '../../functions/_lib/serverStore'
import { answerLink, mintLink, type Deps } from '../../functions/_lib/supplierPo'
import { encodeFields } from '../../worker/src/codec'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import type { DeliveryDateChange } from '../../src/types'

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const PROJECT = 'pzm-rules-test'
const ROOT = `projects/${PROJECT}/databases/(default)/documents`
const EMU = `http://${HOST}/v1/${ROOT}`
// A fake signing key for the link (>= 32 chars), not a credential.
const SECRET = 's'.repeat(40)
// Run against the wall clock's day so the link is alive; the date asked is three days out.
const NOW = bkkAtTime(bkkDayStart(Date.now()), '10:00')
const day = (n: number) => bkkDayStart(NOW) + n * DAY_MS
const RUN = `r${Date.now().toString(36)}`
/** The emulator's admin credential: past the rules, as the service account is in production. */
const ADMIN = { authorization: 'Bearer owner', 'content-type': 'application/json' }

let sa = ''
/** Production's fetch, aimed at the emulator; the token exchange answered locally. */
const emulatorFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'owner', expires_in: 3600 })
  const to = url.replace(`https://firestore.googleapis.com/v1/${ROOT}`, EMU)
  return fetch(to, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: 'Bearer owner' } })
}

async function put(collection: string, id: string, doc: Record<string, unknown>) {
  const res = await fetch(`${EMU}/${collection}/${id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: encodeFields(doc) }) })
  if (!res.ok) throw new Error(`seed ${collection}/${id}: ${res.status} ${await res.text()}`)
}

async function list(collection: string): Promise<{ name: string; fields: Record<string, unknown> }[]> {
  const res = await fetch(`${EMU}/${collection}?pageSize=300`, { headers: ADMIN })
  const body = (await res.json()) as { documents?: { name: string; fields: Record<string, unknown> }[] }
  return body.documents ?? []
}

async function readOrder(collection: string, id: string) {
  const store = restServerStore(PROJECT, sa, emulatorFetch)
  return (await store.get<{ deliveryDateHistory?: DeliveryDateChange[]; supplierConfirmationStatus?: string }>(collection, id))!.doc
}

function deps(): Deps {
  let n = 0
  return {
    store: restServerStore(PROJECT, sa, emulatorFetch),
    secret: SECRET,
    now: () => NOW,
    makeId: () => `${RUN}-${Math.random().toString(36).slice(2, 8)}-${++n}`,
    verifyUser: async (h) => h?.replace(/^Bearer /, '') ?? null,
    origin: 'https://pzmstock.pages.dev',
  }
}

async function order(collection: string, id: string) {
  await put(collection, id, {
    docNo: 'PO-00005',
    supplierId: 'ppn',
    supplierName: 'PPN SEAFOOD',
    status: 'ordered',
    locationId: 'main',
    orderedAt: NOW,
    expectedAt: day(2),
    lines: [{ productId: 'p1', productName: 'กุ้ง', unit: 'kg', orderedQty: 5 }],
    sentBy: 'staff1',
    createdBy: 'staff1',
    createdByName: 'Nok',
    createdAt: NOW,
    updatedAt: NOW,
  })
}

beforeAll(async () => {
  // A real RSA key, so the store signs its token request exactly as in production.
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  sa = JSON.stringify({ project_id: PROJECT, client_email: 'fn@pzm-rules-test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` })
  await put('users', 'staff1', { name: 'Nok', role: 'staff', active: true })
})

describe('the supplier answer on a real Firestore (emulator)', () => {
  test('five phones confirming at once: one confirmation, one notification, all told "done"', async () => {
    const id = `${RUN}-five`
    await order('rnd__purchaseOrders', id)
    const d = deps()
    const minted = await mintLink(d, 'Bearer staff1', { brand: 'rnd', poId: id })
    expect(minted.status).toBe(200)
    const token = minted.body.token as string

    const rs = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => answerLink(deps(), token, { action: 'accept', name: `phone ${i}`, requestId: `${RUN}-phone-${i}` })),
    )
    // Everyone gets a success: the winner applied it, the rest found it already done (or,
    // having lost three races in a row, were told to try again: then they wrote nothing).
    for (const r of rs) expect([200, 409]).toContain(r.status)
    expect(rs.filter((r) => r.status === 200 && r.body.replayed === false)).toHaveLength(1)

    const o = await readOrder('rnd__purchaseOrders', id)
    expect(o.supplierConfirmationStatus).toBe('confirmed')
    expect(o.deliveryDateHistory!.filter((h) => h.source === 'supplier')).toHaveLength(1)
    const mine = (await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierConfirmed'))
    expect(mine).toHaveLength(1)

    // Later, again from a sixth phone: success, and still one.
    const again = await answerLink(deps(), token, { action: 'accept', requestId: `${RUN}-phone-6` })
    expect(again.body).toMatchObject({ replayed: true, unchanged: true })
    expect((await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierConfirmed'))).toHaveLength(1)
  })

  test('a real new date is still heard, once', async () => {
    const id = `${RUN}-move`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string
    await answerLink(deps(), token, { action: 'accept', requestId: `${RUN}-move-1` })
    const date = new Date(day(3) + 7 * 3_600_000).toISOString().slice(0, 10)
    const rs = await Promise.all(
      [2, 3, 4].map((i) => answerLink(deps(), token, { action: 'propose', date, requestId: `${RUN}-move-${i}` })),
    )
    expect(rs.filter((r) => r.status === 200 && r.body.replayed === false)).toHaveLength(1)
    const kinds = (await list('rnd__notifications')).filter((n) => n.name.includes(id)).map((n) => n.name.split('/').pop()!.split('__')[0])
    expect(kinds.sort()).toEqual(['supplierConfirmed', 'supplierDateChanged'])
  })
})
