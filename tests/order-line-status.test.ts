import { describe, expect, it } from 'vitest'
import type { PurchaseOrder } from '../src/types'
import { lineStateOf, LINE_LABEL, type LineState } from '../src/pages/orders/lineStatus'
import { matchesStateFilter, stateFilterCounts, presentOrderStatus } from '../src/pages/orders/presentation'

const order: PurchaseOrder = {
  id: 'one', docNo: 'PO-00001', supplierId: 'supplier', supplierName: 'Supplier',
  locationId: 'wh', status: 'ordered', orderedAt: 100,
  lines: [{ productId: 'flour', productName: 'Flour', unit: 'KG', orderedQty: 10 }],
  createdAt: 100, updatedAt: 100, createdBy: 'staff', createdByName: 'Staff',
}
const revision = { rev: 1, at: 200, by: 'staff', byName: 'Staff', reason: 'Qty', changes: [] }

describe('the LINE state comes only from the persisted share fields', () => {
  it.each<[string, Partial<PurchaseOrder>, LineState]>([
    ['never shared', {}, 'unsent'],
    ['share picker opened, nothing confirmed', { shareStatus: 'shareOpened', shareOpenedAt: 150 }, 'awaitingConfirm'],
    ['LINE reported the send', { shareStatus: 'sent', sentAt: 150 }, 'sent'],
    ['the last attempt failed', { shareStatus: 'failed' }, 'failed'],
    ['deliberately skipped', { shareStatus: 'skipped' }, 'skipped'],
    ['amended after it was sent', { shareStatus: 'sent', sentAt: 150, revisions: [revision] }, 'resend'],
    ['sent again after the amendment', { shareStatus: 'sent', sentAt: 250, revisions: [revision] }, 'sent'],
  ])('%s', (_name, fields, state) => {
    expect(lineStateOf({ ...order, ...fields })).toBe(state)
  })

  it('a supplier answer never changes the LINE state, and LINE never implies an answer', () => {
    expect(lineStateOf({ ...order, supplierConfirmationStatus: 'confirmed' })).toBe('unsent')
    const sent = presentOrderStatus({ ...order, shareStatus: 'sent', sentAt: 150 }, false)
    expect(sent.primary.label).toBe('สั่งแล้ว')
    expect(sent.secondary).not.toContain('ผู้ขายยืนยันแล้ว')
  })

  it.each(['draft', 'received', 'cancelled'] as const)('is not shown on a %s order', (status) => {
    expect(lineStateOf({ ...order, status, shareStatus: 'sent', sentAt: 150 })).toBeNull()
  })

  it('names each state with LINE in the label, and the amended one as a resend', () => {
    expect(LINE_LABEL).toEqual({
      sent: 'LINE · ส่งแล้ว',
      unsent: 'LINE · ยังไม่ส่ง',
      awaitingConfirm: 'LINE · รอยืนยันส่ง',
      failed: 'LINE · ส่งไม่สำเร็จ',
      skipped: 'ข้ามการส่ง LINE',
      resend: 'LINE · ต้องส่งใหม่',
    })
  })

  it('the LINE resend is no longer folded into the operational status', () => {
    const p = presentOrderStatus({ ...order, shareStatus: 'sent', sentAt: 150, revisions: [revision] }, false)
    expect(p.primary.label).toBe('สั่งแล้ว')
    expect(p.nextAction).toBe('resend')
    expect(p.urgency).toBe('urgent')
  })
})

describe('state filters and their counts', () => {
  const rows: PurchaseOrder[] = [
    { ...order, id: 'unsent' },
    { ...order, id: 'opened', shareStatus: 'shareOpened' },
    { ...order, id: 'failed', shareStatus: 'failed' },
    { ...order, id: 'skipped', shareStatus: 'skipped' },
    { ...order, id: 'sent', shareStatus: 'sent', sentAt: 150, supplierConfirmationStatus: 'waiting' },
    { ...order, id: 'resend', shareStatus: 'sent', sentAt: 150, revisions: [revision] },
    { ...order, id: 'late', shareStatus: 'sent', sentAt: 150, supplierConfirmationStatus: 'confirmed' },
    { ...order, id: 'draft', status: 'draft' },
  ]
  const late = new Set(['late'])
  const ids = (f: Parameters<typeof matchesStateFilter>[1]) => rows.filter((o) => matchesStateFilter(o, f, late.has(o.id))).map((o) => o.id)

  it('"not sent to LINE" is every placed order whose current sheet has not gone out, except a resend', () => {
    expect(ids('unsent')).toEqual(['unsent', 'opened', 'failed', 'skipped'])
  })
  it('"needs resend", "sent", "waiting for supplier" and "overdue" are each their own set', () => {
    expect(ids('resend')).toEqual(['resend'])
    expect(ids('sent')).toEqual(['sent', 'late'])
    expect(ids('supplierWaiting')).toEqual(['sent'])
    expect(ids('late')).toEqual(['late'])
    expect(ids('')).toHaveLength(rows.length)
  })
  it('counts are the same predicates over the rows given — nothing all-time', () => {
    expect(stateFilterCounts(rows, (o) => late.has(o.id))).toEqual({ unsent: 4, supplierWaiting: 1, resend: 1, late: 1 })
    expect(stateFilterCounts([], () => false)).toEqual({ unsent: 0, supplierWaiting: 0, resend: 0, late: 0 })
  })
})
