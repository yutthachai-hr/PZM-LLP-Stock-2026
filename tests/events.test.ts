// The inventory calendar's data access.
//
//   npm test
//
// The point of most of these is what the calendar must NOT do: read the whole collection,
// or subscribe to it. The range query is the whole cost model.

import { beforeEach, describe, expect, test, vi } from 'vitest'

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
  setEventStatus,
  updateEvent,
  weekBounds,
} = await import('../src/services/events')
const { setActiveBrand } = await import('../src/brand/brand')

const ADMIN = 'uid-admin'
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
    expect(row.createdBy).toBe(ADMIN)
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
    const before = (raw('stockEvents') as Record<string, unknown>[])[0]
    await setEventStatus(id, 'completed')
    const after = (raw('stockEvents') as Record<string, unknown>[])[0]
    expect(after.status).toBe('completed')
    expect(after.title).toBe(before.title)
    expect(after.createdBy).toBe(before.createdBy)
    expect(after.createdAt).toBe(before.createdAt)
  })

  test('clearing an optional field removes it instead of blanking it', async () => {
    const id = await createEvent({ ...BASE, note: 'เดิม', assignedTo: 'u1' }, ADMIN)
    expect('note' in (raw('stockEvents') as Record<string, unknown>[])[0]).toBe(true)
    await updateEvent(id, BASE)
    const row = (raw('stockEvents') as Record<string, unknown>[])[0]
    expect('note' in row).toBe(false)
    expect('assignedTo' in row).toBe(false)
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
