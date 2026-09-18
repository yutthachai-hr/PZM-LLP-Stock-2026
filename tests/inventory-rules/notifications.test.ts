// The notification engine: what is announced, to whom, under which id, and when nothing
// new is written.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { NOTIFICATION_BODY, NOTIFICATION_TITLE } from '../../src/lib/inventoryRules/copy'
import type { Insights } from '../../src/lib/inventoryRules/insights'
import { evaluate, isFor, plan, toDoc, type EngineInput } from '../../src/lib/inventoryRules/notifications'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import type { AppNotification, NotificationKind, Product, PurchaseOrder, StockEvent, StockLocation } from '../../src/types'

// Friday 2026-09-18, 10:00 Bangkok
const NOW = Date.UTC(2026, 8, 18, 3, 0)
const TODAY = bkkDayStart(NOW)
const settings = { reminderBeforeMin: 60, escalateAfterHours: 4 }
const base: EngineInput = { now: NOW, jobs: [], locationName: () => 'คลังหลัก', settings }
const task = (over: Partial<StockEvent> = {}): StockEvent => ({
  id: 't1', title: 'นับสต๊อก', type: 'stockCount', startAt: NOW + 30 * 60_000, status: 'upcoming', priority: 'normal',
  createdBy: 'm', createdAt: 1, updatedAt: 1, ...over,
})
const kinds = (input: Partial<EngineInput>) => evaluate({ ...base, ...input }).map((d) => d.kind)

describe('tasks', () => {
  test('a task starting within the reminder window is announced to its people', () => {
    const [d] = evaluate({ ...base, jobs: ['tasks'], events: [task({ assignedTo: ['u1'] })] })
    expect(d).toMatchObject({ kind: 'taskSoon', to: { uids: ['u1'] }, link: '/calendar?item=task__t1' })
    expect(kinds({ jobs: ['tasks'], events: [task({ startAt: NOW + 3 * 3_600_000 })] })).toEqual([])
  })

  test('overdue goes to the people; long overdue goes to the managers as well', () => {
    const late = task({ startAt: NOW - 6 * 3_600_000, dueAt: NOW - 5 * 3_600_000, assignedToAll: true })
    const out = evaluate({ ...base, jobs: ['tasks'], events: [late] })
    expect(out.map((d) => [d.kind, d.to])).toEqual([
      ['taskOverdue', { all: true }],
      ['taskEscalated', { roles: ['manager', 'admin'] }],
    ])
    expect(kinds({ jobs: ['tasks'], events: [{ ...late, status: 'completed' }] })).toEqual([])
  })

  test('handed in: the managers are told, once per hand-in', () => {
    const [d] = evaluate({ ...base, jobs: ['tasks'], events: [task({ status: 'waitingApproval', completedAt: 123, completedByName: 'S' })] })
    expect(d.id).toBe('taskApproval__t1__123')
  })
})

describe('purchasing and the brief', () => {
  const order = (over: Partial<PurchaseOrder>): PurchaseOrder =>
    ({ id: 'o1', docNo: 'PO-1', supplierId: 's1', supplierName: 'OLIVA', status: 'ordered', locationId: 'main', orderedAt: TODAY - 5 * DAY_MS, lines: [], createdBy: 'u', createdByName: 'U', createdAt: 1, updatedAt: 1, ...over }) as PurchaseOrder
  test('due today is for everyone; late is for the managers and is a state', () => {
    expect(evaluate({ ...base, jobs: ['purchasing'], orders: [order({ expectedAt: TODAY })] })[0]).toMatchObject({ kind: 'poArriving', to: { all: true }, id: 'poArriving__o1__20260918' })
    expect(evaluate({ ...base, jobs: ['purchasing'], orders: [order({ expectedAt: TODAY - 2 * DAY_MS })] })[0]).toMatchObject({ kind: 'poDelayed', id: 'poDelayed__o1' })
  })

  test('a cut-off later today, not one already passed', () => {
    const s = { id: 's1', name: 'OLIVA', orderDays: [5], cutoffTime: '14:00', active: true } as never
    expect(kinds({ jobs: ['purchasing'], suppliers: [s] })).toEqual(['cutoffToday'])
    expect(kinds({ jobs: ['purchasing'], suppliers: [{ ...(s as object), cutoffTime: '08:00' } as never] })).toEqual([])
  })

  test('the daily brief waits for 07:00 Bangkok', () => {
    expect(kinds({ jobs: ['brief'], now: bkkAtTime(TODAY, '06:59') })).toEqual([])
    expect(kinds({ jobs: ['brief'], now: bkkAtTime(TODAY, '07:00') })).toEqual(['dailyBrief'])
  })
})

describe('inventory', () => {
  const product = { id: 'p1', name: 'Cheese', unitType: 'KG' } as Product
  const location = { id: 'main', name: 'คลังหลัก' } as StockLocation
  const insights = (over: Partial<Insights>): Insights => ({ shortages: [], reorders: [], stockouts: [], adjustments: [], ...over })
  test('out of stock is critical; low is medium; both to the managers', () => {
    const out = evaluate({ ...base, jobs: ['inventory'], insights: insights({ shortages: [{ product, location, qty: 0, min: 5, out: true }] }) })
    expect(out[0]).toMatchObject({ id: 'outOfStock__p1__main', priority: 'critical', to: { roles: ['manager', 'admin'] } })
  })

  test('no reorder notification when a request or order already covers it', () => {
    const r = { product, location, onHand: 1, incoming: 0, avgDaily: 1, daysLeft: 1, recommendedQty: 10, basis: 'usage' as const, leadTimeDays: 2 }
    expect(kinds({ jobs: ['inventory'], insights: insights({ reorders: [{ ...r, inProgress: null }] }) })).toEqual(['reorder'])
    expect(kinds({ jobs: ['inventory'], insights: insights({ reorders: [{ ...r, inProgress: { kind: 'pr', id: 'x', docNo: 'PR-1', status: 'pendingApproval', qty: 5 } }] }) })).toEqual([])
  })
})

