// Which buttons the drawer offers on a task, per person. The rules are the real gate
// (tests/firestore-rules.test.ts); this pins the screen to the same answers, so nobody is
// offered a button that can only fail.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { isAssignedTo, taskActions } from '../../src/lib/inventoryRules/permissions'
import type { StockEvent } from '../../src/types'

const ADMIN = { id: 'uid-admin', role: 'admin' as const }
const MANAGER = { id: 'uid-manager', role: 'manager' as const }
const STAFF = { id: 'uid-staff', role: 'staff' as const }

const task = (over: Partial<StockEvent> = {}): StockEvent => ({
  id: 't1', title: 'นับสต๊อก', type: 'stockCount', startAt: 1, status: 'upcoming', priority: 'normal',
  createdBy: MANAGER.id, createdAt: 1, updatedAt: 1, ...over,
})

describe('staff', () => {
  test('start and finish a task that is theirs — named, for everyone, or for nobody', () => {
    for (const t of [task({ assignedTo: [STAFF.id] }), task({ assignedToAll: true }), task()]) {
      expect(taskActions(t, STAFF)).toEqual(['start', 'complete'])
    }
  })

  test('nothing on a task that is someone else\'s', () => {
    expect(taskActions(task({ assignedTo: ['uid-other'] }), STAFF)).toEqual([])
  })

  test('nothing once it is handed in or closed', () => {
    for (const status of ['waitingApproval', 'completed', 'cancelled'] as const) {
      expect(taskActions(task({ status }), STAFF)).toEqual([])
    }
  })

  test('a task written before assignees were a list still counts as theirs', () => {
    expect(isAssignedTo(task({ assignedTo: STAFF.id as unknown as string[] }), STAFF.id)).toBe(true)
    expect(isAssignedTo(task({ assignedTo: [] }), STAFF.id)).toBe(true)
  })
})

describe('managers', () => {
  test('work any open task, and edit, move and cancel it', () => {
    expect(taskActions(task({ assignedTo: ['uid-other'] }), MANAGER)).toEqual(['start', 'complete', 'edit', 'reschedule', 'cancel', 'delete'])
  })

  test('sign off or send back what is handed in', () => {
    expect(taskActions(task({ status: 'waitingApproval' }), MANAGER)).toEqual(['approve', 'reopen', 'edit', 'reschedule', 'cancel', 'delete'])
  })

  test('delete only a hand-made task they wrote; a generated one is cancelled instead', () => {
    expect(taskActions(task({ createdBy: ADMIN.id }), MANAGER)).not.toContain('delete')
    expect(taskActions(task({ sourceType: 'schedule' }), MANAGER)).not.toContain('delete')
    expect(taskActions(task({ sourceType: 'schedule' }), MANAGER)).toContain('cancel')
  })

  test('an admin deletes any hand-made task', () => {
    expect(taskActions(task({ createdBy: 'uid-someone' }), ADMIN)).toContain('delete')
  })
})
