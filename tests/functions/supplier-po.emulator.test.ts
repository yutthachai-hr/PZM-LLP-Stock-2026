// The supplier's answer against a real Firestore (the emulator), through the very store the
// Pages Function uses in production (restServerStore): its batchGet, its updateTime
// precondition and its create-if-absent are Firestore's own here, not the in-memory copy's.
// Owner, 12 Oct 2026: one confirmation of PO-00005 reached the bell five times. Five phones
// answering the same order at the same moment must land one confirmation and one notification.
//
//   npm run test:rules        (starts the Firestore emulator; this file runs with the rules tests)

import { beforeAll, describe, expect, test } from 'vitest'
import { restServerStore } from '../../functions/_lib/serverStore'
import { answerLink, decideDate, mintLink, viewLink, type Deps } from '../../functions/_lib/supplierPo'
import { encodeFields } from '../../worker/src/codec'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import { msToDateKey } from '../../src/lib/supplierConfirmation'
import type { PurchaseOrder } from '../../src/types'

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

async function patchAdmin(collection: string, id: string, doc: Record<string, unknown>) {
  const mask = Object.keys(doc)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&')
  const res = await fetch(`${EMU}/${collection}/${id}?${mask}`, {
    method: 'PATCH',
    headers: ADMIN,
    body: JSON.stringify({ fields: encodeFields(doc) }),
  })
  if (!res.ok) throw new Error(`patch ${collection}/${id}: ${res.status} ${await res.text()}`)
}

