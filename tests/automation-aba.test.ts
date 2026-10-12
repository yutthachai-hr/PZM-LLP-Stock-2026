// ABA brand switch (owner review, 12 Oct 2026): a Pizza Mania job is paused on a read, the
// brand goes Pizza → Le Lapin → Pizza, then the read completes. The brand id is the same again,
// but the job's world is not: the old job must not finish on stale or emptied data, must not
// mark the run done, and a fresh job must still do the work. Controlled promises, no sleeps.
//
//   npm test

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const writes: { brand: string; collection: string; id: string }[] = []
  const reads: { brand: string; collection: string }[] = []
  const barriers = new Map<string, { promise: Promise<void>; open: () => void }>()
  const applied: { brand: unknown; ids: string[] }[] = []
  const settingsSeen: unknown[] = []
  return { writes, reads, barriers, applied, settingsSeen }
})

function barrier(name: string) {
  let open!: () => void
  const promise = new Promise<void>((r) => (open = r))
  h.barriers.set(name, { promise, open })
  return () => {
    h.barriers.delete(name)
    open()
  }
}
const pass = async (name: string) => {
  const b = h.barriers.get(name)
  if (b) await b.promise
}

// Each brand's stock-count schedules and settings, as Firestore would return them.
const FIXTURE: Record<string, Record<string, unknown>[]> = {
  pizza: [
    { id: 'sch-pizza', kind: 'stockCount', name: 'PIZZA COUNT', enabled: true },
    { id: 'settings', kind: 'settings', tag: 'pizza-settings' },
  ],
  lelapin: [
    { id: 'sch-lelapin', kind: 'stockCount', name: 'LAPIN COUNT', enabled: true },
    { id: 'settings', kind: 'settings', tag: 'lelapin-settings' },
  ],
}

vi.mock('../src/backend', () => {
  const db = (brand: string) => ({
    getAll: async (collection: string) => {
      h.reads.push({ brand, collection })
      await pass(`${brand}:${collection}`)
      return FIXTURE[brand] ?? []
    },
    getRange: async () => [],
    getOne: async () => null,
    set: async (collection: string, id: string) => void h.writes.push({ brand, collection, id }),
  })
  return { backend: { forBrand: db, getOne: async () => null }, BACKEND_MODE: 'cloud' }
})
vi.mock('../src/lib/inventoryRules/schedules', () => ({
  GENERATE_AHEAD_DAYS: 14,
  // One task per enabled schedule, named after it: the write shows whose schedules were used.
  missingTasks: (enabled: { id: string }[]) => enabled.map((s) => ({ id: `task-${s.id}`, startAt: 0 })),
  taskIdFor: () => 'task',
}))
const patchEvent = vi.hoisted(() => vi.fn())
vi.mock('../src/data/eventCache', () => ({
  patchEvent,
  fetchRange: async () => {
    await pass('events')
    return []
  },
}))
vi.mock('../src/data/orderCache', () => ({ orderCache: { fetchRange: async () => [] } }))
vi.mock('../src/data/requestCache', () => ({ requestCache: { fetchRange: async () => [] } }))
vi.mock('../src/data/transferCache', () => ({ transferCache: { fetchRange: async () => [] } }))
// Answers for the brand open when it is called, as the real (per-brand cached) list does.
vi.mock('../src/services/suppliers', async () => {
  const { getBrand } = await import('../src/brand/brand')
  return { loadSuppliers: async () => [{ id: `sup-${getBrand()}` }] }
})
vi.mock('../src/lib/riskNotifications', () => ({ riskEngineInput: () => ({}) }))
vi.mock('../src/lib/inventoryRules/insights', () => ({ inventoryInsights: () => ({ adjustments: [] }) }))
vi.mock('../src/lib/inventoryRules/stockView', () => ({ stockView: () => ({ qtyAt: () => 0, minFor: () => 0, tracksProduct: () => true }) }))
vi.mock('../src/lib/inventoryRules/notifications', () => ({
  STATEFUL: new Set<string>(),
  weeklyFigures: () => ({}),
  // The notification names the settings and suppliers it was computed from.
  evaluate: (input: { settings: { tag?: string }; suppliers: { id: string }[] }) => {
    h.settingsSeen.push(input.settings.tag ?? 'DEFAULTS')
    return [{ id: `n-${input.settings.tag ?? 'DEFAULTS'}-${input.suppliers.map((s) => s.id).join('+')}` }]
  },
  plan: (drafts: { id: string }[]) => ({ create: drafts, rearm: [], resolve: [] }),
}))
vi.mock('../src/services/notifications', () => ({
  getActiveNotifications: async () => [],
  getNotifications: async () => [],
  applyPlan: async (p: { create: { id: string }[] }, brand?: string) => (h.applied.push({ brand, ids: p.create.map((d) => d.id) }), p.create.length),
  backfillAudience: async () => 0,
}))

