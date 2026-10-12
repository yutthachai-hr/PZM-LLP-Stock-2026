// The checks behind the in-app brand switcher (9 Oct 2026): writes still on their way are
// counted (and waited for), forms with something keyed in them are reported, and the brand a
// device remembers is only ever one of the three.
//
//   npm test

import { afterEach, describe, expect, test, vi } from 'vitest'
import { pendingWriteCount, trackWrite, whenWritesSettle, withWriteTracking } from '../src/backend/pendingWrites'
import { flushUnsaved, reportUnsaved, unsavedWork } from '../src/brand/unsavedWork'
import { savedBrand } from '../src/brand/brand'
import type { Backend } from '../src/backend/types'

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

  test('reported while non-empty, flushed on request, a failing flush does not stop the others', () => {
    const saved: string[] = []
    reportUnsaved('draft:receive', { screen: 'receive', flush: () => saved.push('receive') })
    reportUnsaved('draft:adjust', { screen: 'adjust', flush: () => { throw new Error('storage full') } })
    reportUnsaved('draft:issue', { screen: 'issue', flush: () => saved.push('issue') })
    expect(unsavedWork().map((e) => e.screen)).toEqual(['receive', 'adjust', 'issue'])
    flushUnsaved()
    expect(saved).toEqual(['receive', 'issue'])
    reportUnsaved('draft:adjust', null)
    expect(unsavedWork().map((e) => e.screen)).toEqual(['receive', 'issue'])
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
