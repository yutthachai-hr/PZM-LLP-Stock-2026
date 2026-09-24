// The read-only activity log, and the day-end stock figure it shares a ledger with.
//
//   npm test
//
// Nothing is stored for either: the log is read back out of the histories each record
// already carries, and "stock as at a day" is today's figure with everything since taken off.

import { describe, expect, test } from 'vitest'
import { buildActivityLog } from '../src/lib/activityLog'
import { movedSince } from '../src/lib/ledger'
import type { PurchaseOrder, PurchaseRequest, StockEvent, StockMovement } from '../src/types'

const DAY = 86_400_000
const D0 = new Date(2026, 8, 10).getTime()
const t = (k: string, p?: Record<string, string | number>) => (p ? `${k} ${JSON.stringify(p)}` : k)

const mv = (over: Partial<StockMovement>): StockMovement => ({
  id: 'm1', docNo: 'RC-00001', type: 'receive', productId: 'p1', productName: 'Prawn', unit: 'KG', qty: 10,
  toLocationId: 'main', date: D0, byUserId: 'u1', byUserName: 'Nuiy', createdAt: D0 + 3600_000, ...over,
})

describe('stock as at the end of a day', () => {
  test('takes off what moved after that day, per site and unit, and skips voided rows', () => {
    const rows: StockMovement[] = [
      mv({ id: 'a', date: D0, qty: 10 }), // on the shelf by the end of D0
      mv({ id: 'b', date: D0 + DAY, qty: 5 }), // came in the day after
      mv({ id: 'c', date: D0 + 2 * DAY, type: 'issue', qty: 3, fromLocationId: 'main', toLocationId: 'br' }),
      mv({ id: 'd', date: D0 + 2 * DAY, qty: 7, entryUnit: 'Pack' }),
      mv({ id: 'e', date: D0 + 3 * DAY, qty: 99, voided: true }),
    ]
    const moved = movedSince(rows, D0, () => 'KG')
    expect(moved.get('main__p1__')).toBe(2) // +5 −3
    expect(moved.get('br__p1__')).toBe(3)
    expect(moved.get('main__p1__Pack')).toBe(7)
    expect(moved.has('main__p1__') && moved.get('main__p1__')).not.toBe(101)
    // today's main KG figure is 12 → as at D0 it was 10
    expect(12 - (moved.get('main__p1__') ?? 0)).toBe(10)
  })
})

