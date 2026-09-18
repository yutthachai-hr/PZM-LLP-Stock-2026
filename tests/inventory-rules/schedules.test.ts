// Stock-count schedules: which days they fall on, and the task each day becomes — under an
// id that makes generating twice harmless.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { buildTaskDoc, missingTasks, occurrencesBetween, taskIdFor } from '../../src/lib/inventoryRules/schedules'
import { bkkDayKey, bkkDayStart, bkkTimeOf, bkkWeekday, DAY_MS } from '../../src/lib/inventoryRules/time'
import type { InventorySchedule } from '../../src/types'

// Thursday 2026-09-17, Bangkok
const T0 = bkkDayStart(Date.UTC(2026, 8, 17, 3, 0))
const ACTOR = { id: 'uid-m', name: 'Manager' }

const schedule = (over: Partial<InventorySchedule> = {}): InventorySchedule => ({
  id: 'sched1', kind: 'stockCount', name: 'นับคลังหลัก', locationId: 'main', frequency: 'weekly', daysOfWeek: [1],
  startTime: '09:00', priority: 'normal', enabled: true, createdBy: 'uid-a', createdAt: T0 - 30 * DAY_MS, updatedAt: 1, ...over,
})
const keys = (days: number[]) => days.map(bkkDayKey)

describe('occurrences', () => {
  test('daily: every day in the window', () => {
    expect(occurrencesBetween(schedule({ frequency: 'daily' }), T0, T0 + 3 * DAY_MS)).toHaveLength(4)
  })

  test('weekly: the chosen weekdays', () => {
    const days = occurrencesBetween(schedule({ daysOfWeek: [1, 5] }), T0, T0 + 13 * DAY_MS)
    expect(days.map(bkkWeekday)).toEqual([5, 1, 5, 1])
  })

  test('biweekly: every other week from the anchor week', () => {
    const anchor = T0 - 3 * DAY_MS // Monday 14 Sep
    const days = occurrencesBetween(schedule({ frequency: 'biweekly', daysOfWeek: [1], anchorDay: anchor }), T0, T0 + 28 * DAY_MS)
    expect(keys(days)).toEqual(['20260928', '20261012'])
  })

  test('monthly: the day of the month, and the last day when the month is shorter', () => {
    const days = occurrencesBetween(schedule({ frequency: 'monthly', dayOfMonth: 31 }), T0, T0 + 60 * DAY_MS)
    expect(keys(days)).toEqual(['20260930', '20261031'])
    const first = occurrencesBetween(schedule({ frequency: 'monthly', dayOfMonth: 1 }), T0, T0 + 20 * DAY_MS)
    expect(keys(first)).toEqual(['20261001'])
  })

  test('custom: every N days from the anchor', () => {
    const days = occurrencesBetween(schedule({ frequency: 'custom', intervalDays: 10, anchorDay: T0 }), T0, T0 + 25 * DAY_MS)
    expect(keys(days)).toEqual(['20260917', '20260927', '20261007'])
  })

  test('disabled: nothing', () => {
    expect(occurrencesBetween(schedule({ enabled: false, frequency: 'daily' }), T0, T0 + 3 * DAY_MS)).toEqual([])
  })
})

describe('the task a day becomes', () => {
  test('carries the schedule, the time, the assignment and its own id as the key', () => {
    const s = schedule({ assignedTo: ['uid-s'], assignedToName: 'S', requiresApproval: true, durationMin: 120, priority: 'high' })
    const task = buildTaskDoc(s, T0, ACTOR, 123)
    expect(task.id).toBe('sc__sched1__20260917')
    expect(task.refKey).toBe(task.id)
    expect(task).toMatchObject({ type: 'stockCount', sourceType: 'schedule', scheduleId: 'sched1', locationId: 'main', status: 'upcoming', priority: 'high', assignedTo: ['uid-s'], requiresApproval: true, createdBy: 'uid-m' })
    expect(bkkTimeOf(task.startAt)).toBe('09:00')
    expect(task.dueAt).toBe(task.startAt + 120 * 60_000)
    expect(task.history?.[0]).toMatchObject({ action: 'generated', by: 'uid-m' })
    expect(taskIdFor('sched1', T0)).toBe(task.id)
  })

  test('without a duration it is due by the end of the day', () => {
    const task = buildTaskDoc(schedule(), T0, ACTOR, 1)
    expect(bkkDayKey(task.dueAt!)).toBe('20260917')
    expect(task.dueAt! > task.startAt).toBe(true)
  })
})

describe('generating ahead', () => {
  test('writes only what is missing, and a second run writes nothing', () => {
    const s = [schedule({ id: 'a', frequency: 'daily' }), schedule({ id: 'b', daysOfWeek: [bkkWeekday(T0)] })]
    const first = missingTasks(s, new Set(), T0, T0 + 2 * DAY_MS, ACTOR, 1)
    expect(first.map((t) => t.id).sort()).toEqual(['sc__a__20260917', 'sc__a__20260918', 'sc__a__20260919', 'sc__b__20260917'])
    const have = new Set(first.map((t) => t.id))
    expect(missingTasks(s, have, T0, T0 + 2 * DAY_MS, ACTOR, 2)).toEqual([])
    // An absent day comes back — which is why a generated task is cancelled, never deleted
    // (the drawer offers no delete on one); absence means it was never made.
    have.delete('sc__a__20260918')
    expect(missingTasks(s, have, T0, T0 + 2 * DAY_MS, ACTOR, 3).map((t) => t.id)).toEqual(['sc__a__20260918'])
  })
})
