// Notifications as the app writes them, on the memory backend: reading marks only your own
// key, an instant announcement is written once, and the in-app stand-in for the Worker
// writes nothing the second time.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AppNotification } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const { deliver, markRead, savePrefs } = await import('../src/services/notifications')
const { runNotificationJobs } = await import('../src/services/automation')
const { invalidateScheduleCache } = await import('../src/services/schedules')
const { invalidateSupplierCache } = await import('../src/services/suppliers')
const { clearEventCache } = await import('../src/data/eventCache')
const { orderCache } = await import('../src/data/orderCache')
const { requestCache } = await import('../src/data/requestCache')
const { toDoc } = await import('../src/lib/inventoryRules/notifications')
const { setActiveBrand } = await import('../src/brand/brand')

const NOW = Date.UTC(2026, 8, 18, 3, 0) // Friday 10:00 Bangkok
const MANAGER = { id: 'uid-m', name: 'Manager' }

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
  invalidateScheduleCache()
  invalidateSupplierCache()
  clearEventCache()
  orderCache.clear()
  requestCache.clear()
})

const rows = () => raw('notifications') as unknown as AppNotification[]

describe('reading', () => {
  test('marks the reader and leaves everyone else as they were', async () => {
    const n = { ...toDoc({ id: 'poArriving__o1__20260918', kind: 'poArriving', priority: 'info', to: { all: true }, params: {}, link: '/orders' }, 1, 'worker', 'w'), readBy: { other: 5 } }
    seed('notifications', [n as unknown as Record<string, unknown>])
    await markRead(n, 'me', 99)
    expect(rows()[0].readBy).toEqual({ other: 5, me: 99 })
  })
})

describe('instant announcements', () => {
  test('written once, however often the action repeats', async () => {
    const draft = { id: 'prSubmitted__r1__1', kind: 'prSubmitted' as const, priority: 'medium' as const, to: { roles: ['manager' as const] }, params: {}, link: '/requests/r1' }
    await deliver(draft, { id: 'uid-s' })
    seed('notifications', [{ ...(raw('notifications')[0] as object), readBy: { m: 1 } } as Record<string, unknown>])
    await deliver(draft, { id: 'uid-s' })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ source: 'client', createdBy: 'uid-s', readBy: { m: 1 } })
  })

  test('mutes are saved without critical, which cannot be muted', async () => {
    await savePrefs('uid-m', { inventory: ['critical', 'info'] })
    expect(raw('inventorySchedules')[0]).toMatchObject({ id: 'prefs__uid-m', kind: 'prefs', userId: 'uid-m', mute: { inventory: ['info'] } })
  })
})

describe('the app standing in for the Worker', () => {
  const data = (qty: number) => ({
    products: [{ id: 'p1', sku: 'S1', name: 'Cheese', category: 'c', unit: 'kg', unitType: 'KG', minStock: 5, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }],
    locations: [{ id: 'main', name: 'คลังหลัก', type: 'warehouse' as const, active: true, createdAt: 1 }],
    levels: [{ id: 'main__p1', locationId: 'main', productId: 'p1', qty, updatedAt: 1 }],
    minOverrides: [],
    movements: [],
    notifications: [] as AppNotification[],
  })

  test('announces low stock and the brief, then nothing new on the second run', async () => {
    const first = await runNotificationJobs(MANAGER, data(2), NOW)
    expect(first).toBeGreaterThan(0)
    expect(rows().map((n) => n.kind)).toEqual(expect.arrayContaining(['lowStock', 'reorder', 'dailyBrief']))
    // The second run is handed what the listener would now hold.
    expect(await runNotificationJobs(MANAGER, { ...data(2), notifications: rows() }, NOW + 60_000)).toBe(0)
  })

  test('a recovered shortage is resolved', async () => {
    await runNotificationJobs(MANAGER, data(2), NOW)
    await runNotificationJobs(MANAGER, { ...data(50), notifications: rows() }, NOW + 60_000)
    expect(rows().find((n) => n.kind === 'lowStock')).toMatchObject({ active: false })
  })
})
