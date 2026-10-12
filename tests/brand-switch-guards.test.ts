// The checks behind the in-app brand switcher (9 Oct 2026): writes still on their way are
// counted (and waited for), forms with something keyed in them are reported, and the brand a
// device remembers is only ever one of the three.
//
//   npm test

import { afterEach, describe, expect, test, vi } from 'vitest'
import { pendingWriteCount, trackWrite, whenWritesSettle, withWriteTracking } from '../src/backend/pendingWrites'
import { flushUnsaved, reportUnsaved, unsavedWork } from '../src/brand/unsavedWork'
import { savedBrand, setActiveBrand } from '../src/brand/brand'
import type { Backend } from '../src/backend/types'
import { draftKey, persistDraft } from '../src/lib/useDraft'
import type { PurchaseOrder } from '../src/types'

// The supplier-link service, without the browser: its auth header, the per-brand order cache
// and the backend singleton are stand-ins (no DOM in these tests).
const cachePatch = vi.hoisted(() => vi.fn())
vi.mock('../src/services/poImages', () => ({ authHeader: async () => ({}) }))
vi.mock('../src/data/orderCache', () => ({ orderCache: { patch: cachePatch } }))
vi.mock('../src/backend', () => ({ BACKEND_MODE: 'cloud' }))

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('writes in flight', () => {
  test('counted while running, released on success and on failure', async () => {
    const a = deferred()
    const b = deferred()
    const pa = trackWrite(a.promise)
    const pb = trackWrite(b.promise).catch(() => 'failed')
    expect(pendingWriteCount()).toBe(2)
    a.resolve()
    await pa
    expect(pendingWriteCount()).toBe(1)
    b.reject(new Error('denied'))
    expect(await pb).toBe('failed')
    expect(pendingWriteCount()).toBe(0)
  })

  test('a switch waits for them, and gives up after its limit', async () => {
    expect(await whenWritesSettle(10)).toBe(true)
    const w = deferred()
    void trackWrite(w.promise)
    const waiting = whenWritesSettle(1_000)
    w.resolve()
    expect(await waiting).toBe(true)
    const stuck = deferred()
    void trackWrite(stuck.promise)
    expect(await whenWritesSettle(20)).toBe(false)
    stuck.resolve()
    await stuck.promise
    await Promise.resolve()
    expect(pendingWriteCount()).toBe(0)
  })

  test('every write method is counted, reads are not, and forBrand copies are counted too', async () => {
    const gate = deferred()
    const calls: string[] = []
    const fake = {
      mode: 'local',
      forBrand: () => fake,
      add: async () => (calls.push('add'), await gate.promise, 'id'),
      set: async () => (calls.push('set'), await gate.promise),
      update: async () => (calls.push('update'), await gate.promise),
      remove: async () => (calls.push('remove'), await gate.promise),
      transaction: async () => (calls.push('tx'), await gate.promise),
      getAll: async () => (calls.push('getAll'), []),
    } as unknown as Backend
    const db = withWriteTracking(fake)
    expect(db.mode).toBe('local')
    const pinned = db.forBrand('lelapin')
    const work = [db.add('x', {}), db.set('x', '1', {}), db.update('x', '1', {}), db.remove('x', '1'), pinned.transaction(async () => 1), db.getAll('x')]
    expect(pendingWriteCount()).toBe(5)
    gate.resolve()
    await Promise.all(work)
    expect(pendingWriteCount()).toBe(0)
    expect(calls).toEqual(['add', 'set', 'update', 'remove', 'tx', 'getAll'])
  })
})

describe('unsaved forms', () => {
  afterEach(() => {
    for (const e of unsavedWork()) reportUnsaved(`draft:${e.screen}`, null)
  })

  test('reported while non-empty; a flush names exactly the screens whose draft was not kept', () => {
    reportUnsaved('draft:receive', { screen: 'receive', flush: () => true })
    reportUnsaved('draft:adjust', { screen: 'adjust-lines', flush: () => { throw new Error('storage full') } })
    reportUnsaved('draft:issue', { screen: 'issue-transfer', flush: () => false })
    reportUnsaved('draft:order', { screen: 'new-order', flush: () => true })
    expect(flushUnsaved()).toEqual({ saved: ['receive', 'new-order'], failed: ['adjust-lines', 'issue-transfer'] })
    reportUnsaved('draft:adjust', null)
    reportUnsaved('draft:issue', null)
    expect(flushUnsaved()).toEqual({ saved: ['receive', 'new-order'], failed: [] })
  })

  test('a flush that returns anything but true counts as not kept', () => {
    reportUnsaved('draft:x', { screen: 'x', flush: (() => undefined) as unknown as () => boolean })
    expect(flushUnsaved().failed).toEqual(['x'])
  })
})

