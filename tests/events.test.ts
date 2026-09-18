// The inventory calendar's data access.
//
//   npm test
//
// The point of most of these is what the calendar must NOT do: read the whole collection,
// or subscribe to it. The range query is the whole cost model.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { StockEvent } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const {
  createEvent,
  dayBounds,
  deleteEvent,
  listEventsInRange,
  monthGridBounds,
  startEvent,
  completeEvent,
  approveEvent,
  reopenEvent,
  rescheduleEvent,
  cancelEvent,
  appendHistory,
  HISTORY_MAX,
  updateEvent,
  weekBounds,
} = await import('../src/services/events')
const { setActiveBrand } = await import('../src/brand/brand')

const ADMIN = { id: 'uid-admin', name: 'Admin' }
const STAFF = { id: 'uid-staff', name: 'Staff' }
const MANAGER = { id: 'uid-manager', name: 'Manager' }
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).getTime()

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
})

const BASE = {
  title: 'นับสต๊อกประจำสัปดาห์',
  type: 'stockCount' as const,
  priority: 'normal' as const,
  startAt: at(2026, 8, 15),
}

describe('creating', () => {
  test('a new event starts as upcoming and is attributed', async () => {
    const id = await createEvent(BASE, ADMIN)
    const [row] = raw('stockEvents') as Record<string, unknown>[]
    expect(row.id).toBe(id)
    expect(row.status).toBe('upcoming')
    expect(row.createdBy).toBe(ADMIN.id)
    expect(row.sourceType).toBe('manual')
    expect(row.history).toEqual([expect.objectContaining({ by: ADMIN.id, byName: 'Admin', action: 'created' })])
  })

  test('optional fields are omitted, never written empty', async () => {
    // The rules use hasOnly, and an empty string is still a present key — a blank note
    // would be a field the validator has to accept for no reason.
    await createEvent(BASE, ADMIN)
    const [row] = raw('stockEvents') as Record<string, unknown>[]
    for (const k of ['locationId', 'dueAt', 'assignedTo', 'assignedToName', 'note']) {
      expect(k in row).toBe(false)
    }
  })

  test('a title is required', async () => {
    await expect(createEvent({ ...BASE, title: '  ' }, ADMIN)).rejects.toThrow()
  })

  test('a deadline before the start is refused', async () => {
    // Otherwise the event is overdue the moment it is created.
    await expect(
      createEvent({ ...BASE, dueAt: BASE.startAt - 1000 }, ADMIN),
    ).rejects.toThrow()
  })
})

describe('reading a range', () => {
  beforeEach(async () => {
    await createEvent({ ...BASE, title: 'ก.ค.', startAt: at(2026, 6, 20) }, ADMIN)
    await createEvent({ ...BASE, title: 'ก.ย. ต้นเดือน', startAt: at(2026, 8, 2) }, ADMIN)
    await createEvent({ ...BASE, title: 'ก.ย. กลางเดือน', startAt: at(2026, 8, 15) }, ADMIN)
    await createEvent({ ...BASE, title: 'ต.ค.', startAt: at(2026, 9, 5) }, ADMIN)
  })

  test('only the window is returned — the collection is never read whole', async () => {
    const { from, to } = monthGridBounds(2026, 8)
    const rows = await listEventsInRange(from, to)
    // The September grid runs Aug 30 – Oct 3, so October the 5th is out and July is out.
    expect(rows.map((r) => r.title)).toEqual(['ก.ย. ต้นเดือน', 'ก.ย. กลางเดือน'])
  })

  test('results come back in time order', async () => {
    const rows = await listEventsInRange(at(2026, 0, 1), at(2026, 11, 31))
    expect(rows.map((r) => r.title)).toEqual(['ก.ค.', 'ก.ย. ต้นเดือน', 'ก.ย. กลางเดือน', 'ต.ค.'])
  })

  test('a day window catches only that day', async () => {
    const { from, to } = dayBounds(at(2026, 8, 15, 0))
    expect((await listEventsInRange(from, to)).map((r) => r.title)).toEqual(['ก.ย. กลางเดือน'])
  })

  test('a week window runs Sunday to Saturday', async () => {
    const { from, to } = weekBounds(at(2026, 8, 15))
    expect(new Date(from).getDay()).toBe(0)
    expect(to - from).toBe(7 * 86_400_000 - 1)
    expect((await listEventsInRange(from, to)).map((r) => r.title)).toEqual(['ก.ย. กลางเดือน'])
  })

  test('a backwards range is refused rather than returning nothing', async () => {
    await expect(listEventsInRange(at(2026, 8, 20), at(2026, 8, 1))).rejects.toThrow()
  })

  test('the month grid covers the cells actually on screen', async () => {
    // Leading and trailing cells belong to neighbouring months but are visible; querying
    // the calendar month alone would show them empty as though nothing were scheduled.
    const { from, to } = monthGridBounds(2026, 8)
    expect(new Date(from).getDay()).toBe(0)
    expect(new Date(to).getDay()).toBe(6)
    expect(from).toBeLessThanOrEqual(at(2026, 8, 1, 0))
    expect(to).toBeGreaterThanOrEqual(at(2026, 8, 30, 23))
  })
})

