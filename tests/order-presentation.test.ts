import { describe, expect, it } from 'vitest'
import type { PurchaseOrder, SupplierConfirmationStatus } from '../src/types'
import { presentOrderStatus } from '../src/pages/orders/presentation'

const order: PurchaseOrder = {
  id: 'one', docNo: 'PO-00001', supplierId: 'supplier', supplierName: 'Supplier',
  locationId: 'wh', status: 'ordered', orderedAt: 100,
  lines: [{ productId: 'flour', productName: 'Flour', unit: 'KG', orderedQty: 10 }],
  createdAt: 100, updatedAt: 100, createdBy: 'staff', createdByName: 'Staff',
}
const partial: PurchaseOrder = { ...order, receipts: [{ docNo: 'RC-1', date: 120, byId: 'staff', byName: 'Staff', invoiceNo: 'INV', lines: [{ productId: 'flour', qty: 4 }] }] }
const revised: PurchaseOrder = { ...order, shareStatus: 'sent', sentAt: 100, revisions: [{ rev: 1, at: 200, by: 'staff', byName: 'Staff', reason: 'Delivery', changes: [] }] }

describe('order presentation, not business eligibility', () => {
  it.each<[SupplierConfirmationStatus, string]>([
    ['waiting', 'รอผู้ขายยืนยัน'], ['confirmed', 'ผู้ขายยืนยันแล้ว'],
    ['changed', 'ผู้ขายเปลี่ยนวันส่ง'], ['pending_date_approval', 'รออนุมัติวันส่ง'],
  ])('shows the real supplier state %s', (supplierConfirmationStatus, label) => {
    expect(presentOrderStatus({ ...order, supplierConfirmationStatus }, false).primary.label).toBe(label)
  })
  it('does not invent supplier confirmation from a successful LINE send', () => {
    const result = presentOrderStatus({ ...order, shareStatus: 'sent' }, false)
    expect(result.primary.label).toBe('สั่งแล้ว')
    // LINE is its own badge now (lineStatus.ts), not a line of status text.
    expect(result.secondary).not.toContain('ส่งเข้า LINE แล้ว')
    expect(result.secondary).not.toContain('ผู้ขายยืนยันแล้ว')
  })
  it('keeps supplier confirmation visible when overdue takes priority', () => {
    const result = presentOrderStatus({ ...order, supplierConfirmationStatus: 'confirmed', shareStatus: 'sent' }, true)
    expect(result.primary.label).toBe('เกินกำหนดรับของ')
    expect(result.urgency).toBe('urgent')
    expect(result.secondary).toContain('ผู้ขายยืนยันแล้ว')
    expect(result.nextAction).toBe('receive')
  })
  it('keeps partial receipt and supplier state visible together', () => {
    const result = presentOrderStatus({ ...partial, supplierConfirmationStatus: 'waiting' }, false)
    expect(result.primary.label).toBe('รับบางส่วน')
    expect(result.secondary).toContain('รอผู้ขายยืนยัน')
    expect(result.nextAction).toBe('receiveRemaining')
  })
  it('recommends resend without hiding pending date approval or partial receipt', () => {
    const result = presentOrderStatus({ ...partial, ...revised, receipts: partial.receipts, supplierConfirmationStatus: 'pending_date_approval' }, true)
    // The resend shows on the LINE badge; the operational badge keeps the date decision.
    expect(result.primary.label).toBe('รออนุมัติวันส่ง')
    expect(result.secondary).toEqual(expect.arrayContaining(['เกินกำหนดรับของ', 'รับบางส่วน']))
    expect(result.urgency).toBe('urgent')
    expect(result.nextAction).toBe('resend')
  })
  it('recommends review of a pending date, not an automatic approval', () => {
    expect(presentOrderStatus({ ...order, supplierConfirmationStatus: 'pending_date_approval' }, false).nextAction).toBe('reviewDate')
  })
  it('distinguishes full receipt from an intentionally closed shortfall', () => {
    expect(presentOrderStatus({ ...order, status: 'received', lines: order.lines.map((line) => ({ ...line, receivedQty: line.orderedQty })) }, true).primary.label).toBe('รับครบแล้ว')
    const result = presentOrderStatus({ ...partial, status: 'received', closedShortAt: 200 }, true)
    expect(result.primary.label).toBe('ปิดยอดค้าง — รับไม่ครบ')
    expect(result.nextAction).toBeNull()
    expect(result.secondary).toEqual([])
  })
  it.each(['draft', 'cancelled'] as const)('does not suggest receiving a %s order', (status) => {
    const result = presentOrderStatus({ ...revised, status, supplierConfirmationStatus: 'confirmed' }, true)
    expect(result.primary.label).toBe(status === 'draft' ? 'ร่าง — รออนุมัติ' : 'ยกเลิกแล้ว')
    expect(result.nextAction).toBeNull()
    expect(result.secondary).toEqual([])
  })
  it('recommends sending only for an ordered PO not yet sent', () => {
    expect(presentOrderStatus(order, false).nextAction).toBe('send')
    expect(presentOrderStatus({ ...order, shareStatus: 'sent' }, false).nextAction).toBe('receive')
  })
  it('does not claim full receipt for legacy orders with unknown or short quantities', () => {
    expect(presentOrderStatus({ ...order, status: 'received' }, false).primary.label).toBe('รับของแล้ว')
    expect(presentOrderStatus({ ...order, status: 'received', lines: order.lines.map((line) => ({ ...line, receivedQty: 2 })) }, false).primary.label).toBe('รับของแล้ว')
  })
  it('does not mutate the order', () => {
    const frozen = Object.freeze({ ...order, supplierConfirmationStatus: 'confirmed' as const })
    expect(presentOrderStatus(frozen, false).primary.label).toBe('ผู้ขายยืนยันแล้ว')
    expect(frozen).toEqual({ ...order, supplierConfirmationStatus: 'confirmed' })
  })
})

describe('R29: an order that needs resending says so on its row, not only on the LINE badge', () => {
  it('lists "ต้องส่ง PO ใหม่" whenever the sheet the supplier holds is out of date', () => {
    const result = presentOrderStatus({ ...partial, ...revised, receipts: partial.receipts, supplierConfirmationStatus: 'pending_date_approval' }, true)
    expect(result.secondary).toContain('ต้องส่ง PO ใหม่')
    expect(presentOrderStatus(order, false).secondary).not.toContain('ต้องส่ง PO ใหม่')
  })
})