import { setActiveBrand } from '../src/brand/brand'
import { invalidateScheduleCache, loadScheduleConfig } from '../src/services/schedules'
import { runNotificationJobs, runOnOpen } from '../src/services/automation'

const store = new Map<string, string>()
const NOW = Date.UTC(2026, 9, 12, 3)
const admin = { id: 'u1', name: 'Admin', role: 'admin' as const }
const data = { products: [], locations: [], levels: [], minOverrides: [], movements: [], notifications: [] }
const markers = () => Object.fromEntries([...store.entries()].filter(([k]) => k.startsWith('pzm.automation')))
const readsOf = (brand: string, collection: string) => h.reads.filter((r) => r.brand === brand && r.collection === collection).length

beforeEach(() => {
  store.clear()
  h.writes.length = 0
  h.reads.length = 0
  h.applied.length = 0
  h.settingsSeen.length = 0
  patchEvent.mockClear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  setActiveBrand('pizza')
  invalidateScheduleCache()
})
afterEach(() => vi.unstubAllGlobals())

describe('A → B → A while a job waits', () => {
  test('stock-count generator: the old job stops without marking; a fresh job generates Pizza\'s tasks', async () => {
    const release = barrier('pizza:inventorySchedules')
    const old = runOnOpen(admin, NOW)
    await vi.waitFor(() => expect(readsOf('pizza', 'inventorySchedules')).toBe(1))
    setActiveBrand('lelapin')
    setActiveBrand('pizza')
    release()
    const r = await old
    // Nothing written, nothing marked: it cannot claim today's run.
    expect(r?.skipped).toBe('brandChanged')
    expect(h.writes).toEqual([])
    expect(markers()).toEqual({})
    // A legitimate new job (the reopened brand) does the work, with Pizza's own schedules.
    const fresh = await runOnOpen(admin, NOW)
    expect(fresh?.written).toBe(1)
    expect(h.writes).toEqual([{ brand: 'pizza', collection: 'stockEvents', id: 'task-sch-pizza' }])
    expect(Object.keys(markers())).toEqual(['pzm.automation.ranDay'])
    expect(markers()['pzm.automation.ranDay']).toMatch(/^pizza:/)
  })

  test('notification jobs: the old job stops before any write or marker; a fresh job uses Pizza\'s data', async () => {
    const release = barrier('events')
    const old = runNotificationJobs(admin, data, NOW)
    await vi.waitFor(() => expect(h.barriers.has('events')).toBe(true))
    await vi.waitFor(() => expect(readsOf('pizza', 'inventorySchedules')).toBe(1))
    setActiveBrand('lelapin')
    setActiveBrand('pizza')
    release()
    expect(await old).toBe(0)
    expect(h.applied).toEqual([])
    expect(markers()).toEqual({})
    const written = await runNotificationJobs(admin, data, NOW)
    expect(written).toBe(1)
    expect(h.applied).toEqual([{ brand: 'pizza', ids: ['n-pizza-settings-sup-pizza'] }])
    expect(Object.keys(markers()).every((k) => k.endsWith(':pizza'))).toBe(true)
  })
})

describe('useAutomation tick: the epoch is taken at the start of the tick', () => {
  test("a notification job begun after A → B → A with the tick's old epoch does nothing", async () => {
    const { brandEpoch } = await import('../src/brand/brand')
    const epoch = brandEpoch() // the tick starts (Pizza)
    await runOnOpen(admin, NOW, 'pizza', epoch)
    setActiveBrand('lelapin')
    setActiveBrand('pizza')
    // The tick goes on to the notification job with data read before the switches.
    expect(await runNotificationJobs(admin, data, NOW, 'pizza', epoch)).toBe(0)
    expect(h.applied).toEqual([])
    expect(Object.keys(markers()).some((k) => k.includes('notifiedAt'))).toBe(false)
  })
})

describe('schedule cache across A → B → A', () => {
  test('the caller of an interrupted load gets the rows it loaded — never an empty list — and they are not kept', async () => {
    const release = barrier('pizza:inventorySchedules')
    const pending = loadScheduleConfig()
    await vi.waitFor(() => expect(readsOf('pizza', 'inventorySchedules')).toBe(1))
    setActiveBrand('lelapin')
    setActiveBrand('pizza')
    release()
    const got = await pending
    expect(got.schedules.map((s) => s.id)).toEqual(['sch-pizza'])
    expect((got.settings as unknown as { tag?: string }).tag).toBe('pizza-settings')
    // Not kept as the current copy: the next call reads again.
    await loadScheduleConfig()
    expect(readsOf('pizza', 'inventorySchedules')).toBe(2)
  })
})
