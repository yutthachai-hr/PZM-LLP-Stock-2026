// The device copy of a range cache must hold a write the moment the screen shows it.
// R21-D: a resend confirmed in the wizard patched the order cache, but the copy kept on the
// device was only written after a 1.5 s debounce. A reload inside that window came back to the
// old copy - and to its sync time, so the delta catch-up was skipped and the old "resend"
// badge stayed up for up to a minute.

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const copies = new Map<string, unknown>()
vi.mock('../src/data/deviceStore', () => ({
  FULL_EVERY_MS: 24 * 60 * 60_000,
  readCopy: async (key: string) => (copies.has(key) ? structuredClone(copies.get(key)) : null),
  writeCopy: async (key: string, value: unknown) => void copies.set(key, structuredClone(value)),
}))

const { createRangeCache } = await import('../src/data/rangeCache')

interface Row { id: string; at: number; state: string }
const server: Row[] = [{ id: 'po1', at: 1_000, state: 'resend' }]
const makeCache = () =>
  createRangeCache<Row>({
    fetch: async () => server.map((r) => ({ ...r })),
    atOf: (r) => r.at,
    changedSince: async () => [],
    persist: 'purchaseOrders',
  })

beforeEach(() => {
  copies.clear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

test('a patched row survives a reload that comes straight after it', async () => {
  const before = makeCache()
  await before.fetchRange(0, 10_000, { force: true })
  await vi.advanceTimersByTimeAsync(2_000) // the first copy reaches the device

  before.patch({ id: 'po1', at: 1_000, state: 'sent' })
  await vi.advanceTimersByTimeAsync(0) // the reload happens now, not 1.5 s later

  const after = makeCache() // a fresh page: it hydrates from the device copy
  const rows = await after.fetchRange(0, 10_000)
  expect(rows.find((r) => r.id === 'po1')?.state).toBe('sent')
})

// R29 (PR30 review #1/#2): a share write folds its fields into the row the cache holds now,
// and the caller can wait until the device copy holds it.
test('patchFields merges into the held row and resolves after the device write', async () => {
  const cache = makeCache()
  await cache.fetchRange(0, 10_000, { force: true })
  server[0] = { id: 'po1', at: 1_000, state: 'received' }
  await cache.fetchRange(0, 10_000, { force: true }) // another device received it
  const merged = await cache.patchFields('po1', { state: 'received' })
  expect(merged).toMatchObject({ id: 'po1', state: 'received' })
  expect(await cache.patchFields('missing', { state: 'x' })).toBeUndefined()
  const after = makeCache()
  expect((await after.fetchRange(0, 10_000)).find((r) => r.id === 'po1')?.state).toBe('received')
  server[0] = { id: 'po1', at: 1_000, state: 'resend' }
})