describe('a draft is only "saved" when it reads back', () => {
  function memory() {
    const m = new Map<string, string>()
    return { setItem: (k: string, v: string) => void m.set(k, v), getItem: (k: string) => m.get(k) ?? null, m }
  }

  test('written and read back: true', () => {
    const store = memory()
    expect(persistDraft(store, 'draft:pizza:u1:receive', { lines: [1] })).toBe(true)
    expect(JSON.parse(store.m.get('draft:pizza:u1:receive')!)).toEqual({ lines: [1] })
  })

  test('quota exceeded: false', () => {
    const full = { setItem: () => { throw new DOMException('quota', 'QuotaExceededError') }, getItem: () => null }
    expect(persistDraft(full, 'k', { a: 1 })).toBe(false)
  })

  test('storage unavailable (private window, blocked): false', () => {
    expect(persistDraft(undefined, 'k', { a: 1 })).toBe(false)
    const blocked = { setItem: () => { throw new Error('SecurityError') }, getItem: () => { throw new Error('SecurityError') } }
    expect(persistDraft(blocked, 'k', { a: 1 })).toBe(false)
  })

  test('a store that silently drops or alters the write: false', () => {
    expect(persistDraft({ setItem: () => {}, getItem: () => null }, 'k', { a: 1 })).toBe(false)
    expect(persistDraft({ setItem: () => {}, getItem: () => '{"a":2}' }, 'k', { a: 1 })).toBe(false)
  })

  test('a value that cannot be serialised: false', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(persistDraft(memory(), 'k', loop)).toBe(false)
  })

  test('drafts are kept per brand AND per person', () => {
    const keys = new Set([
      draftKey('pizza', 'u1', 'receive'),
      draftKey('lelapin', 'u1', 'receive'),
      draftKey('pizza', 'u2', 'receive'),
      draftKey('pizza', 'u1', 'adjust-lines'),
    ])
    expect(keys.size).toBe(4)
    expect(draftKey('rnd', 'u9', 'receive')).toBe('draft:rnd:u9:receive')
  })
})

describe("server commands are waited for and never patch another brand's cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setActiveBrand('pizza')
  })

  test("decideSupplierDate: counted while in flight; a switch mid-request leaves the new brand's cache alone", async () => {
    const { decideSupplierDate } = await import('../src/services/supplierConfirmation')
    let answer!: (r: Response) => void
    const sent: string[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      sent.push(String(init.body))
      return new Promise<Response>((res) => (answer = res))
    })
    const patch = cachePatch
    patch.mockClear()
    setActiveBrand('pizza')
    const order = { id: 'po1' } as PurchaseOrder
    const done = decideSupplierDate(order, 'c1', 'approve')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(pendingWriteCount()).toBe(1)
    expect(JSON.parse(sent[0]).brand).toBe('pizza')
    setActiveBrand('lelapin') // what an unsafe switch would do
    answer(new Response(JSON.stringify({ order: { id: 'po1', status: 'ordered' } }), { status: 200 }))
    await done
    expect(pendingWriteCount()).toBe(0)
    expect(patch).not.toHaveBeenCalled()
  })

  test('decideSupplierDate: same brand still open → the cache is updated', async () => {
    const { decideSupplierDate } = await import('../src/services/supplierConfirmation')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ order: { id: 'po1' } }), { status: 200 }))
    const patch = cachePatch
    patch.mockClear()
    setActiveBrand('pizza')
    await decideSupplierDate({ id: 'po1' } as PurchaseOrder, 'c1', 'approve')
    expect(patch).toHaveBeenCalledTimes(1)
  })
})

describe('the brand a device remembers', () => {
  afterEach(() => vi.unstubAllGlobals())
  const store = (value: string | null) =>
    vi.stubGlobal('localStorage', { getItem: () => value, setItem: () => {}, removeItem: () => {} })

  test('only one of the three brands, never anything else', () => {
    store('lelapin')
    expect(savedBrand()).toBe('lelapin')
    store('rnd')
    expect(savedBrand()).toBe('rnd')
    for (const bad of ['evil', 'PIZZA', '', '{"brand":"pizza"}', null]) {
      store(bad)
      expect(savedBrand(), String(bad)).toBeNull()
    }
  })

  test('storage that throws means none (first-time picker)', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(savedBrand()).toBeNull()
  })
})
