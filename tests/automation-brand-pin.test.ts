// Background jobs keep to the brand they started under (owner, 12 Oct 2026). Each test stops a
// job on a promise it is waiting for, switches the open brand, then lets it carry on — and
// checks where every write and every device marker went.
//
//   npm test

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ---- stand-ins: the backend, the caches and the notification service record the brand ----

const h = vi.hoisted(() => {
  const writes: { brand: string; op: string; collection: string; id: string }[] = []
  const gates: Record<string, Promise<void> | undefined> = {}
  const calls: { fn: string; brand: unknown }[] = []
  return { writes, gates, calls }
})

function gate(name: string) {
  let open!: () => void
  h.gates[name] = new Promise<void>((r) => (open = r))
  return () => {
    delete h.gates[name]
    open()
  }
}
const waitAt = async (name: string) => {
  const g = h.gates[name]
  if (g) await g
}

vi.mock('../src/backend', () => {
  const forBrand = (brand: string) => ({
    getRange: async () => [],
    getOne: async (collection: string) => {
      if (collection === 'meta') return null
      h.calls.push({ fn: 'movedCheck', brand })
      await (h.gates['moved-check'] ?? Promise.resolve())
      return null
    },
    set: async (collection: string, id: string) => void h.writes.push({ brand, op: 'set', collection, id }),
  })
  return { backend: { forBrand, getOne: async () => null }, BACKEND_MODE: 'cloud' }
})
vi.mock('../src/services/schedules', () => ({
  loadScheduleConfig: async () => {
    h.calls.push({ fn: 'schedulesWait', brand: undefined })
    await (h.gates['schedules'] ?? Promise.resolve())
    return { schedules: [{ id: 's1', enabled: true }], settings: { usageWindowDays: 28 }, snoozes: [] }
  },
}))
vi.mock('../src/lib/inventoryRules/schedules', () => ({
  GENERATE_AHEAD_DAYS: 14,
  missingTasks: () => [{ id: 'task-1', startAt: 0 }],
  taskIdFor: () => 'task-1',
}))
const patchEvent = vi.hoisted(() => vi.fn())
vi.mock('../src/data/eventCache', () => ({
  patchEvent,
  fetchRange: async () => {
    h.calls.push({ fn: 'readsWait', brand: undefined })
    await (h.gates['reads'] ?? Promise.resolve())
    return []
  },
}))
vi.mock('../src/data/orderCache', () => ({ orderCache: { fetchRange: async () => [] } }))
vi.mock('../src/data/requestCache', () => ({ requestCache: { fetchRange: async () => [] } }))
vi.mock('../src/data/transferCache', () => ({ transferCache: { fetchRange: async () => [] } }))
vi.mock('../src/services/suppliers', () => ({ loadSuppliers: async () => [] }))
vi.mock('../src/lib/riskNotifications', () => ({ riskEngineInput: () => ({}) }))
vi.mock('../src/lib/inventoryRules/insights', () => ({ inventoryInsights: () => ({ adjustments: [] }) }))
vi.mock('../src/lib/inventoryRules/stockView', () => ({ stockView: () => ({ qtyAt: () => 0, minFor: () => 0, tracksProduct: () => true }) }))
vi.mock('../src/lib/inventoryRules/notifications', () => ({
  STATEFUL: new Set(['lowStock']),
  weeklyFigures: () => ({}),
  evaluate: () => [{ id: 'lowStock__flour' }],
  plan: () => ({ create: [{ id: 'lowStock__flour' }], rearm: [], resolve: [] }),
}))
vi.mock('../src/services/notifications', () => ({
  getActiveNotifications: async (brand?: string) => (h.calls.push({ fn: 'getActive', brand }), []),
  getNotifications: async (_ids: string[], brand?: string) => {
    h.calls.push({ fn: 'getNotifications', brand })
    await (h.gates['lookup'] ?? Promise.resolve())
    return [{ id: 'lowStock__flour', kind: 'lowStock', active: true }]
  },
  applyPlan: async (_p: unknown, brand?: string) => (h.calls.push({ fn: 'applyPlan', brand }), 1),
  backfillAudience: async (_d: unknown, brand?: string) => (h.calls.push({ fn: 'backfill', brand }), 0),
}))

import { setActiveBrand } from '../src/brand/brand'
import { runNotificationJobs, runOnOpen, shouldRunOnOpen } from '../src/services/automation'

const store = new Map<string, string>()
const NOW = Date.UTC(2026, 9, 12, 3) // 12 Oct 2026, 10:00 Bangkok
const DAY = '20261012' // bkkDayKey
const admin = { id: 'u1', name: 'Admin', role: 'admin' as const }
const data = { products: [], locations: [], levels: [], minOverrides: [], movements: [], notifications: [] }
const markers = () => Object.fromEntries([...store.entries()].filter(([k]) => k.startsWith('pzm.automation')))

