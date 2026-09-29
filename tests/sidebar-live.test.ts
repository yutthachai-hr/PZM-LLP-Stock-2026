// The panels at the foot of the sidebar: built from what is already in memory
// (owner, 27 Sep 2026).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { dueToday, recentActivity, sinceLabel } from '../src/lib/sidebarLive'
import type { PurchaseOrder, StockMovement } from '../src/types'

const NOW = Date.UTC(2026, 8, 27, 7, 0) // 14:00 Bangkok
const MIN = 60_000

const mv = (p: Partial<StockMovement>): StockMovement =>
  ({
    id: Math.random().toString(36),
    docNo: 'RC-00001',
    type: 'receive',
    productId: 'p1',
    productName: 'Mozzarella',
    unit: 'KG',
    qty: 1,
    date: NOW,
    byUserId: 'u1',
    byUserName: 'Somchai',
    createdAt: NOW - 5 * MIN,
    ...p,
  }) as StockMovement

const po = (p: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: 'o1',
    docNo: 'PO-00012',
    supplierId: 's1',
    supplierName: 'OLIVA',
    status: 'ordered',
    lines: [{}, {}],
    orderedAt: NOW - 2 * MIN,
    createdBy: 'u2',
    createdByName: 'Yutthachai',
    createdAt: NOW - 2 * MIN,
    updatedAt: NOW - 2 * MIN,
    ...p,
  }) as unknown as PurchaseOrder

describe('recentActivity', () => {
  test('one entry per document, newest first, orders among them', () => {
    const items = recentActivity(
      [mv({}), mv({ id: 'b', productName: 'Flour' }), mv({ docNo: 'IS-00003', type: 'issue', fromLocationId: 'w', createdAt: NOW - 30 * MIN })],
      [po({})],
      NOW,
    )
    expect(items.map((i) => [i.kind, i.docNo, i.lines, i.who])).toEqual([
      ['order', 'PO-00012', 2, 'Yutthachai'],
      ['receive', 'RC-00001', 2, 'Somchai'],
      ['issue', 'IS-00003', 1, 'Somchai'],
    ])
    expect(items[0].link).toBe('/orders?po=o1')
    expect(items[1].link).toBe('/movements?doc=RC-00001')
  })

  test('a move between two sites is a transfer', () => {
    const [i] = recentActivity([mv({ type: 'issue', fromLocationId: 'w', toLocationId: 'b1' })], [], NOW)
    expect(i.kind).toBe('transfer')
  })

  test('voided rows, drafts, cancelled orders and old news are left out', () => {
    const items = recentActivity(
      [mv({ voided: true }), mv({ docNo: 'OLD', createdAt: NOW - 4 * 86_400_000 })],
      [po({ status: 'draft' }), po({ id: 'c', status: 'cancelled' })],
      NOW,
    )
    expect(items).toEqual([])
  })

  test('a document filed since the last minute tick still shows, as just now', () => {
    const [i] = recentActivity([mv({ createdAt: NOW + 20_000 })], [], NOW)
    expect(i.docNo).toBe('RC-00001')
    expect(sinceLabel(i.at, NOW)).toEqual({ key: 'เมื่อสักครู่' })
  })

  test('at most the limit', () => {
    const many = Array.from({ length: 9 }, (_, n) => mv({ docNo: `RC-${n}`, createdAt: NOW - n * MIN }))
    expect(recentActivity(many, [], NOW, 4)).toHaveLength(4)
  })
})

describe('dueToday', () => {
  test('open orders expected today only', () => {
    const today = NOW
    const tomorrow = NOW + 86_400_000
    expect(
      dueToday([po({ expectedAt: today }), po({ id: 'r', status: 'received', expectedAt: today }), po({ id: 't', expectedAt: tomorrow })], NOW),
    ).toBe(1)
  })
})

describe('sinceLabel', () => {
  test('minutes, hours, days', () => {
    expect(sinceLabel(NOW - 20_000, NOW)).toEqual({ key: 'เมื่อสักครู่' })
    expect(sinceLabel(NOW - 5 * MIN, NOW)).toEqual({ key: '{n} นาที', n: 5 })
    expect(sinceLabel(NOW - 125 * MIN, NOW)).toEqual({ key: '{n} ชม.', n: 2 })
    expect(sinceLabel(NOW - 50 * 60 * MIN, NOW)).toEqual({ key: '{n} วัน', n: 2 })
  })
})