describe('changing', () => {
  test('status moves without touching anything else', async () => {
    const id = await createEvent(BASE, ADMIN)
    const before = (raw('stockEvents') as unknown as StockEvent[])[0]
    await startEvent(before, STAFF)
    const after = (raw('stockEvents') as Record<string, unknown>[])[0]
    expect(after.status).toBe('inProgress')
    expect(after.id).toBe(id)
    expect(after.title).toBe(before.title)
    expect(after.createdBy).toBe(before.createdBy)
    expect(after.createdAt).toBe(before.createdAt)
  })

  test('clearing an optional field removes it instead of blanking it', async () => {
    const id = await createEvent({ ...BASE, note: 'เดิม', assignedTo: ['u1'], assignedToAll: false }, ADMIN)
    expect('note' in (raw('stockEvents') as Record<string, unknown>[])[0]).toBe(true)
    await updateEvent(id, BASE, ADMIN, (raw('stockEvents') as unknown as StockEvent[])[0])
    const row = (raw('stockEvents') as Record<string, unknown>[])[0]
    expect('note' in row).toBe(false)
    expect('assignedTo' in row).toBe(false)
    expect('assignedToAll' in row).toBe(false)
  })

  // The owner asked for one person, several, or everyone.
  test('assignees are a list; everyone is a flag with no list beside it', async () => {
    await createEvent({ ...BASE, assignedTo: ['u1', 'u2'], assignedToName: 'A, B' }, ADMIN)
    await createEvent({ ...BASE, assignedToAll: true, assignedTo: ['u1'], assignedToName: 'ทุกคน' }, ADMIN)
    await createEvent({ ...BASE, assignedTo: [] }, ADMIN)
    const rows = raw('stockEvents') as Record<string, unknown>[]
    expect(rows[0].assignedTo).toEqual(['u1', 'u2'])
    // "everyone" is not a list of everyone — that would be wrong the day someone joins.
    expect(rows[1].assignedToAll).toBe(true)
    expect('assignedTo' in rows[1]).toBe(false)
    // an empty list means nobody, and nobody is the absence of the field
    expect('assignedTo' in rows[2]).toBe(false)
  })

  test('an event written before this, with one uid as a string, still reads', async () => {
    const { assigneesOf } = await import('../src/services/events')
    expect(assigneesOf({ assignedTo: 'u1' })).toEqual(['u1'])
    expect(assigneesOf({ assignedTo: ['u1', 'u2'] })).toEqual(['u1', 'u2'])
    expect(assigneesOf({})).toEqual([])
    expect(assigneesOf({ assignedToAll: true, assignedTo: 'u1' })).toEqual([])
  })

  test('deleting removes it', async () => {
    const id = await createEvent(BASE, ADMIN)
    await deleteEvent(id)
    expect(raw('stockEvents')).toHaveLength(0)
  })
})

describe('brands', () => {
  test('events are scoped like every other collection', async () => {
    await createEvent(BASE, ADMIN)
    setActiveBrand('lelapin')
    expect(await listEventsInRange(at(2026, 0, 1), at(2026, 11, 31))).toEqual([])
    await createEvent({ ...BASE, title: 'Le Lapin' }, ADMIN)

    setActiveBrand('pizza')
    const mine = await listEventsInRange(at(2026, 0, 1), at(2026, 11, 31))
    expect(mine.map((r) => r.title)).toEqual([BASE.title])
    expect(raw('stockEvents')).toHaveLength(1)
    expect(raw('lelapin__stockEvents')).toHaveLength(1)
  })
})

describe('the range query itself', () => {
  test('documents without the field are excluded, not treated as zero', async () => {
    seed('stockEvents', [{ id: 'broken', title: 'no startAt' }])
    await createEvent(BASE, ADMIN)
    const rows = await listEventsInRange(at(2026, 0, 1), at(2026, 11, 31))
    expect(rows.map((r) => r.title)).toEqual([BASE.title])
  })
})

