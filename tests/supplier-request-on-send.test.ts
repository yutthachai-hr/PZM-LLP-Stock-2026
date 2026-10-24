// A2 (R55 analysis, R66): opening the send wizard only PREPARES the supplier link. The order says
// "requested / waiting for the supplier" only once the sheet carrying the link was sent.
//
//   npx vitest run tests/supplier-request-on-send.test.ts

import { describe, expect, test } from 'vitest'
import {
  applyPatch,
  askedOnSend,
  confirmationBadge,
  issueLink,
  linkProblem,
  markRequested,
  mintLink,
  respond,
} from '../src/lib/supplierConfirmation'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { PurchaseOrder } from '../src/types'

const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 5, 3)), '10:00')
const day = (n: number) => bkkDayStart(NOW) + n * DAY_MS
let n = 0
const makeId = () => `a2-${++n}`
const actor = { id: 'u1', name: 'Nok' }
const mintCtx = { now: NOW, actor, ttlDays: 30, makeId }

function order(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po1',
    docNo: 'PO-00001',
    supplierId: 's1',
    supplierName: 'BETAGRO',
    status: 'ordered',
    locationId: 'main',
    orderedAt: NOW,
    expectedAt: day(3),
    lines: [{ productId: 'p1', productName: 'BACON', unit: 'แพ็ค', orderedQty: 4 }],
    createdBy: 'u1',
    createdByName: 'Nok',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function minted(o: PurchaseOrder, at = NOW): PurchaseOrder {
  const r = mintLink(o, { ...mintCtx, now: at })
  if (!r.ok) throw new Error('mint refused')
  return r.patch ? applyPatch(o, r.patch) : o
}

function requested(o: PurchaseOrder, at = NOW + 1): PurchaseOrder {
  const r = markRequested(o, { now: at, actor, makeId, version: o.supplierLink!.version })
  if (!r.ok) throw new Error(r.error)
  return r.patch ? applyPatch(o, r.patch) : o
}

/** An amendment by purchasing, as the order service records it. */
function amend(o: PurchaseOrder, rev: number, date?: number): PurchaseOrder {
  const changes = date === undefined
    ? [{ kind: 'qty' as const, productName: 'BACON', unit: 'แพ็ค', from: 4, to: 6 }]
    : [{ kind: 'expectedAt' as const, from: o.expectedAt, to: date }]
  return {
    ...o,
    revision: rev,
    ...(date === undefined ? {} : { expectedAt: date }),
    revisions: [...(o.revisions ?? []), { rev, at: NOW, by: 'u1', byName: 'Nok', reason: 'r', changes }],
  } as PurchaseOrder
}

describe('A2: preparing the link records nothing as asked', () => {
  test('A2-1/2 opening the wizard (then cancelling or failing) leaves status, history and activity untouched', () => {
    const o = minted(order())
    expect(o.supplierLink).toMatchObject({ version: 1, rev: 0, unsent: true })
    expect(o.supplierConfirmationStatus).toBeUndefined()
    expect(o.requestedDeliveryDate).toBeUndefined()
    expect(o.deliveryDateHistory ?? []).toEqual([])
    expect(o.supplierActivity ?? []).toEqual([])
    expect(confirmationBadge(o)).toBeNull()
  })

  test('A2-3 a sent sheet marks the order requested once: waiting, one requested entry, one linkIssued', () => {
    const o = requested(minted(order()))
    expect(o.supplierConfirmationStatus).toBe('waiting')
    expect(o.requestedDeliveryDate).toBe(day(3))
    expect(o.deliveryDateHistory?.map((h) => h.action)).toEqual(['requested'])
    expect(o.supplierActivity?.map((a) => a.kind)).toEqual(['linkIssued'])
    expect(o.supplierLink).not.toHaveProperty('unsent')
    expect(o.supplierLink).not.toHaveProperty('baseRev')
  })

  test('A2-4 wizard opened twice and sent twice: the same link, still one requested entry', () => {
    const once = minted(order())
    expect(mintLink(once, { ...mintCtx, now: NOW + 5 })).toEqual({ ok: true, patch: null, version: 1, expiresAt: once.supplierLink!.expiresAt })
    const sent = requested(once)
    expect(markRequested(sent, { now: NOW + 9, actor, makeId, version: 1 })).toEqual({ ok: true, patch: null })
    expect(sent.deliveryDateHistory).toHaveLength(1)
  })

  test('A2-5 an order amended between preparing and sending refuses the stale mark', () => {
    const o = amend(minted(order()), 1)
    expect(markRequested(o, { now: NOW, actor, makeId, version: 1 })).toEqual({ ok: false, error: 'stale' })
    expect(markRequested(minted(order()), { now: NOW, actor, makeId, version: 2 })).toEqual({ ok: false, error: 'stale' })
    expect(markRequested(order(), { now: NOW, actor, makeId, version: 1 })).toEqual({ ok: false, error: 'stale' })
    expect(markRequested({ ...minted(order()), status: 'received' }, { now: NOW, actor, makeId, version: 1 })).toEqual({ ok: false, error: 'notOpen' })
  })

  test('a link already requested before A2 (no unsent flag) is never marked again', () => {
    const legacy = order({ supplierLink: { version: 3, rev: 0, issuedAt: NOW, issuedBy: 'u1', expiresAt: NOW + DAY_MS }, supplierConfirmationStatus: 'confirmed' })
    expect(markRequested(legacy, { now: NOW, actor, makeId, version: 3 })).toEqual({ ok: true, patch: null })
  })
})

describe('A2: an amended order asks again only when the new sheet is sent', () => {
  test('preparing the amended link keeps the agreed answer; sending resets it', () => {
    let o = requested(minted(order()))
    const ans = respond(o, { action: 'accept', requestId: 'req-accept-a2' }, { now: NOW + 2, maxPostponeDays: 2, makeId })
    if (!ans.ok || ans.replayed) throw new Error()
    o = amend(applyPatch(o, ans.patch), 1)
    const prepared = minted(o, NOW + 3)
    expect(prepared.supplierLink).toMatchObject({ version: 2, rev: 1, unsent: true, baseRev: 0 })
    expect(prepared.supplierConfirmationStatus).toBe('confirmed')
    expect(prepared.deliveryDateHistory?.map((h) => h.action)).toEqual(['requested', 'accepted'])
    const sent = requested(prepared, NOW + 4)
    expect(sent.supplierConfirmationStatus).toBe('waiting')
    expect(sent.deliveryDateHistory?.map((h) => h.action)).toEqual(['requested', 'accepted', 'reset'])
    expect(sent.supplierActivity?.map((a) => a.kind)).toEqual(['linkIssued', 'accepted', 'reset', 'linkIssued'])
  })

  test('a date amendment: the caption already shows the new date, the order asks for it once sent', () => {
    const o = minted(amend(requested(minted(order())), 1, day(5)), NOW + 3)
    expect(o.requestedDeliveryDate).toBe(day(3)) // nothing asked yet
    expect(askedOnSend(o)).toBe(day(5)) // what the sheet about to go out must say
    const sent = requested(o, NOW + 4)
    expect(sent.requestedDeliveryDate).toBe(day(5))
    expect(sent.deliveryDateHistory?.at(-2)).toMatchObject({ action: 'requested', from: day(3), to: day(5) })
  })

  test('amended twice before sending: the second preparation still remembers the last asked revision', () => {
    const o = minted(amend(minted(amend(requested(minted(order())), 1)), 2), NOW + 5)
    expect(o.supplierLink).toMatchObject({ version: 3, rev: 2, unsent: true, baseRev: 0 })
    expect(requested(o).supplierActivity?.map((a) => a.kind)).toEqual(['linkIssued', 'reset', 'linkIssued'])
  })

  test('the old link stops working the moment the amended one is prepared (unchanged rule)', () => {
    const o = minted(amend(requested(minted(order())), 1))
    expect(linkProblem(o, { supplierId: 's1', version: 1 })).toBe('mismatch')
    expect(linkProblem(o, { supplierId: 's1', version: 2 })).toBeNull()
  })
})

describe('issueLink (revoke) is exactly prepare + send in one step', () => {
  test('first link: the same order as before A2', () => {
    const r = issueLink(order(), mintCtx)
    if (!r.ok || !r.patch) throw new Error()
    const o = applyPatch(order(), r.patch)
    expect(o.supplierLink).toEqual({ version: 1, rev: 0, issuedAt: NOW, issuedBy: 'u1', expiresAt: NOW + 30 * DAY_MS })
    expect(o.supplierConfirmationStatus).toBe('waiting')
    expect(o.deliveryDateHistory?.map((h) => h.action)).toEqual(['requested'])
  })
})