describe('the write plan', () => {
  const draft = (id: string, kind: NotificationKind) => ({ id, kind, priority: 'medium' as const, to: { all: true }, params: {}, link: '/' })
  const doc = (id: string, kind: NotificationKind, active = true): AppNotification => ({ ...toDoc(draft(id, kind), 1, 'worker', 'worker'), active })

  test('said once: a second run with the same facts writes nothing', () => {
    const drafts = [draft('lowStock__p1__main', 'lowStock'), draft('dailyBrief__20260918', 'dailyBrief')]
    const first = plan(drafts, new Map(), ['inventory', 'brief'], NOW, 'client', 'm')
    expect(first.create).toHaveLength(2)
    const existing = new Map(first.create.map((n) => [n.id, n]))
    expect(plan(drafts, existing, ['inventory', 'brief'], NOW, 'client', 'm')).toEqual({ create: [], rearm: [], resolve: [] })
  })

  test('a state that cleared is resolved; if it comes back it is re-armed, unread again', () => {
    const held = new Map([['lowStock__p1__main', doc('lowStock__p1__main', 'lowStock')]])
    expect(plan([], held, ['inventory'], NOW, 'client', 'm').resolve).toEqual(['lowStock__p1__main'])
    // A job that did not look at stock does not resolve stock.
    expect(plan([], held, ['tasks'], NOW, 'client', 'm').resolve).toEqual([])
    const resolved = new Map([['lowStock__p1__main', { ...doc('lowStock__p1__main', 'lowStock', false), readBy: { u: 1 } }]])
    const again = plan([draft('lowStock__p1__main', 'lowStock')], resolved, ['inventory'], NOW, 'client', 'm')
    expect(again.rearm[0]).toMatchObject({ active: true, readBy: {}, createdAt: NOW })
  })

  test('a date-instanced one is never re-armed', () => {
    const held = new Map([['dailyBrief__20260918', doc('dailyBrief__20260918', 'dailyBrief', false)]])
    expect(plan([draft('dailyBrief__20260918', 'dailyBrief')], held, ['brief'], NOW, 'client', 'm').rearm).toEqual([])
  })
})

describe('who sees what', () => {
  const n = (over: Partial<AppNotification>): AppNotification => ({ ...toDoc({ id: 'x__1', kind: 'lowStock', priority: 'medium', to: { roles: ['manager'] }, params: {}, link: '/' }, 1, 'worker', 'w'), ...over })
  test('by role, by name, or everyone; resolved ones drop out', () => {
    expect(isFor(n({}), { id: 'm', role: 'manager' })).toBe(true)
    expect(isFor(n({}), { id: 's', role: 'staff' })).toBe(false)
    expect(isFor(n({ to: { uids: ['s'] } }), { id: 's', role: 'staff' })).toBe(true)
    expect(isFor(n({ active: false }), { id: 'm', role: 'manager' })).toBe(false)
  })

  test('a muted priority is hidden; critical never is', () => {
    const prefs = { id: 'prefs__m', kind: 'prefs' as const, userId: 'm', mute: { inventory: ['medium' as const, 'critical' as const] }, updatedAt: 1 }
    expect(isFor(n({}), { id: 'm', role: 'manager' }, prefs)).toBe(false)
    expect(isFor(n({ priority: 'critical' }), { id: 'm', role: 'manager' }, prefs)).toBe(true)
  })

  test('every kind has words, and every link is a route the app has', () => {
    const routes = ['/calendar', '/orders', '/requests', '/movements', '/reports']
    for (const k of Object.keys(NOTIFICATION_TITLE) as NotificationKind[]) {
      expect(NOTIFICATION_TITLE[k]).toBeTruthy()
      expect(NOTIFICATION_BODY[k]).toBeTruthy()
    }
    const product = { id: 'p1', name: 'Cheese', unitType: 'KG' } as Product
    const location = { id: 'main', name: 'คลังหลัก' } as StockLocation
    const all = evaluate({
      ...base,
      now: bkkAtTime(TODAY + 3 * DAY_MS, '08:00'), // a Monday
      jobs: ['tasks', 'purchasing', 'inventory', 'brief', 'weekly'],
      events: [task({ startAt: NOW - 9 * 3_600_000, dueAt: NOW - 8 * 3_600_000 }), task({ id: 't2', status: 'waitingApproval' })],
      requests: [{ id: 'r1', docNo: 'PR-1', status: 'pendingApproval', items: [], requestedByName: 'S', createdAt: 1, locationId: 'main' } as never],
      insights: { shortages: [{ product, location, qty: 1, min: 5, out: false }], reorders: [], stockouts: [{ product, location, qty: 1, avgDaily: 1, daysLeft: 1 }], adjustments: [] },
      weekly: { tasksDone: 1, tasksMissed: 0, deliveries: 0, lateDeliveries: 0, adjustments: 0, wasteValue: 0 },
    })
    expect(all.length).toBeGreaterThan(5)
    for (const d of all) expect(routes.some((r) => d.link.startsWith(r))).toBe(true)
  })
})
