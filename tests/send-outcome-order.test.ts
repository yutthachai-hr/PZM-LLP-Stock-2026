import { describe, expect, test } from 'vitest'
import { createOutcomeTracker, mergeWizardOrders } from '../src/pages/purchase/outcomeOrder'
import { lineStateOf } from '../src/pages/orders/lineStatus'
import type { PurchaseOrder } from '../src/types'
import type { SharePatch } from '../src/services/purchaseOrders'

// The wizard's `current` is the order as the list handed it over. On a first send the
// server issues the supplier link and replies with the order in its new state — supplier
// asked, waiting, date requested. The "sent" outcome is recorded on `current` afterwards,
// and that write is what the device's copy, the list row and the batch take as the truth.
const listed = {
  id: 'po-1',
  docNo: 'PO-1',
  status: 'ordered',
  expectedAt: 1_800_000_000_000,
  updatedAt: 100,
} as unknown as PurchaseOrder

const opened = { shareStatus: 'shareOpened', updatedAt: 200, shareOpenedAt: 200 } as const

const linked = {
  ...listed,
  ...opened,
  supplierConfirmationStatus: 'waiting',
  requestedDeliveryDate: 1_800_000_000_000,
  supplierLink: { version: 1, issuedAt: 210 },
  supplierActivity: [{ id: 'a1', at: 210, kind: 'linkIssued', byName: 'Somchai' }],
  updatedAt: 210,
} as unknown as PurchaseOrder

const sent = { shareStatus: 'sent', updatedAt: 300, sentAt: 300, sentBy: 'u1', sentByName: 'Somchai', imageVersion: 1 } as const

describe('send wizard: the order after an outcome', () => {
  test('a first send keeps the supplier state the link created', () => {
    const tracker = createOutcomeTracker()
    tracker.afterWrite(listed, opened)
    tracker.observe(linked)
    const after = tracker.afterWrite(listed, sent)
    expect(after.supplierConfirmationStatus).toBe('waiting')
    expect(after.requestedDeliveryDate).toBe(1_800_000_000_000)
    expect(after.supplierLink).toEqual({ version: 1, issuedAt: 210 })
    expect(after).toMatchObject(sent)
  })

  test('a link that did not move updatedAt still wins over the copy it was read after', () => {
    const tracker = createOutcomeTracker()
    tracker.afterWrite(listed, opened)
    tracker.observe({ ...linked, updatedAt: 200 })
    expect(tracker.afterWrite(listed, sent).supplierConfirmationStatus).toBe('waiting')
  })

  test('a newer copy from the list (supplier already answered) is not rolled back', () => {
    const tracker = createOutcomeTracker()
    tracker.afterWrite(listed, opened)
    tracker.observe(linked)
    const answered = {
      ...linked,
      supplierConfirmationStatus: 'confirmed',
      confirmedDeliveryDate: 1_800_086_400_000,
      expectedAt: 1_800_086_400_000,
      supplierActivity: [...(linked.supplierActivity ?? []), { id: 'a2', at: 240, kind: 'accepted', byName: 'Supplier' }],
      updatedAt: 240,
    } as unknown as PurchaseOrder
    const after = tracker.afterWrite(answered, sent)
    expect(after.supplierConfirmationStatus).toBe('confirmed')
    expect(after.confirmedDeliveryDate).toBe(1_800_086_400_000)
    expect(after.expectedAt).toBe(1_800_086_400_000)
    expect(after.shareStatus).toBe('sent')
  })

  // The share write is stamped by this device, the link by the server. A device clock that
  // runs ahead must not make the link reply look older than the "opened" write before it.
  test('a device clock ahead of the server does not lose the link reply', () => {
    const tracker = createOutcomeTracker()
    tracker.afterWrite(listed, { ...opened, updatedAt: 90_000, shareOpenedAt: 90_000 })
    tracker.observe({ ...linked, updatedAt: 9_500 } as PurchaseOrder)
    const after = tracker.afterWrite(listed, { ...sent, updatedAt: 90_500, sentAt: 90_500 })
    expect(after.supplierConfirmationStatus).toBe('waiting')
    expect(after.supplierLink).toEqual({ version: 1, issuedAt: 210 })
    expect(after.shareStatus).toBe('sent')
  })

  // "Was it sent?" is answered from the screen, whose copy is the list's merge of the
  // "opened" write: a newer object than the link reply, but without the link in it.
  test('the list copy merged after "opened" does not hide the link reply', () => {
    const tracker = createOutcomeTracker()
    const afterOpen = tracker.afterWrite(listed, opened)
    tracker.observe(linked)
    const onScreen = { ...listed, ...afterOpen, updatedAt: 999_999 } as PurchaseOrder
    const after = tracker.afterWrite(onScreen, sent)
    expect(after.supplierConfirmationStatus).toBe('waiting')
    expect(after.requestedDeliveryDate).toBe(1_800_000_000_000)
  })

  test('what was written always lands, and orders do not leak into each other', () => {
    const tracker = createOutcomeTracker()
    tracker.observe({ ...linked, id: 'po-2', supplierConfirmationStatus: 'proposed' } as unknown as PurchaseOrder)
    const after = tracker.afterWrite(listed, sent)
    expect(after.supplierConfirmationStatus).toBeUndefined()
    expect(after).toMatchObject(sent)
  })

  test('a failed outcome after a link keeps the link state and records the failure', () => {
    const tracker = createOutcomeTracker()
    tracker.afterWrite(listed, opened)
    tracker.observe(linked)
    const after = tracker.afterWrite(listed, { shareStatus: 'failed', updatedAt: 320 })
    expect(after.shareStatus).toBe('failed')
    expect(after.supplierConfirmationStatus).toBe('waiting')
    expect(after.sentAt).toBeUndefined()
  })

  test('regression (PR30-D1): summary badge state becomes "sent" after recording sent outcome on a resend-needed order', () => {
    // PO-LN-008 Rev.1 situation: previously sent at 100, revised at 200 -> needs resend
    const revisedOrder = {
      id: 'po-ln-008',
      docNo: 'PO-LN-008',
      status: 'ordered',
      supplierName: 'Le Lapin Bakery',
      shareStatus: 'sent',
      sentAt: 100,
      revisions: [{ rev: 1, at: 200, byName: 'Somchai', reason: 'Quantity change' }],
      lines: [],
      updatedAt: 200,
    } as unknown as PurchaseOrder

    // Pre-send state shows 'resend' ("LINE · ต้องส่งใหม่")
    expect(lineStateOf(revisedOrder)).toBe('resend')

    // Outcome recorded: sent outcome written at time 300
    const patch: SharePatch = {
      shareStatus: 'sent',
      sentAt: 300,
      sentBy: 'user-1',
      sentByName: 'Somchai',
      updatedAt: 300,
      imageVersion: 2,
    }

    const patchedOrders = { [revisedOrder.id]: patch }
    const merged = mergeWizardOrders([revisedOrder], patchedOrders)

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(revisedOrder.id)
    // The summary row badge state MUST be 'sent', not the stale 'resend'
    expect(lineStateOf(merged[0])).toBe('sent')
  })
})