beforeEach(() => {
  store.clear()
  h.writes.length = 0
  h.calls.length = 0
  patchEvent.mockClear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  setActiveBrand('pizza')
})
afterEach(() => vi.unstubAllGlobals())

describe('stock-count generator (runOnOpen)', () => {
  test('no switch: writes, cache update and the ran-today marker are all Pizza Mania', async () => {
    const r = await runOnOpen(admin, NOW)
    expect(r?.written).toBe(1)
    expect(h.writes).toEqual([{ brand: 'pizza', op: 'set', collection: 'stockEvents', id: 'task-1' }])
    expect(patchEvent).toHaveBeenCalledTimes(1)
    expect(markers()).toEqual({ 'pzm.automation.ranDay': `pizza:${DAY}` })
    // Not again today for this brand; still due for another.
    expect(await shouldRunOnOpen('admin', NOW, 'pizza')).toBe(false)
    expect(await shouldRunOnOpen('admin', NOW, 'lelapin')).toBe(true)
  })

  test('switch while the schedules load: nothing written, nothing marked — and the run is not lost', async () => {
    const release = gate('schedules')
    const job = runOnOpen(admin, NOW)
    // Switch only once the job is actually waiting on the schedules.
    await vi.waitFor(() => expect(h.calls.some((c) => c.fn === 'schedulesWait')).toBe(true))
    setActiveBrand('lelapin')
    release()
    const r = await job
    expect(r?.skipped).toBe('brandChanged')
    expect(h.writes).toEqual([])
    expect(patchEvent).not.toHaveBeenCalled()
    expect(markers()).toEqual({})
    // Back in Pizza Mania the same day, the run happens (once).
    setActiveBrand('pizza')
    expect(await shouldRunOnOpen('admin', NOW, 'pizza')).toBe(true)
    await runOnOpen(admin, NOW)
    expect(h.writes.map((w) => w.brand)).toEqual(['pizza'])
    expect(markers()).toEqual({ 'pzm.automation.ranDay': `pizza:${DAY}` })
  })

  test('switch after the writes started: they stay Pizza Mania, the marker too; the new brand\'s cache is left alone', async () => {
    const release = gate('moved-check')
    const job = runOnOpen(admin, NOW)
    // Wait until the job is actually inside the write phase (db already pinned).
    await vi.waitFor(() => expect(h.calls.some((c) => c.fn === 'movedCheck')).toBe(true))
    setActiveBrand('lelapin')
    release()
    await job
    expect(h.writes).toEqual([{ brand: 'pizza', op: 'set', collection: 'stockEvents', id: 'task-1' }])
    expect(patchEvent).not.toHaveBeenCalled()
    expect(markers()).toEqual({ 'pzm.automation.ranDay': `pizza:${DAY}` })
  })
})

describe('notification jobs (runNotificationJobs)', () => {
  test('no switch: reads, writes and every marker are Pizza Mania', async () => {
    expect(await runNotificationJobs(admin, data, NOW)).toBe(1)
    expect(h.calls.filter((c) => !c.fn.endsWith('Wait'))).toEqual([
      { fn: 'getActive', brand: 'pizza' },
      { fn: 'getNotifications', brand: 'pizza' },
      { fn: 'applyPlan', brand: 'pizza' },
      { fn: 'backfill', brand: 'pizza' },
    ])
    expect(Object.keys(markers()).sort()).toEqual([
      'pzm.automation.activeStates:pizza',
      'pzm.automation.notifiedAt:pizza',
      'pzm.automation.sweptAt:pizza',
    ])
  })

  test('switch during the read phase: stops before any write or marker', async () => {
    const release = gate('reads')
    const job = runNotificationJobs(admin, data, NOW)
    await vi.waitFor(() => expect(h.calls.some((c) => c.fn === 'readsWait')).toBe(true))
    setActiveBrand('rnd')
    release()
    expect(await job).toBe(0)
    expect(h.calls.filter((c) => !c.fn.endsWith('Wait'))).toEqual([])
    expect(markers()).toEqual({})
  })

  test('switch after the read phase: the rest still goes to Pizza Mania, nothing to the new brand', async () => {
    const release = gate('lookup')
    const job = runNotificationJobs(admin, data, NOW)
    await vi.waitFor(() => expect(h.calls.some((c) => c.fn === 'getNotifications')).toBe(true))
    setActiveBrand('lelapin')
    release()
    expect(await job).toBe(1)
    expect(h.calls.filter((c) => !c.fn.endsWith('Wait')).map((c) => c.brand)).toEqual(['pizza', 'pizza', 'pizza', 'pizza'])
    const keys = Object.keys(markers())
    expect(keys.every((k) => k.endsWith(':pizza'))).toBe(true)
    expect(keys).toHaveLength(3)
  })
})
