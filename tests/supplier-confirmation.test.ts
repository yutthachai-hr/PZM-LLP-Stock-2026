// The supplier's answer to a delivery date, as pure rules (src/lib/supplierConfirmation.ts):
// what applies at once, what waits for a หัวหน้า, and that the date asked for never moves.
//
//   npm test

import { describe, expect, test } from 'vitest'
import {
  applyPatch,
  confirmationBadge,
  dateKeyToMs,
  decide,
  evaluateProposal,
  isReplay,
  issueLink,
  lastRejection,
  linkProblem,
  msToDateKey,
  openLink,
  requestedOf,
  respond,
  SUPPLIER_LIST_MAX,
  supplierTimeline,
  supplierStateOf,
} from '../src/lib/supplierConfirmation'
import { bkkAtTime, bkkDayEnd, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { DeliveryDateChange, PurchaseOrder } from '../src/types'

// Monday 2026-10-05, 10:00 Bangkok.
const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 5, 3)), '10:00')
const TODAY = bkkDayStart(NOW)
const day = (n: number) => TODAY + n * DAY_MS

let n = 0
const makeId = () => `id${++n}`
const actor = { id: 'u1', name: 'Nok' }

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

/** An order with a live link, as the server leaves it after the first send. */
function linked(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  const o = order(over)
  const r = issueLink(o, { now: NOW, actor, ttlDays: 30, makeId })
  if (!r.ok || !r.patch) throw new Error('no link')
  return applyPatch(o, r.patch)
}

const ctx = { now: NOW, maxPostponeDays: 2, makeId }

describe('the state a supplier tab saw', () => {
  test('view bookkeeping and unrelated writes do not make a tab stale', () => {
    const o = linked()
    const state = supplierStateOf(o)
    expect(supplierStateOf({ ...o, updatedAt: NOW + 1 })).toBe(state)
    expect(supplierStateOf(applyPatch(o, openLink(o, o.supplierLink!.version, NOW, makeId)!))).toBe(state)
  })
  test('an intervening event is detected even if all visible dates return to the same state', () => {
    const o = linked()
    const h: DeliveryDateChange = { id: 'new-event', at: NOW, source: 'supplier', action: 'autoApplied', to: day(3), byName: 'Supplier' }
    expect(supplierStateOf({ ...o, deliveryDateHistory: [...o.deliveryDateHistory!, h] })).not.toBe(supplierStateOf(o))
  })
  test('an amendment kills the old link immediately, before another link is minted', () => {
    const o = linked()
    const c = { supplierId: o.supplierId, version: o.supplierLink!.version, expMs: o.supplierLink!.expiresAt }
    expect(linkProblem({ ...o, revision: 1 }, c)).toBe('mismatch')
    expect(supplierStateOf({ ...o, revision: 1 })).not.toBe(supplierStateOf(o))
  })
})

describe('dates as the page sends them', () => {
  test('YYYY-MM-DD is the Bangkok day, and back', () => {
    expect(dateKeyToMs('2026-10-08')).toBe(day(3))
    expect(msToDateKey(day(3) + 5 * 3_600_000)).toBe('2026-10-08')
  })
  test('anything else is not a date', () => {
    for (const bad of ['', '2026-13-01', '2026-02-30', '8/10/2026', '2026-10-8', 'x']) expect(dateKeyToMs(bad)).toBeNull()
  })
})