async function list(collection: string): Promise<{ name: string; fields: Record<string, unknown> }[]> {
  const docs: { name: string; fields: Record<string, unknown> }[] = []
  let pageToken = ''
  do {
    const url = `${EMU}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const res = await fetch(url, { headers: ADMIN })
    const body = (await res.json()) as { documents?: { name: string; fields: Record<string, unknown> }[]; nextPageToken?: string }
    if (body.documents) docs.push(...body.documents)
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return docs
}

async function readOrder(collection: string, id: string): Promise<PurchaseOrder> {
  const store = restServerStore(PROJECT, sa, emulatorFetch)
  return (await store.get<PurchaseOrder>(collection, id))!.doc
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

async function seen(token: string): Promise<string> {
  const r = await viewLink(deps(), token)
  if (r.status !== 200) throw new Error(`viewLink failed: ${r.status}`)
  return (r.body.view as { expectedState: string }).expectedState
}

async function order(collection: string, id: string, over: Record<string, unknown> = {}) {
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
    ...over,
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
  await put('users', 'mgr1', { name: 'Boss', role: 'manager', active: true })
})

describe('the supplier answer on a real Firestore (emulator)', () => {
  test('five phones confirming at once: one confirmation, one notification, 1 winner and stale409 losers for distinct IDs', async () => {
    const id = `${RUN}-five`
    await order('rnd__purchaseOrders', id)
    const d = deps()
    const minted = await mintLink(d, 'Bearer staff1', { brand: 'rnd', poId: id })
    expect(minted.status).toBe(200)
    const token = minted.body.token as string

    // All five phones capture the same initial expectedState
    const expectedState = await seen(token)

    const rs = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        answerLink(deps(), token, {
          action: 'accept',
          name: `phone ${i}`,
          requestId: `${RUN}-phone-${i}`,
          expectedState,
        }),
      ),
    )
    // 1 winner applies it (200, replayed: false), 4 stale losers get 409
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409])
    expect(rs.filter((r) => r.status === 200 && r.body.replayed === false)).toHaveLength(1)
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.error === 'stale_state')).toBe(true)

    const o = await readOrder('rnd__purchaseOrders', id)
    expect(o.supplierConfirmationStatus).toBe('confirmed')
    expect(o.deliveryDateHistory!.filter((h) => h.source === 'supplier')).toHaveLength(1)
    const mine = (await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierConfirmed'))
    expect(mine).toHaveLength(1)

    // Retry the actual winner, not whichever phone happened to be first in the array.
    const winner = rs.findIndex((r) => r.status === 200)
    const again = await answerLink(deps(), token, { action: 'accept', requestId: `${RUN}-phone-${winner + 1}`, expectedState })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ replayed: true })
    expect((await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierConfirmed'))).toHaveLength(1)

    // Stale phone with distinct ID gets 409
    const stalePhone = await answerLink(deps(), token, { action: 'accept', requestId: `${RUN}-phone-6`, expectedState })
    expect(stalePhone.status).toBe(409)
    expect(stalePhone.body).toEqual({ error: 'stale_state' })
    expect((await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierConfirmed'))).toHaveLength(1)
  })

  test('a real new date is still heard, once', async () => {
    const id = `${RUN}-move`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string

    const state0 = await seen(token)
    await answerLink(deps(), token, { action: 'accept', requestId: `${RUN}-move-1`, expectedState: state0 })

    const state1 = await seen(token)
    const date = msToDateKey(day(3))
    const rs = await Promise.all(
      [2, 3, 4].map((i) =>
        answerLink(deps(), token, { action: 'propose', date, requestId: `${RUN}-move-${i}`, expectedState: state1 }),
      ),
    )
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect(rs.filter((r) => r.status === 200 && r.body.replayed === false)).toHaveLength(1)
    const kinds = (await list('rnd__notifications')).filter((n) => n.name.includes(id)).map((n) => n.name.split('/').pop()!.split('__')[0])
    expect(kinds.sort()).toEqual(['supplierConfirmed', 'supplierDateChanged', 'supplierOpened'])
  })

  test('far proposal requiring approval: held as pending and notifies managers', async () => {
    const id = `${RUN}-far`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string
    const state = await seen(token)
    const farDate = msToDateKey(day(6))
    const r = await answerLink(deps(), token, {
      action: 'propose',
      date: farDate,
      note: 'รอของเข้า',
      requestId: `${RUN}-far-req1`,
      expectedState: state,
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ replayed: false, outcome: 'pending' })

    const o = await readOrder('rnd__purchaseOrders', id)
    expect(o.supplierConfirmationStatus).toBe('pending_date_approval')
    expect(o.pendingDeliveryDate?.date).toBe(day(6))
    expect(o.pendingDeliveryDate?.note).toBe('รอของเข้า')
    expect(o.expectedAt).toBe(day(2))
    expect(o.confirmedDeliveryDate).toBeUndefined()
    expect(o.deliveryDateHistory!.at(-1)).toMatchObject({ action: 'proposed', to: day(6), requestId: `${RUN}-far-req1` })

    const pendingNotifs = (await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierDatePending'))
    expect(pendingNotifs).toHaveLength(1)
  })

  test('manager approves C: order moves to changed and notifies sender', async () => {
    const id = `${RUN}-mgr-approve`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string
    const state = await seen(token)
    await answerLink(deps(), token, {
      action: 'propose',
      date: msToDateKey(day(6)),
      requestId: `${RUN}-mgr-req1`,
      expectedState: state,
    })
    const oPending = await readOrder('rnd__purchaseOrders', id)
    const changeId = oPending.pendingDeliveryDate!.changeId

    const dec = await decideDate(deps(), 'Bearer mgr1', { brand: 'rnd', poId: id, changeId, decision: 'approve' })
    expect(dec.status).toBe(200)

    const oApproved = await readOrder('rnd__purchaseOrders', id)
    expect(oApproved.supplierConfirmationStatus).toBe('changed')
    expect(oApproved.confirmedDeliveryDate).toBe(day(6))
    expect(oApproved.expectedAt).toBe(day(6))
    expect(oApproved.pendingDeliveryDate).toBeUndefined()
    expect(oApproved.deliveryDateHistory!.at(-1)).toMatchObject({ action: 'approved', to: day(6), byId: 'mgr1' })
    expect(oApproved.deliveryDateHistory!.filter((h) => h.action === 'proposed')).toHaveLength(1)

    const approvedNotifs = (await list('rnd__notifications')).filter((n) => n.name.includes(id) && n.name.includes('supplierDateApproved'))
    expect(approvedNotifs).toHaveLength(1)
  })

  test('repeated approved C: no audit, order, or notification change', async () => {
    const id = `${RUN}-rep-c`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string
    const state0 = await seen(token)
    await answerLink(deps(), token, {
      action: 'propose',
      date: msToDateKey(day(6)),
      requestId: `${RUN}-rep-c-1`,
      expectedState: state0,
    })
    const changeId = (await readOrder('rnd__purchaseOrders', id)).pendingDeliveryDate!.changeId
    await decideDate(deps(), 'Bearer mgr1', { brand: 'rnd', poId: id, changeId, decision: 'approve' })

    const oBefore = await readOrder('rnd__purchaseOrders', id)
    const notifsBefore = (await list('rnd__notifications')).filter((n) => n.name.includes(id))

    const stateApproved = await seen(token)
    const r = await answerLink(deps(), token, {
      action: 'propose',
      date: msToDateKey(day(6)),
      requestId: `${RUN}-rep-c-2`,
      expectedState: stateApproved,
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ replayed: true, unchanged: true, outcome: null })

    const oAfter = await readOrder('rnd__purchaseOrders', id)
    expect(oAfter).toEqual(oBefore)

    const notifsAfter = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    expect(notifsAfter).toEqual(notifsBefore)
  })

  test('intentional return to C while P pending withdraws P + superseded/autoApplied audit and notification counts', async () => {
    const id = `${RUN}-return-c`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string

    // 1. Propose far date C (day 6) and manager approves
    const state0 = await seen(token)
    await answerLink(deps(), token, { action: 'propose', date: msToDateKey(day(6)), requestId: `${RUN}-c-1`, expectedState: state0 })
    const changeId = (await readOrder('rnd__purchaseOrders', id)).pendingDeliveryDate!.changeId
    await decideDate(deps(), 'Bearer mgr1', { brand: 'rnd', poId: id, changeId, decision: 'approve' })

    // 2. Propose another far date P (day 8), now pending
    const stateApproved = await seen(token)
    await answerLink(deps(), token, { action: 'propose', date: msToDateKey(day(8)), requestId: `${RUN}-p-2`, expectedState: stateApproved })
    const oPending = await readOrder('rnd__purchaseOrders', id)
    expect(oPending.supplierConfirmationStatus).toBe('pending_date_approval')
    expect(oPending.pendingDeliveryDate?.date).toBe(day(8))

    // 3. Intentionally return to C (day 6) while P is pending
    const stateWithPending = await seen(token)
    const r = await answerLink(deps(), token, {
      action: 'propose',
      date: msToDateKey(day(6)),
      requestId: `${RUN}-return-c-3`,
      expectedState: stateWithPending,
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ replayed: false, outcome: 'changed' })

    // 4. Verify P is withdrawn and C is re-applied
    const oFinal = await readOrder('rnd__purchaseOrders', id)
    expect(oFinal.supplierConfirmationStatus).toBe('changed')
    expect(oFinal.confirmedDeliveryDate).toBe(day(6))
    expect(oFinal.pendingDeliveryDate).toBeUndefined()

    // 5. Audit counts: 1 superseded (withdrawing P) and 1 autoApplied (returning to approved C)
    const superseded = oFinal.deliveryDateHistory!.filter((h) => h.action === 'superseded')
    expect(superseded).toHaveLength(1)
    expect(superseded[0].to).toBe(day(8))

    const autoApplied = oFinal.deliveryDateHistory!.filter((h) => h.action === 'autoApplied')
    expect(autoApplied).toHaveLength(1)
    expect(autoApplied[0].to).toBe(day(6))

    // 6. Notification counts: supplierDateChanged created
    const notifs = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    const kinds = notifs.map((n) => n.name.split('/').pop()!.split('__')[0]).sort()
    expect(kinds).toEqual(['supplierDateApproved', 'supplierDateChanged', 'supplierDatePending', 'supplierDatePending', 'supplierOpened'])
    expect(oFinal.deliveryDateHistory!.slice(0, oPending.deliveryDateHistory!.length)).toEqual(oPending.deliveryDateHistory)
  })

  test('stale TabA after TabB P rejects: no state, audit, or notification change', async () => {
    const id = `${RUN}-stale-taba`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string

    // Approve C, then Tab A opens that approved state.
    const initial = await seen(token)
    await answerLink(deps(), token, { action: 'propose', date: msToDateKey(day(6)), requestId: `${RUN}-stale-approve`, expectedState: initial })
    const changeId = (await readOrder('rnd__purchaseOrders', id)).pendingDeliveryDate!.changeId
    await decideDate(deps(), 'Bearer mgr1', { brand: 'rnd', poId: id, changeId, decision: 'approve' })
    const stateTabA = await seen(token)

    // Tab B proposes P. Tab A must not withdraw P by re-sending unseen C.
    const stateTabB = await seen(token)
    await answerLink(deps(), token, { action: 'propose', date: msToDateKey(day(8)), requestId: `${RUN}-tabB-prop`, expectedState: stateTabB })

    const oBefore = await readOrder('rnd__purchaseOrders', id)
    const notifsBefore = (await list('rnd__notifications')).filter((n) => n.name.includes(id))

    // TabA attempts to submit using stale stateTabA
    const r = await answerLink(deps(), token, { action: 'propose', date: msToDateKey(day(6)), requestId: `${RUN}-tabA-sub`, expectedState: stateTabA })
    expect(r.status).toBe(409)
    expect(r.body).toEqual({ error: 'stale_state' })

    // Persisted order and notifications remain untouched
    const oAfter = await readOrder('rnd__purchaseOrders', id)
    expect(oAfter).toEqual(oBefore)
    expect(oAfter.pendingDeliveryDate?.date).toBe(day(8))
    expect(oAfter.confirmedDeliveryDate).toBe(day(6))

    const notifsAfter = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    expect(notifsAfter).toEqual(notifsBefore)
  })

  test('exact payload lost-response retry after successful write and another transition uses same requestId+old expectedState no duplicate', async () => {
    const id = `${RUN}-lost-resp`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string

    const state0 = await seen(token)
    const payload = { action: 'propose' as const, date: msToDateKey(day(3)), requestId: `${RUN}-lost-req1`, expectedState: state0 }
    const r1 = await answerLink(deps(), token, payload)
    expect(r1.status).toBe(200)
    expect(r1.body.replayed).toBe(false)

    // Another transition moves the order forward
    const state1 = await seen(token)
    const r2 = await answerLink(deps(), token, { action: 'propose', date: msToDateKey(day(4)), requestId: `${RUN}-other-req2`, expectedState: state1 })
    expect(r2.status).toBe(200)

    const oBeforeRetry = await readOrder('rnd__purchaseOrders', id)
    const notifsBeforeRetry = (await list('rnd__notifications')).filter((n) => n.name.includes(id))

    // Exact original payload retried (same requestId, old expectedState)
    const retry = await answerLink(deps(), token, payload)
    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({ replayed: true })

    const oAfterRetry = await readOrder('rnd__purchaseOrders', id)
    expect(oAfterRetry.deliveryDateHistory!.filter((h) => h.requestId === `${RUN}-lost-req1`)).toHaveLength(1)
    expect(oAfterRetry).toEqual(oBeforeRetry)

    const notifsAfterRetry = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    expect(notifsAfterRetry).toEqual(notifsBeforeRetry)
  })

  test('amendment invalidates old approval and old link', async () => {
    const id = `${RUN}-amend`
    await order('rnd__purchaseOrders', id)
    const token1 = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string

    // Propose far date C (day 6) and manager approves
    const state1 = await seen(token1)
    await answerLink(deps(), token1, { action: 'propose', date: msToDateKey(day(6)), requestId: `${RUN}-amend-p1`, expectedState: state1 })
    const changeId = (await readOrder('rnd__purchaseOrders', id)).pendingDeliveryDate!.changeId
    await decideDate(deps(), 'Bearer mgr1', { brand: 'rnd', poId: id, changeId, decision: 'approve' })

    // Synthetic admin PATCH revision then mintLink
    await patchAdmin('rnd__purchaseOrders', id, {
      expectedAt: day(3),
      revision: 1,
      revisions: [
        {
          rev: 1,
          at: NOW,
          by: 'staff1',
          byName: 'Nok',
          reason: 'Order amendment',
          changes: [{ kind: 'expectedAt', from: day(2), to: day(3) }],
        },
      ],
    })

    // The old link dies as soon as the PO is amended, before a replacement is minted.
    expect((await answerLink(deps(), token1, { action: 'propose', date: msToDateKey(day(6)), requestId: `${RUN}-before-mint`, expectedState: state1 })).status).toBe(404)
    const mint2 = await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })
    expect(mint2.status).toBe(200)
    const token2 = mint2.body.token as string
    expect(token2).not.toBe(token1)

    const oAmended = await readOrder('rnd__purchaseOrders', id)
    expect(oAmended.supplierConfirmationStatus).toBe('waiting')
    expect(oAmended.supplierLink?.version).toBe(2)
    expect(oAmended.deliveryDateHistory!.some((h) => h.action === 'reset')).toBe(true)

    // Old link is dead (404 mismatch)
    expect((await viewLink(deps(), token1)).status).toBe(404)
    expect((await answerLink(deps(), token1, { action: 'accept', requestId: `${RUN}-old-ans`, expectedState: state1 })).status).toBe(404)

    // Old approval is invalidated on new link: proposing day(6) again requires manager approval
    const state2 = await seen(token2)
    const resNew = await answerLink(deps(), token2, { action: 'propose', date: msToDateKey(day(6)), requestId: `${RUN}-new-ans`, expectedState: state2 })
    expect(resNew.status).toBe(200)
    expect(resNew.body).toMatchObject({ replayed: false, outcome: 'pending' })

    const oFinal = await readOrder('rnd__purchaseOrders', id)
    expect(oFinal.supplierConfirmationStatus).toBe('pending_date_approval')
    expect(oFinal.pendingDeliveryDate?.date).toBe(day(6))
    expect(oFinal.requestedDeliveryDate).toBe(day(3))
    expect(oFinal.deliveryDateHistory!.filter((h) => h.action === 'approved')).toHaveLength(1)
    expect(oFinal.deliveryDateHistory!.filter((h) => h.action === 'proposed')).toHaveLength(2)
    const notifications = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    expect(notifications.filter((n) => n.name.includes('supplierDatePending'))).toHaveLength(2)
    expect(notifications.filter((n) => n.name.includes('supplierDateApproved'))).toHaveLength(1)
  })

  test('concurrent two-device distinct answers: exactly one applies, one 409, persisted audit and notification counts', async () => {
    const id = `${RUN}-two-dev`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string
    const sharedState = await seen(token)

    const dev1 = { action: 'propose' as const, date: msToDateKey(day(3)), requestId: `${RUN}-two-dev-1`, expectedState: sharedState }
    const dev2 = { action: 'accept' as const, requestId: `${RUN}-two-dev-2`, expectedState: sharedState }

    const rs = await Promise.all([answerLink(deps(), token, dev1), answerLink(deps(), token, dev2)])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    expect(rs.filter((r) => r.status === 200 && r.body.replayed === false)).toHaveLength(1)
    expect(rs.filter((r) => r.status === 409 && r.body.error === 'stale_state')).toHaveLength(1)

    const o = await readOrder('rnd__purchaseOrders', id)
    expect(o.deliveryDateHistory!.filter((h) => h.source === 'supplier')).toHaveLength(1)
    expect(o.supplierActivity!.filter((a) => a.requestId)).toHaveLength(1)
    const winner = rs.findIndex((r) => r.status === 200)
    expect(o.confirmedDeliveryDate).toBe(winner === 0 ? day(3) : day(2))
    expect(o.deliveryDateHistory!.at(-1)?.requestId).toBe(winner === 0 ? dev1.requestId : dev2.requestId)

    const notifs = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    expect(notifs.filter((n) => !n.name.includes('supplierOpened'))).toHaveLength(1)
    expect(notifs.filter((n) => n.name.includes('supplierOpened'))).toHaveLength(1)
  })

  test('same-request concurrent retry lands once and returns 200 for both', async () => {
    const id = `${RUN}-same-retry`
    await order('rnd__purchaseOrders', id)
    const token = (await mintLink(deps(), 'Bearer staff1', { brand: 'rnd', poId: id })).body.token as string
    const state = await seen(token)

    const payload = { action: 'accept' as const, requestId: `${RUN}-same-retry-1`, expectedState: state }
    const rs = await Promise.all([answerLink(deps(), token, payload), answerLink(deps(), token, payload)])
    expect(rs.map((r) => r.status)).toEqual([200, 200])
    expect(rs.filter((r) => r.body.replayed === false)).toHaveLength(1)
    expect(rs.filter((r) => r.body.replayed === true)).toHaveLength(1)

    const o = await readOrder('rnd__purchaseOrders', id)
    expect(o.deliveryDateHistory!.filter((h) => h.requestId === `${RUN}-same-retry-1`)).toHaveLength(1)
    expect(o.supplierConfirmationStatus).toBe('confirmed')
    expect(o.confirmedDeliveryDate).toBe(day(2))

    const notifs = (await list('rnd__notifications')).filter((n) => n.name.includes(id))
    expect(notifs.filter((n) => n.name.includes('supplierConfirmed'))).toHaveLength(1)
    expect(notifs).toHaveLength(2) // one first-view courtesy and one confirmed event
  })
})
