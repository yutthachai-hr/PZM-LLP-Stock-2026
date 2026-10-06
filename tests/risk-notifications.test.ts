// Risk notifications (N5): announced only when a level is crossed upward, once per level,
// deduplicated by id; stock-outs before a delivery; overdue orders escalate to critical.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { evaluate, plan, toDoc, type RiskEngineInput } from '../src/lib/inventoryRules/notifications'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { AppNotification, PurchaseOrder } from '../src/types'

const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 6, 3)), '09:00')
const base = { now: NOW, locationName: () => 'อ่อนนุช', settings: { reminderBeforeMin: 60, escalateAfterHours: 4 } }

const delivery = (level: RiskEngineInput['deliveries'][number]['level'], score: number) => ({
  poId: 'po183',
  docNo: 'PO-000183',
  supplierId: 'pan',
  supplierName: 'PANFOOD',
  locationId: 'onnut',
  level,
  score,
  people: ['staff1'],
})
const run = (risk: RiskEngineInput, existing = new Map<string, AppNotification>()) => {
  const drafts = evaluate({ ...base, jobs: ['risk'], risk })
  return { drafts, plan: plan(drafts, existing, ['risk'], NOW, 'client', 'm1') }
}
const asMap = (docs: AppNotification[]) => new Map(docs.map((d) => [d.id, d]))

describe('delivery risk crosses levels', () => {
  test('LOW: nothing', () => {
    expect(run({ deliveries: [delivery('LOW', 20)], shortages: [] }).drafts).toEqual([])
  })

  test('LOW → MEDIUM: one notification, the current one', () => {
    const { plan: p } = run({ deliveries: [delivery('MEDIUM', 45)], shortages: [] })
    expect(p.create.map((d) => [d.id, d.priority, d.params.current])).toEqual([['deliveryRisk__po183__MEDIUM', 'medium', 1]])
    expect(p.create[0].to).toEqual({ roles: ['manager', 'admin'], uids: ['staff1'] })
    expect(p.create[0].link).toBe('/orders?po=po183')
  })

  test('HIGH 61 → HIGH 66: nothing new is written', () => {
    const first = run({ deliveries: [delivery('HIGH', 61)], shortages: [] }).plan.create
    const again = run({ deliveries: [delivery('HIGH', 66)], shortages: [] }, asMap(first)).plan
    expect(again.create).toEqual([])
    expect(again.rearm).toEqual([])
  })

  test('MEDIUM → HIGH: only the HIGH document is new', () => {
    const medium = run({ deliveries: [delivery('MEDIUM', 40)], shortages: [] }).plan.create
    const high = run({ deliveries: [delivery('HIGH', 72)], shortages: [] }, asMap(medium)).plan
    expect(high.create.map((d) => d.id)).toEqual(['deliveryRisk__po183__HIGH'])
    expect(high.create[0]).toMatchObject({ priority: 'high', params: { score: 72, current: 1 } })
  })

  test('LOW → CRITICAL at once: the lower levels are written as history (current 0)', () => {
    const p = run({ deliveries: [delivery('CRITICAL', 85)], shortages: [] }).plan
    expect(p.create.map((d) => [d.id.split('__')[2], d.params.current])).toEqual([
      ['MEDIUM', 0],
      ['HIGH', 0],
      ['CRITICAL', 1],
    ])
  })

  test('dropping back resolves the higher level; rising again re-arms it (a new crossing)', () => {
    const high = run({ deliveries: [delivery('HIGH', 70)], shortages: [] }).plan.create
    const down = run({ deliveries: [delivery('MEDIUM', 40)], shortages: [] }, asMap(high)).plan
    expect(down.resolve).toEqual(['deliveryRisk__po183__HIGH'])
    expect(down.create).toEqual([])
    const resolved = high.map((d) => (d.id.endsWith('HIGH') ? { ...d, active: false } : d))
    const up = run({ deliveries: [delivery('HIGH', 75)], shortages: [] }, asMap(resolved)).plan
    expect(up.rearm.map((d) => d.id)).toEqual(['deliveryRisk__po183__HIGH'])
  })

  test('an order received or cancelled leaves the risk list: its alerts resolve', () => {
    const high = run({ deliveries: [delivery('HIGH', 70)], shortages: [] }).plan.create
    expect(run({ deliveries: [], shortages: [] }, asMap(high)).plan.resolve.sort()).toEqual(['deliveryRisk__po183__HIGH', 'deliveryRisk__po183__MEDIUM'])
  })
})

describe('stock-out before a delivery', () => {
  const short = (level: 'MEDIUM' | 'HIGH' | 'CRITICAL', productId = 'fries') => ({
    productId,
    productName: 'French Fries 3/8',
    locationId: 'onnut',
    locationName: 'อ่อนนุช',
    level,
    stockoutDate: bkkDayStart(NOW) + DAY_MS,
    gapDays: 1,
    docNo: 'PO-000183',
  })

  test('HIGH and CRITICAL are announced; MEDIUM stays on the dashboard', () => {
    const p = run({ deliveries: [], shortages: [short('CRITICAL'), short('HIGH', 'cheese'), short('MEDIUM', 'ham')] }).plan
    expect(p.create.map((d) => [d.id, d.priority])).toEqual([
      ['stockoutRisk__fries__onnut', 'critical'],
      ['stockoutRisk__cheese__onnut', 'high'],
    ])
    expect(p.create[0]).toMatchObject({ category: 'inventory', to: { roles: ['manager', 'admin'] }, params: { days: 1, docNo: 'PO-000183', date: '7/10/2026' } })
  })

  test('the same stock-out on the next run writes nothing', () => {
    const first = run({ deliveries: [], shortages: [short('CRITICAL')] }).plan.create
    expect(run({ deliveries: [], shortages: [short('CRITICAL')] }, asMap(first)).plan.create).toEqual([])
  })
})

describe('overdue orders escalate', () => {
  const order = (daysLate: number): PurchaseOrder => ({
    id: 'po9',
    docNo: 'PO-9',
    supplierId: 's',
    supplierName: 'S',
    status: 'ordered',
    locationId: 'onnut',
    orderedAt: NOW - 10 * DAY_MS,
    expectedAt: bkkDayStart(NOW) - daysLate * DAY_MS,
    lines: [{ productId: 'p', productName: 'P', unit: 'u', orderedQty: 1 }],
    createdBy: 'u',
    createdByName: 'u',
    createdAt: NOW - 10 * DAY_MS,
    updatedAt: NOW,
  })
  const kinds = (o: PurchaseOrder) => evaluate({ ...base, jobs: ['purchasing'], orders: [o] }).map((d) => [d.id, d.priority])

  test('late: high; three days late: a second, critical alert', () => {
    expect(kinds(order(2))).toEqual([['poDelayed__po9', 'high']])
    expect(kinds(order(4))).toEqual([
      ['poDelayed__po9', 'high'],
      ['poDelayed__po9__3d', 'critical'],
    ])
  })
})

test('documents are written in the existing shape (the rules accept them)', () => {
  const [d] = evaluate({ ...base, jobs: ['risk'], risk: { deliveries: [delivery('MEDIUM', 40)], shortages: [] } })
  const doc = toDoc(d, NOW, 'client', 'm1')
  expect(Object.keys(doc).sort()).toEqual(
    ['active', 'category', 'createdAt', 'createdBy', 'expiresAt', 'id', 'kind', 'link', 'locationId', 'params', 'priority', 'readBy', 'source', 'supplierId', 'to', 'updatedAt'].sort(),
  )
})