describe('what may apply on its own (owner: 2 days later, earlier any time from today)', () => {
  const ev = (proposed: number | null, requested: number | undefined = day(3), max = 2) =>
    evaluateProposal({ requested, proposed, now: NOW, maxPostponeDays: max })

  test('the past is refused; today is fine', () => {
    expect(ev(day(-1))).toEqual({ ok: false, error: 'past' })
    expect(ev(day(0))).toMatchObject({ ok: true, mode: 'auto' })
  })
  test('earlier than asked applies', () => expect(ev(day(1))).toEqual({ ok: true, mode: 'auto', days: -2 }))
  test('up to two days later applies; three waits', () => {
    expect(ev(day(5))).toEqual({ ok: true, mode: 'auto', days: 2 })
    expect(ev(day(6))).toEqual({ ok: true, mode: 'needsApproval', days: 3 })
  })
  test('with a limit of 0 every later date waits', () => {
    expect(ev(day(4), day(3), 0)).toMatchObject({ mode: 'needsApproval' })
    expect(ev(day(3), day(3), 0)).toMatchObject({ mode: 'auto' })
  })
  test('nothing asked for: any date from today applies', () =>
    expect(evaluateProposal({ requested: undefined, proposed: day(40), now: NOW, maxPostponeDays: 2 })).toMatchObject({ ok: true, mode: 'auto' }))
  test('four months out is a typo', () => expect(ev(day(121))).toEqual({ ok: false, error: 'tooFar' }))
  test('no date', () => expect(ev(null)).toEqual({ ok: false, error: 'invalid' }))
})

describe('an order sent before links existed', () => {
  test('reads its expectedAt as the date asked for and shows no badge', () => {
    const o = order()
    expect(requestedOf(o)).toBe(day(3))
    expect(confirmationBadge(o)).toBeNull()
    expect(supplierTimeline(o)).toEqual([])
  })
})

describe('issuing the link', () => {
  test('the first link snapshots the date asked for and waits for the supplier', () => {
    const o = linked()
    expect(o.requestedDeliveryDate).toBe(day(3))
    expect(o.supplierConfirmationStatus).toBe('waiting')
    expect(o.supplierLink).toMatchObject({ version: 1, rev: 0, issuedBy: 'u1', expiresAt: NOW + 30 * DAY_MS })
    expect(o.deliveryDateHistory?.map((h) => h.action)).toEqual(['requested'])
    expect(o.supplierActivity?.map((a) => a.kind)).toEqual(['linkIssued'])
    expect(confirmationBadge(o)).toEqual({ label: 'รอผู้ขายยืนยัน', color: 'amber' })
  })

  test('sending again gives the same link and writes nothing', () => {
    const o = linked()
    expect(issueLink(o, { now: NOW + 60_000, actor, ttlDays: 30, makeId })).toEqual({
      ok: true,
      patch: null,
      version: 1,
      expiresAt: o.supplierLink!.expiresAt,
    })
  })

  test('a draft, a received or a cancelled order gets no link', () => {
    for (const o of [order({ status: 'draft' }), order({ status: 'received' }), order({ status: 'cancelled' })]) {
      expect(issueLink(o, { now: NOW, actor, ttlDays: 30, makeId })).toEqual({ ok: false, error: 'notOpen' })
    }
  })

  // Owner, 21 Oct 2026: goods still owed after a part receipt keep the order, and its link, open.
  test('a part-received order still owed keeps the same link', () => {
    const o = { ...linked(), receipts: [{ docNo: 'R', date: NOW, invoiceNo: 'i', byId: 'u', byName: 'u', lines: [] }] }
    expect(issueLink(o, { now: NOW + 40 * DAY_MS, actor, ttlDays: 30, makeId })).toMatchObject({ ok: true, patch: null, version: 1 })
  })

  test('an amended order gets a new link and must be confirmed again', () => {
    let o = linked()
    const ans = respond(o, { action: 'accept', requestId: 'req-accept1' }, ctx)
    if (!ans.ok || ans.replayed) throw new Error()
    o = applyPatch(o, ans.patch)
    // Purchasing changes a quantity (not the date): revision 1.
    o = { ...o, revision: 1, revisions: [{ rev: 1, at: NOW, by: 'u1', byName: 'Nok', reason: 'more', changes: [{ kind: 'qty', productName: 'BACON', unit: 'แพ็ค', from: 4, to: 6 }] }] }
    const r = issueLink(o, { now: NOW + 1, actor, ttlDays: 30, makeId })
    if (!r.ok || !r.patch) throw new Error()
    const next = applyPatch(o, r.patch)
    expect(next.supplierLink?.version).toBe(2)
    expect(next.supplierConfirmationStatus).toBe('waiting')
    expect(next.requestedDeliveryDate).toBe(day(3))
    expect(next.confirmedDeliveryDate).toBe(day(3)) // the date itself was not touched
    expect(linkProblem(next, { supplierId: 's1', version: 1 })).toBe('mismatch')
  })

  test('an amendment that moves the date asks for the new one; the old is in the history', () => {
    let o = linked()
    o = { ...o, expectedAt: day(6), revision: 1, revisions: [{ rev: 1, at: NOW, by: 'u1', byName: 'Nok', reason: 'later', changes: [{ kind: 'expectedAt', from: day(3), to: day(6) }] }] }
    const r = issueLink(o, { now: NOW + 1, actor, ttlDays: 30, makeId })
    if (!r.ok || !r.patch) throw new Error()
    const next = applyPatch(o, r.patch)
    expect(next.requestedDeliveryDate).toBe(day(6))
    expect(next.confirmedDeliveryDate).toBeUndefined()
    const asked = next.deliveryDateHistory!.filter((h) => h.action === 'requested')
    expect(asked.map((h) => [h.from, h.to])).toEqual([[undefined, day(3)], [day(3), day(6)]])
  })
})

