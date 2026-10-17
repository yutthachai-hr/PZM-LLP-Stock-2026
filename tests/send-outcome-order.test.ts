import { describe, expect, test } from 'vitest'
import { createOutcomeTracker } from '../src/pages/purchase/outcomeOrder'
import type { PurchaseOrder } from '../src/types'

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
      updatedAt: 250,
    } as unknown as PurchaseOrder
    const after = tracker.afterWrite(answered, sent)
    expect(after.supplierConfirmationStatus).toBe('confirmed')
    expect(after.confirmedDeliveryDate).toBe(1_800_086_400_000)
    expect(after.expectedAt).toBe(1_800_086_400_000)
    expect(after.shareStatus).toBe('sent')
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
})
