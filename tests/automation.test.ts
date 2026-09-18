// The stock-count generator as the browser runs it (demo mode, and the cloud fallback when
// the Worker is late): same pure rules, real service code, the memory backend underneath.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InventorySchedule, StockEvent } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const { generateStockCountTasks, shouldRunOnOpen } = await import('../src/services/automation')
const { invalidateScheduleCache } = await import('../src/services/schedules')
const { rescheduleEvent } = await import('../src/services/events')
const { taskIdFor } = await import('../src/lib/inventoryRules/schedules')
const { bkkDayStart, DAY_MS } = await import('../src/lib/inventoryRules/time')
const { setActiveBrand } = await import('../src/brand/brand')

// Thursday 2026-09-17, 10:00 Bangkok
const NOW = Date.UTC(2026, 8, 17, 3, 0)
const ACTOR = { id: 'uid-m', name: 'Manager' }

const schedule = (over: Partial<InventorySchedule> = {}): InventorySchedule => ({
  id: 'sched1', kind: 'stockCount', name: 'นับคลังหลัก', locationId: 'main', frequency: 'weekly', daysOfWeek: [1, 4],
  startTime: '09:00', priority: 'normal', enabled: true, createdBy: 'uid-a', createdAt: NOW - 30 * DAY_MS, updatedAt: 1, ...over,
})

const tasks = () => raw('stockEvents') as unknown as StockEvent[]

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
  invalidateScheduleCache()
})

describe('generating stock-count tasks', () => {
  test('writes two weeks of the schedule, and a second run writes nothing', async () => {
    seed('inventorySchedules', [schedule() as unknown as Record<string, unknown>])
    const first = await generateStockCountTasks(ACTOR, NOW)
    // Mondays and Thursdays from today through 14 days out: 17, 21, 24, 28 Sep and 1 Oct.
    expect(first.written).toBe(5)
    expect(tasks().map((t) => t.id)).toContain(taskIdFor('sched1', bkkDayStart(NOW)))
    const second = await generateStockCountTasks(ACTOR, NOW)
    expect(second.written).toBe(0)
    expect(tasks()).toHaveLength(5)
  })

  test('each task names its schedule and is signed by whoever ran the job', async () => {
    seed('inventorySchedules', [schedule() as unknown as Record<string, unknown>])
    await generateStockCountTasks(ACTOR, NOW)
    const t = tasks()[0]
    expect(t).toMatchObject({ type: 'stockCount', status: 'upcoming', sourceType: 'schedule', scheduleId: 'sched1', refKey: t.id, createdBy: ACTOR.id })
    expect(t.history?.[0]).toMatchObject({ action: 'generated', by: ACTOR.id })
  })

  test('a task moved out of the window does not come back on its old day', async () => {
    seed('inventorySchedules', [schedule() as unknown as Record<string, unknown>])
    await generateStockCountTasks(ACTOR, NOW)
    const today = tasks().find((t) => t.id === taskIdFor('sched1', bkkDayStart(NOW)))!
    await rescheduleEvent(today, NOW + 40 * DAY_MS, 'ปิดปรับปรุง', ACTOR)
    const again = await generateStockCountTasks(ACTOR, NOW)
    expect(again.written).toBe(0)
    expect(tasks()).toHaveLength(5)
  })

  test('a disabled schedule, or the settings document, makes no tasks', async () => {
    seed('inventorySchedules', [
      schedule({ enabled: false }) as unknown as Record<string, unknown>,
      { id: 'settings', kind: 'settings', coverDays: 7, updatedAt: 1 },
    ])
    expect((await generateStockCountTasks(ACTOR, NOW)).written).toBe(0)
    expect(tasks()).toHaveLength(0)
  })

  test('each brand generates from its own schedules into its own tasks', async () => {
    seed('lelapin__inventorySchedules', [schedule({ id: 'll' }) as unknown as Record<string, unknown>])
    expect((await generateStockCountTasks(ACTOR, NOW)).written).toBe(0)
    setActiveBrand('lelapin')
    invalidateScheduleCache()
    expect((await generateStockCountTasks(ACTOR, NOW)).written).toBe(5)
    expect(raw('lelapin__stockEvents')).toHaveLength(5)
    expect(raw('stockEvents')).toHaveLength(0)
  })
})

describe('when the browser runs it', () => {
  test('in local mode, anyone on the device', async () => {
    expect(await shouldRunOnOpen('staff', NOW)).toBe(true)
  })
})