describe('the supplier answers', () => {
  test('accept: the date asked for is confirmed and expectedAt stays on it', () => {
    const o = linked()
    const r = respond(o, { action: 'accept', name: '  Somchai ', note: 'ส่งเช้า', requestId: 'req-a' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    expect(r.outcome).toBe('confirmed')
    const next = applyPatch(o, r.patch)
    expect(next).toMatchObject({
      supplierConfirmationStatus: 'confirmed',
      confirmedDeliveryDate: day(3),
      expectedAt: day(3),
      requestedDeliveryDate: day(3),
      supplierConfirmedAt: NOW,
      supplierConfirmedBy: { via: 'link', name: 'Somchai' },
      supplierDeliveryNote: 'ส่งเช้า',
    })
    expect(confirmationBadge(next)?.label).toBe('ผู้ขายยืนยันแล้ว')
  })

  test('a date within the range applies: confirmed date and expectedAt move, the asked date does not', () => {
    const o = linked()
    const r = respond(o, { action: 'propose', date: day(5), requestId: 'req-b' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    expect(r.outcome).toBe('changed')
    const next = applyPatch(o, r.patch)
    expect(next.confirmedDeliveryDate).toBe(day(5))
    expect(next.expectedAt).toBe(day(5))
    expect(next.requestedDeliveryDate).toBe(day(3))
    expect(next.deliveryDateHistory!.at(-1)).toMatchObject({ action: 'autoApplied', from: day(3), to: day(5), source: 'supplier', byName: 'BETAGRO' })
    expect(confirmationBadge(next)?.label).toBe('ผู้ขายเปลี่ยนวันส่ง')
  })

  test('a date beyond the range waits; nothing the calendar reads moves', () => {
    const o = linked()
    const r = respond(o, { action: 'propose', date: day(9), note: 'รถเสีย', requestId: 'req-c' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    expect(r.outcome).toBe('pending')
    const next = applyPatch(o, r.patch)
    expect(next.supplierConfirmationStatus).toBe('pending_date_approval')
    expect(next.pendingDeliveryDate).toMatchObject({ date: day(9), note: 'รถเสีย', changeId: r.change.id })
    expect(next.expectedAt).toBe(day(3))
    expect(next.confirmedDeliveryDate).toBeUndefined()
    expect(r.patch).not.toHaveProperty('requestedDeliveryDate')
    expect(confirmationBadge(next)).toEqual({ label: 'รออนุมัติวันส่ง', color: 'red' })
  })

  test('a newer answer replaces one still waiting', () => {
    let o = linked()
    const first = respond(o, { action: 'propose', date: day(9), requestId: 'req-d1' }, ctx)
    if (!first.ok || first.replayed) throw new Error()
    o = applyPatch(o, first.patch)
    const second = respond(o, { action: 'propose', date: day(4), requestId: 'req-d2' }, ctx)
    if (!second.ok || second.replayed) throw new Error()
    expect(second.supersededChangeId).toBe(first.change.id)
    const next = applyPatch(o, second.patch)
    expect(next.pendingDeliveryDate).toBeUndefined()
    expect(next.supplierConfirmationStatus).toBe('changed')
    expect(next.deliveryDateHistory!.map((h) => h.action)).toEqual(['requested', 'proposed', 'superseded', 'autoApplied'])
  })

  test('the same request twice is applied once', () => {
    let o = linked()
    const r = respond(o, { action: 'propose', date: day(4), requestId: 'req-e' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    o = applyPatch(o, r.patch)
    expect(isReplay(o, 'req-e')).toBe(true)
    expect(respond(o, { action: 'propose', date: day(5), requestId: 'req-e' }, ctx)).toEqual({ ok: true, replayed: true })
  })

  test('the link may be used again and every answer is kept', () => {
    let o = linked()
    for (const [i, d] of [day(4), day(5), day(3)].entries()) {
      const r = respond(o, { action: 'propose', date: d, requestId: `req-f${i}` }, ctx)
      if (!r.ok || r.replayed) throw new Error()
      o = applyPatch(o, r.patch)
    }
    expect(o.confirmedDeliveryDate).toBe(day(3))
    expect(o.supplierConfirmationStatus).toBe('confirmed')
    expect(o.deliveryDateHistory!.filter((h) => h.source === 'supplier')).toHaveLength(3)
  })

  test('accepting needs a date asked for, not in the past', () => {
    const none = linked({ expectedAt: undefined })
    expect(respond(none, { action: 'accept', requestId: 'req-g1' }, ctx)).toEqual({ ok: false, error: 'noRequestedDate' })
    const late = linked({ expectedAt: day(-1) })
    expect(respond(late, { action: 'accept', requestId: 'req-g2' }, ctx)).toEqual({ ok: false, error: 'past' })
  })

  test('a full history refuses further answers rather than growing the document', () => {
    const o = linked()
    const filler: DeliveryDateChange[] = Array.from({ length: SUPPLIER_LIST_MAX - 2 }, (_, i) => ({ id: `f${i}`, at: NOW, source: 'supplier', action: 'autoApplied', byName: 'x' }))
    expect(respond({ ...o, deliveryDateHistory: filler }, { action: 'propose', date: day(4), requestId: 'req-h' }, ctx)).toEqual({ ok: false, error: 'full' })
  })

  test('notes and names are trimmed, stripped and cut', () => {
    const o = linked()
    const r = respond(o, { action: 'accept', note: `a\u0000b${'x'.repeat(400)}`, name: '   ', requestId: 'req-i' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    expect(r.change.note).toHaveLength(300)
    expect(r.change.note!.startsWith('ab')).toBe(true)
    expect(r.change.byName).toBe('BETAGRO')
  })
})

describe('a หัวหน้า decides a date beyond the range', () => {
  function pendingOrder() {
    const o = linked()
    const r = respond(o, { action: 'propose', date: day(9), name: 'Somchai', requestId: 'req-p' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    return { o: applyPatch(o, r.patch), changeId: r.change.id }
  }
  const boss = { id: 'm1', name: 'Boss' }

  test('approve applies it as an in-range answer would', () => {
    const { o, changeId } = pendingOrder()
    const r = decide(o, { changeId, decision: 'approve' }, boss, NOW + 1, makeId)
    if (!r.ok) throw new Error()
    const next = applyPatch(o, r.patch)
    expect(next).toMatchObject({ supplierConfirmationStatus: 'changed', confirmedDeliveryDate: day(9), expectedAt: day(9), requestedDeliveryDate: day(3), supplierConfirmedBy: { via: 'link', name: 'Somchai' } })
    expect(next.pendingDeliveryDate).toBeUndefined()
    expect(next.deliveryDateHistory!.at(-1)).toMatchObject({ action: 'approved', source: 'purchasing', byName: 'Boss', byId: 'm1' })
  })

  test('reject needs a reason, keeps the dates, and the page can say why', () => {
    const { o, changeId } = pendingOrder()
    expect(decide(o, { changeId, decision: 'reject' }, boss, NOW, makeId)).toEqual({ ok: false, error: 'reasonRequired' })
    const r = decide(o, { changeId, decision: 'reject', reason: 'ร้านต้องใช้ของ' }, boss, NOW, makeId)
    if (!r.ok) throw new Error()
    const next = applyPatch(o, r.patch)
    expect(next.supplierConfirmationStatus).toBe('waiting')
    expect(next.expectedAt).toBe(day(3))
    expect(lastRejection(next)).toMatchObject({ to: day(9), note: 'ร้านต้องใช้ของ' })
  })

  test('a stale decision (answer replaced, or already decided) is refused', () => {
    const { o, changeId } = pendingOrder()
    expect(decide(o, { changeId: 'other', decision: 'approve' }, boss, NOW, makeId)).toEqual({ ok: false, error: 'stale' })
    const r = decide(o, { changeId, decision: 'approve' }, boss, NOW, makeId)
    if (!r.ok) throw new Error()
    expect(decide(applyPatch(o, r.patch), { changeId, decision: 'approve' }, boss, NOW, makeId)).toEqual({ ok: false, error: 'stale' })
  })

  test('a refusal after an earlier agreement keeps that agreement', () => {
    let o = linked()
    const a = respond(o, { action: 'propose', date: day(4), requestId: 'req-q1' }, ctx)
    if (!a.ok || a.replayed) throw new Error()
    o = applyPatch(o, a.patch)
    const p = respond(o, { action: 'propose', date: day(10), requestId: 'req-q2' }, ctx)
    if (!p.ok || p.replayed) throw new Error()
    o = applyPatch(o, p.patch)
    const r = decide(o, { changeId: p.change.id, decision: 'reject', reason: 'no' }, boss, NOW, makeId)
    if (!r.ok) throw new Error()
    const next = applyPatch(o, r.patch)
    expect(next.supplierConfirmationStatus).toBe('changed')
    expect(next.confirmedDeliveryDate).toBe(day(4))
  })
})

describe('how long the link answers: as long as its order is open (owner, 21 Oct 2026)', () => {
  test('past the delivery day, past a waiting date and past the old 30-day cap it still speaks for the order', () => {
    let o = linked()
    const r = respond(o, { action: 'propose', date: day(9), requestId: 'req-r' }, ctx)
    if (!r.ok || r.replayed) throw new Error()
    o = applyPatch(o, r.patch)
    expect(linkProblem(o, { supplierId: 's1', version: 1 })).toBeNull()
    expect(linkProblem(linked({ expectedAt: undefined }), { supplierId: 's1', version: 1 })).toBeNull()
  })
  test('the same link is handed out again however late, without a new version', () => {
    const o = linked()
    expect(issueLink(o, { now: NOW + 90 * DAY_MS, actor, ttlDays: 30, makeId })).toMatchObject({ ok: true, patch: null, version: 1 })
  })
  test('a different supplier, a received or a cancelled order', () => {
    const o = linked()
    const claims = { supplierId: 's1', version: 1, expMs: NOW + 30 * DAY_MS }
    expect(linkProblem(o, { ...claims, supplierId: 's2' })).toBe('mismatch')
    expect(linkProblem({ ...o, status: 'cancelled' }, claims)).toBe('closed')
    expect(linkProblem({ ...o, status: 'received' }, claims)).toBe('closed')
  })
})

describe('the first view', () => {
  test('is recorded once per link version', () => {
    const o = linked()
    const p = openLink(o, 1, NOW + 5, makeId)
    expect(p?.supplierLink?.openedAt).toBe(NOW + 5)
    const opened = applyPatch(o, p!)
    expect(openLink(opened, 1, NOW + 9, makeId)).toBeNull()
    expect(openLink(o, 2, NOW, makeId)).toBeNull()
    expect(supplierTimeline(opened)[0].kind).toBe('opened')
  })
})

// Owner, 12 Oct 2026: five identical "PPN SEAFOOD confirmed PO-00005 for 14 Oct" in the bell.
// The page offers the same "confirm" button again after a success, and every press carried a
// fresh requestId, so each one was a new answer: a new history entry, a new change id, a new
// notification. An answer that leaves the order exactly as it is is not a new event.
describe('the same answer again is not a new event', () => {
  const apply = (o: PurchaseOrder, input: Parameters<typeof respond>[1], c = ctx) => {
    const r = respond(o, input, c)
    if (!r.ok || r.replayed) throw new Error(`expected a new answer, got ${JSON.stringify(r)}`)
    return applyPatch(o, r.patch)
  }
  const UNCHANGED = { ok: true, replayed: true, unchanged: true }

  test('accepting again with a new requestId changes nothing', () => {
    const o = apply(linked(), { action: 'accept', requestId: 'req-dup1' })
    expect(respond(o, { action: 'accept', requestId: 'req-dup2' }, { ...ctx, now: NOW + 60_000 })).toEqual(UNCHANGED)
  })

  test('another name or note on the same answer is not a new confirmation either', () => {
    const o = apply(linked(), { action: 'accept', name: 'Somchai', note: 'ส่งเช้า', requestId: 'req-dup3' })
    expect(respond(o, { action: 'accept', name: 'Somsri', note: 'ส่งบ่าย', requestId: 'req-dup4' }, ctx)).toEqual(UNCHANGED)
  })

  test('picking the date already agreed is the same answer, however it is sent', () => {
    const viaAccept = apply(linked(), { action: 'accept', requestId: 'req-dup5' })
    expect(respond(viaAccept, { action: 'propose', date: day(3), requestId: 'req-dup6' }, ctx)).toEqual(UNCHANGED)
    const viaPick = apply(linked(), { action: 'propose', date: day(5), requestId: 'req-dup7' })
    expect(respond(viaPick, { action: 'propose', date: day(5) + 3_600_000, requestId: 'req-dup8' }, ctx)).toEqual(UNCHANGED)
  })

  test('the same date still waiting for approval is not asked for twice', () => {
    const o = apply(linked(), { action: 'propose', date: day(9), requestId: 'req-dup9' })
    expect(respond(o, { action: 'propose', date: day(9), note: 'อีกครั้ง', requestId: 'req-dup10' }, ctx)).toEqual(UNCHANGED)
  })

  test('an unchanged answer succeeds even when the history is full', () => {
    const o = apply(linked(), { action: 'accept', requestId: 'req-dup11' })
    const filler: DeliveryDateChange[] = Array.from({ length: SUPPLIER_LIST_MAX - 2 }, (_, i) => ({ id: `f${i}`, at: NOW, source: 'supplier', action: 'autoApplied', byName: 'x' }))
    expect(respond({ ...o, deliveryDateHistory: [...filler, ...o.deliveryDateHistory!] }, { action: 'accept', requestId: 'req-dup12' }, ctx)).toEqual(UNCHANGED)
  })

  test('a different date is a new event: changed, then back to the date asked for', () => {
    let o = apply(linked(), { action: 'accept', requestId: 'req-dup13' })
    o = apply(o, { action: 'propose', date: day(4), requestId: 'req-dup14' })
    expect(o.supplierConfirmationStatus).toBe('changed')
    o = apply(o, { action: 'accept', requestId: 'req-dup15' })
    expect(o.supplierConfirmationStatus).toBe('confirmed')
    expect(o.deliveryDateHistory!.filter((h) => h.source === 'supplier').map((h) => h.action)).toEqual(['accepted', 'autoApplied', 'accepted'])
  })

  test('an answer to a date waiting for approval replaces it, even with the date agreed before', () => {
    let o = apply(linked(), { action: 'accept', requestId: 'req-dup16' })
    o = apply(o, { action: 'propose', date: day(9), requestId: 'req-dup17' })
    o = apply(o, { action: 'accept', requestId: 'req-dup18' })
    expect(o.pendingDeliveryDate).toBeUndefined()
    expect(o.supplierConfirmationStatus).toBe('confirmed')
  })

  test('an amended order is confirmed again on its new link', () => {
    let o = apply(linked(), { action: 'accept', requestId: 'req-dup19' })
    o = { ...o, revision: 1, revisions: [{ rev: 1, at: NOW, by: 'u1', byName: 'Nok', reason: 'more', changes: [{ kind: 'qty', productName: 'BACON', unit: 'แพ็ค', from: 4, to: 6 }] }] }
    const r = issueLink(o, { now: NOW + 1, actor, ttlDays: 30, makeId })
    if (!r.ok || !r.patch) throw new Error()
    o = applyPatch(o, r.patch)
    expect(o.confirmedDeliveryDate).toBe(day(3)) // kept by the reset, but no longer agreed
    o = apply(o, { action: 'accept', requestId: 'req-dup20' })
    expect(o.supplierConfirmationStatus).toBe('confirmed')
    expect(respond(o, { action: 'accept', requestId: 'req-dup21' }, ctx)).toEqual(UNCHANGED)
  })

  test('after a refusal the supplier may answer the date that stands, once', () => {
    let o = apply(linked(), { action: 'propose', date: day(4), requestId: 'req-dup22' })
    const p = respond(o, { action: 'propose', date: day(10), requestId: 'req-dup23' }, ctx)
    if (!p.ok || p.replayed) throw new Error()
    o = applyPatch(o, p.patch)
    const r = decide(o, { changeId: p.change.id, decision: 'reject', reason: 'no' }, { id: 'm1', name: 'Boss' }, NOW, makeId)
    if (!r.ok) throw new Error()
    o = applyPatch(o, r.patch)
    expect(lastRejection(o)).toBeDefined()
    o = apply(o, { action: 'propose', date: day(4), requestId: 'req-dup24' })
    expect(lastRejection(o)).toBeUndefined()
    expect(respond(o, { action: 'propose', date: day(4), requestId: 'req-dup25' }, ctx)).toEqual(UNCHANGED)
  })

  // Review of #14: a far date a หัวหน้า approved, sent again from a stale tab, re-opened the
  // approval and rang the bell again.
  test('a far date already approved, sent again, is not asked for again', () => {
    let o = linked()
    const p = respond(o, { action: 'propose', date: day(9), requestId: 'req-dup26' }, ctx)
    if (!p.ok || p.replayed) throw new Error()
    o = applyPatch(o, p.patch)
    const r = decide(o, { changeId: p.change.id, decision: 'approve' }, { id: 'm1', name: 'Boss' }, NOW, makeId)
    if (!r.ok) throw new Error()
    o = applyPatch(o, r.patch)
    expect(o.supplierConfirmationStatus).toBe('changed')
    expect(respond(o, { action: 'propose', date: day(9), requestId: 'req-dup27' }, { ...ctx, now: NOW + 60_000 })).toEqual(UNCHANGED)
  })

  // Review round 2 of #14: going back to the far date already approved, from another waiting
  // date or after a refusal, asked the หัวหน้า to approve it a second time.
  test('going back to a far date already approved applies it without asking again', () => {
    const boss = { id: 'm1', name: 'Boss' }
    const approveFar = () => {
      const o = apply(linked(), { action: 'propose', date: day(9), requestId: 'req-dup30' })
      const r = decide(o, { changeId: o.pendingDeliveryDate!.changeId, decision: 'approve' }, boss, NOW, makeId)
      if (!r.ok) throw new Error()
      return applyPatch(o, r.patch)
    }
    // From another date still waiting: that one is withdrawn, the approved one stands.
    let o = apply(approveFar(), { action: 'propose', date: day(12), requestId: 'req-dup31' })
    let r = respond(o, { action: 'propose', date: day(9), requestId: 'req-dup32' }, ctx)
    expect(r.ok && !r.replayed && r.outcome).toBe('changed')
    o = applyPatch(o, (r as { patch: Parameters<typeof applyPatch>[1] }).patch)
    expect(o).toMatchObject({ supplierConfirmationStatus: 'changed', confirmedDeliveryDate: day(9) })
    expect(o.pendingDeliveryDate).toBeUndefined()
    // After a refusal of another date: answering it with the approved date needs no approval.
    o = apply(approveFar(), { action: 'propose', date: day(12), requestId: 'req-dup33' })
    const no = decide(o, { changeId: o.pendingDeliveryDate!.changeId, decision: 'reject', reason: 'no' }, boss, NOW, makeId)
    if (!no.ok) throw new Error()
    o = applyPatch(o, no.patch)
    r = respond(o, { action: 'propose', date: day(9), requestId: 'req-dup34' }, ctx)
    expect(r.ok && !r.replayed && r.outcome).toBe('changed')
    expect(respond(applyPatch(o, (r as { patch: Parameters<typeof applyPatch>[1] }).patch), { action: 'propose', date: day(9), requestId: 'req-dup35' }, ctx)).toEqual(UNCHANGED)
  })

  test('after an amendment, the far date approved before needs approval again', () => {
    let o = apply(linked(), { action: 'propose', date: day(9), requestId: 'req-dup36' })
    const ok = decide(o, { changeId: o.pendingDeliveryDate!.changeId, decision: 'approve' }, { id: 'm1', name: 'Boss' }, NOW, makeId)
    if (!ok.ok) throw new Error()
    o = applyPatch(o, ok.patch)
    o = { ...o, revision: 1, revisions: [{ rev: 1, at: NOW, by: 'u1', byName: 'Nok', reason: 'more', changes: [{ kind: 'qty', productName: 'BACON', unit: 'แพ็ค', from: 4, to: 6 }] }] }
    const l = issueLink(o, { now: NOW + 1, actor, ttlDays: 30, makeId })
    if (!l.ok || !l.patch) throw new Error()
    o = applyPatch(o, l.patch)
    expect(o.confirmedDeliveryDate).toBe(day(9)) // kept by the reset, but no longer agreed
    const r = respond(o, { action: 'propose', date: day(9), requestId: 'req-dup37' }, ctx)
    expect(r.ok && !r.replayed && r.outcome).toBe('pending')
    // Nor once another far date waits on the new link.
    o = apply(o, { action: 'propose', date: day(12), requestId: 'req-dup38' })
    const again = respond(o, { action: 'propose', date: day(9), requestId: 'req-dup39' }, ctx)
    expect(again.ok && !again.replayed && again.outcome).toBe('pending')
  })

  test('a date waiting for approval that the range now allows applies at once', () => {
    const o = apply(linked(), { action: 'propose', date: day(9), requestId: 'req-dup28' })
    expect(o.supplierConfirmationStatus).toBe('pending_date_approval')
    const r = respond(o, { action: 'propose', date: day(9), requestId: 'req-dup29' }, { ...ctx, maxPostponeDays: 7 })
    expect(r.ok && !r.replayed && r.outcome).toBe('changed')
  })
})