describe('the activity log', () => {
  const input = {
    from: D0 - DAY,
    to: D0 + 10 * DAY,
    locationName: (id?: string) => (id === 'main' ? 'Main' : id === 'br' ? 'Branch' : ''),
    formatDate: (ms: number) => new Date(ms).toISOString().slice(0, 10),
    formatDateTime: (ms: number) => String(ms),
    fmtQty: (n: number) => String(n),
    movementType: (x: string) => x,
    editChange: (c: { field: string; from: string; to: string }) => `${c.field}:${c.from}>${c.to}`,
    requestAction: (a: string) => `pr.${a}`,
    taskAction: (a: string) => `task.${a}`,
    t,
  }

  test('a movement yields its filing, each edit with old and new values, and its void', () => {
    const m = mv({
      edits: [
        { by: 'u2', byName: 'Boss', at: D0 + 2 * 3600_000, changed: ['จำนวน'], changes: [{ field: 'qty', from: '10', to: '12' }] },
        { by: 'u2', byName: 'Boss', at: D0 + 3 * 3600_000, changed: ['วันที่'] },
      ],
      voided: true,
      updatedAt: D0 + 4 * 3600_000,
      updatedByName: 'Admin',
    })
    const log = buildActivityLog({ ...input, movements: [m], orders: [], requests: [], events: [] })
    expect(log.map((e) => e.action)).toEqual(['ยกเลิกรายการ (คืนสต๊อก)', 'แก้ไขรายการ', 'แก้ไขรายการ', 'บันทึกรายการ'])
    expect(log[2].detail).toBe('qty:10>12')
    expect(log[1].detail).toBe('วันที่')
    expect(log[0].by).toBe('Admin')
    expect(log[3].subject).toContain('Prawn · 10 KG · Main')
  })

  test('an order yields placing, revisions, receipt and cancellation, each signed', () => {
    const o: PurchaseOrder = {
      id: 'o1', docNo: 'PO-00001', supplierId: 's', supplierName: 'OLIVA', status: 'cancelled', locationId: 'main', orderedAt: D0,
      lines: [{ productId: 'p1', productName: 'Prawn', unit: 'KG', orderedQty: 12 }],
      revision: 1,
      revisions: [{ rev: 1, at: D0 + DAY, by: 'u1', byName: 'Nuiy', reason: 'short', changes: [{ kind: 'qty', productName: 'Prawn', unit: 'KG', from: 10, to: 12 }] }],
      cancelReason: 'gone', cancelledBy: 'u2', cancelledByName: 'Boss', cancelledAt: D0 + 2 * DAY,
      createdBy: 'u1', createdByName: 'Nuiy', createdAt: D0, updatedAt: D0,
    }
    const log = buildActivityLog({ ...input, movements: [], orders: [o], requests: [], events: [] })
    expect(log.map((e) => e.action)).toEqual(['ยกเลิกใบสั่งซื้อ', 'แก้ไขใบสั่งซื้อ (Rev.{n}) {"n":1}', 'สั่งซื้อ'])
    expect(log[1].detail).toBe('short — Prawn: 10 → 12 KG')
    expect(log[0].by).toBe('Boss')
    expect(log.every((e) => e.docNo === 'PO-00001')).toBe(true)
  })

  test('an order delivered in two goes yields each delivery, then the rest closed short', () => {
    const o: PurchaseOrder = {
      id: 'o2', docNo: 'PO-00002', supplierId: 's', supplierName: 'OLIVA', status: 'received', locationId: 'main', orderedAt: D0,
      lines: [
        { productId: 'p1', productName: 'Prawn', unit: 'KG', orderedQty: 12, receivedQty: 10 },
        { productId: 'p2', productName: 'Squid', unit: 'KG', orderedQty: 4, receivedQty: 4 },
      ],
      receipts: [
        { docNo: 'RC-00010', date: D0 + DAY, invoiceNo: 'IV-1', byId: 'u1', byName: 'Nuiy', lines: [{ productId: 'p1', qty: 6, note: 'rest tomorrow' }, { productId: 'p2', qty: 4 }] },
        { docNo: 'RC-00011', date: D0 + 2 * DAY, invoiceNo: 'IV-2', byId: 'u2', byName: 'Boss', lines: [{ productId: 'p1', qty: 4, note: 'last of it' }] },
      ],
      invoiceNo: 'IV-2', movementDocNo: 'RC-00011', receivedAt: D0 + 2 * DAY, receivedBy: 'u2', receivedByName: 'Boss',
      closedShortReason: 'supplier out', closedShortBy: 'u2', closedShortByName: 'Boss', closedShortAt: D0 + 3 * DAY,
      createdBy: 'u1', createdByName: 'Nuiy', createdAt: D0, updatedAt: D0,
    }
    const log = buildActivityLog({ ...input, movements: [], orders: [o], requests: [], events: [] })
    expect(log.map((e) => e.action)).toEqual([
      'ปิดยอดค้าง',
      'รับของเข้าคลัง (รอบที่ {n}) {"n":2}',
      'รับของเข้าคลัง (รอบที่ {n}) {"n":1}',
      'สั่งซื้อ',
    ])
    expect(log[0]).toMatchObject({ detail: 'supplier out', by: 'Boss' })
    expect(log[2].detail).toBe('บิล {no} {"no":"IV-1"} · RC-00010 · {n} รายการ {"n":2} · Prawn: 6 (rest tomorrow)')
    expect(log[2].by).toBe('Nuiy')
  })

  test('requests and tasks contribute every history entry; the window is respected', () => {
    const r = {
      id: 'r1', docNo: 'PR-00001', locationId: 'br', requestedByName: 'Nuiy', items: [{ idx: 0, productName: 'Prawn' }],
      history: [
        { at: D0, by: 'u1', byName: 'Nuiy', action: 'created' },
        { at: D0 + DAY, by: 'u2', byName: 'Boss', action: 'managerQtyChanged', itemIdx: 0, oldValue: '5', newValue: '4' },
        { at: D0 + 30 * DAY, by: 'u2', byName: 'Boss', action: 'approved' }, // outside the window
      ],
    } as unknown as PurchaseRequest
    const e = { id: 'sc__x__20260910', title: 'Count', locationId: 'main', history: [{ at: D0, by: 'u1', byName: 'Nuiy', action: 'generated' }] } as unknown as StockEvent
    const log = buildActivityLog({ ...input, movements: [], orders: [], requests: [r], events: [e] })
    expect(log.map((e) => e.action)).toEqual(['pr.managerQtyChanged', 'pr.created', 'task.generated'])
    expect(log[0].detail).toBe('Prawn · 5 → 4')
    expect(log[2].docNo).toBe('ตามตาราง')
  })
})