describe('the workflow', () => {
  const load = () => (raw('stockEvents') as unknown as StockEvent[])[0]

  test('start then finish, each signed by the doer and written to the history', async () => {
    await createEvent(BASE, MANAGER)
    const started = await startEvent(load(), STAFF)
    expect(started.startedBy).toBe(STAFF.id)
    const done = await completeEvent(started, STAFF, { canApprove: false })
    expect(done.status).toBe('completed')
    const row = load()
    expect(row.status).toBe('completed')
    expect(row.completedBy).toBe(STAFF.id)
    expect(row.history?.map((h) => [h.action, h.by])).toEqual([
      ['created', MANAGER.id],
      ['started', STAFF.id],
      ['completed', STAFF.id],
    ])
  })

  test('a task that needs sign-off waits for a manager; the manager signs it', async () => {
    await createEvent({ ...BASE, requiresApproval: true }, MANAGER)
    const handed = await completeEvent(load(), STAFF, { canApprove: false })
    expect(handed.status).toBe('waitingApproval')
    expect(load().approvedBy).toBeUndefined()
    const signed = await approveEvent(load(), MANAGER)
    expect(signed.status).toBe('completed')
    expect(load().approvedBy).toBe(MANAGER.id)
  })

  test('a manager finishing a sign-off task signs it in the same step', async () => {
    await createEvent({ ...BASE, requiresApproval: true }, MANAGER)
    await completeEvent(load(), MANAGER, { canApprove: true })
    expect(load().status).toBe('completed')
    expect(load().approvedBy).toBe(MANAGER.id)
  })

  test('sent back: the reason is kept and the sign-off fields go', async () => {
    await createEvent({ ...BASE, requiresApproval: true }, MANAGER)
    await completeEvent(load(), STAFF, { canApprove: false })
    await expect(reopenEvent(load(), MANAGER, '  ')).rejects.toThrow()
    await reopenEvent(load(), MANAGER, 'นับไม่ครบชั้นบน')
    const row = load()
    expect(row.status).toBe('inProgress')
    expect('completedBy' in row).toBe(false)
    expect(row.history?.at(-1)).toMatchObject({ action: 'reopened', detail: 'นับไม่ครบชั้นบน', by: MANAGER.id })
  })

  test('a reschedule needs a reason, keeps the old time, and moves the deadline with it', async () => {
    await createEvent({ ...BASE, dueAt: BASE.startAt + 3_600_000 }, MANAGER)
    const newStart = BASE.startAt + 2 * 86_400_000
    await expect(rescheduleEvent(load(), newStart, '', MANAGER)).rejects.toThrow()
    await rescheduleEvent(load(), newStart, 'ของเข้าวันนั้น', MANAGER)
    const row = load()
    expect(row.startAt).toBe(newStart)
    expect(row.dueAt).toBe(newStart + 3_600_000)
    expect(row.rescheduledFrom).toBe(BASE.startAt)
    expect(row.history?.at(-1)).toMatchObject({ action: 'rescheduled', detail: 'ของเข้าวันนั้น', oldValue: String(BASE.startAt), newValue: String(newStart) })
  })

  test('an edit that changes the start is recorded as a move', async () => {
    await createEvent(BASE, MANAGER)
    await updateEvent(load().id, { ...BASE, startAt: BASE.startAt + 86_400_000 }, MANAGER, load())
    expect(load().rescheduledFrom).toBe(BASE.startAt)
    expect(load().history?.at(-1)?.action).toBe('rescheduled')
  })

  test('cancelled, with the reason; a closed task cannot be moved again', async () => {
    await createEvent(BASE, MANAGER)
    await cancelEvent(load(), MANAGER, 'ปิดร้าน')
    expect(load()).toMatchObject({ status: 'cancelled', cancelReason: 'ปิดร้าน' })
    await expect(startEvent(load(), STAFF)).rejects.toThrow()
    await expect(rescheduleEvent(load(), BASE.startAt + 1, 'x', MANAGER)).rejects.toThrow()
  })

  test('the history stays inside the cap and keeps its first line', () => {
    const line = (n: number) => ({ at: n, by: 'u', byName: 'U', action: 'edited' as const })
    let h = [line(0)]
    for (let i = 1; i < 250; i++) h = appendHistory(h, line(i))
    expect(h).toHaveLength(HISTORY_MAX)
    expect(h[0].at).toBe(0)
    expect(h.at(-1)?.at).toBe(249)
  })
})
