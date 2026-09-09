// Regression tests for the local-backend findings in AUDIT_FOR_CLAUDE.md
// (F33, F34, F35, F36, F37, F38).
//
//   npm test
//
// Local mode is the try-it-out mode, not a place for real stock — passwords sit in
// localStorage in the clear and no server checks anything. These tests are about the part
// that still matters in a demo: it must not lose or silently rewrite what it was given.

import { beforeEach, describe, expect, test, vi } from 'vitest'

// The module reads localStorage, BroadcastChannel and window at import time, so the
// browser it expects has to exist before it loads.
class MemoryStorage {
  map = new Map<string, string>()
  /** set to make setItem throw, standing in for a full quota */
  failOn: ((key: string) => boolean) | null = null

  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    if (this.failOn?.(k)) {
      const e = new Error('QuotaExceededError')
      e.name = 'QuotaExceededError'
      throw e
    }
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null
  }
  get length(): number {
    return this.map.size
  }
}

const storage = new MemoryStorage()

vi.stubGlobal('localStorage', storage)
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
vi.stubGlobal(
  'BroadcastChannel',
  class {
    onmessage: ((e: unknown) => void) | null = null
    postMessage() {}
    close() {}
  },
)

const { createLocalBackend } = await import('../src/backend/local')
const { setActiveBrand } = await import('../src/brand/brand')

const KEY = 'pmstock:v1:widgets'
let backend = createLocalBackend()

beforeEach(() => {
  setActiveBrand('pizza')
  storage.clear()
  storage.failOn = null
  backend = createLocalBackend()
})

describe('F35 — data that will not parse is not an empty database', () => {
  test('reading corrupted storage fails loudly instead of reporting nothing', async () => {
    storage.setItem(KEY, '{"a":{"id":"a",') // truncated, e.g. a half-finished write
    await expect(backend.getAll('widgets')).rejects.toThrow()
  })

  test('the corrupted value survives, so it can still be recovered', async () => {
    const damaged = '{"a":{"id":"a",'
    storage.setItem(KEY, damaged)
    await expect(backend.set('widgets', 'b', { name: 'new' })).rejects.toThrow()
    // The original bytes are what a recovery would have to work from.
    expect(storage.getItem(KEY)).toBe(damaged)
  })

  test('storage holding something that is not a document map is rejected', async () => {
    storage.setItem(KEY, '[1,2,3]')
    await expect(backend.getAll('widgets')).rejects.toThrow()
  })

  test('an empty collection is still just empty', async () => {
    await expect(backend.getAll('widgets')).resolves.toEqual([])
  })
})

describe('F34 — a transaction that runs out of room', () => {
  test('nothing is kept when one collection of the write fails', async () => {
    await backend.set('stockLevels', 'l1', { qty: 1 })
    storage.failOn = (k) => k.endsWith('stockMovements')

    await expect(
      backend.transaction(async (tx) => {
        tx.set('stockLevels', 'l1', { qty: 99 })
        tx.set('stockMovements', 'm1', { qty: 98 })
      }),
    ).rejects.toThrow()

    storage.failOn = null
    // The balance must not have moved without the movement that explains it.
    expect(await backend.getOne('stockLevels', 'l1')).toMatchObject({ qty: 1 })
    expect(await backend.getAll('stockMovements')).toEqual([])
  })
})

describe('F33 — two things happening at once', () => {
  test('ten concurrent increments produce ten, not one', async () => {
    await backend.set('counters', 'c', { value: 0 })
    await Promise.all(
      Array.from({ length: 10 }, () =>
        backend.transaction(async (tx) => {
          const cur = await tx.get<{ value: number }>('counters', 'c')
          tx.set('counters', 'c', { value: (cur?.value ?? 0) + 1 })
        }),
      ),
    )
    expect(await backend.getOne('counters', 'c')).toMatchObject({ value: 10 })
  })

  test('an ordinary write is not lost inside a transaction', async () => {
    await backend.set('widgets', 'a', { n: 1 })
    await Promise.all([
      backend.transaction(async (tx) => {
        const cur = await tx.get<{ n: number }>('widgets', 'a')
        tx.set('widgets', 'a', { n: (cur?.n ?? 0) + 1 })
      }),
      backend.update('widgets', 'a', { touched: true }),
    ])
    const doc = (await backend.getOne('widgets', 'a')) as Record<string, unknown>
    // Whichever ran second, both effects have to survive.
    expect(doc.touched).toBe(true)
    expect(doc.n).toBe(2)
  })
})

describe('F36 — reading is not writing', () => {
  test('a transaction that only reads changes nothing', async () => {
    await backend.set('widgets', 'a', { n: 1 })
    const before = storage.getItem(KEY)
    await backend.transaction(async (tx) => {
      await tx.get('widgets', 'a')
    })
    expect(storage.getItem(KEY)).toBe(before)
  })

  test('changing what a read returned does not change the database', async () => {
    await backend.set('widgets', 'a', { n: 1 })
    await backend.transaction(async (tx) => {
      const doc = (await tx.get('widgets', 'a')) as Record<string, unknown>
      doc.n = 999
    })
    expect(await backend.getOne('widgets', 'a')).toMatchObject({ n: 1 })
  })
})

describe('F37 — a listener that throws', () => {
  test('the write still succeeded, and says so', async () => {
    backend.subscribe('widgets', () => {
      throw new Error('a screen blew up while rendering')
    })
    await expect(backend.set('widgets', 'a', { n: 1 })).resolves.toBeUndefined()
    expect(await backend.getOne('widgets', 'a')).toMatchObject({ n: 1 })
  })

  test('one broken listener does not stop the others being told', async () => {
    let reached = 0
    backend.subscribe('widgets', () => {
      throw new Error('boom')
    })
    backend.subscribe('widgets', () => {
      reached++
    })
    await backend.set('widgets', 'a', { n: 1 })
    expect(reached).toBeGreaterThan(0)
  })
})

describe('F38 — document ids that collide with Object', () => {
  test('an id that only exists on Object.prototype reads as missing', async () => {
    expect(await backend.getOne('widgets', 'constructor')).toBeNull()
    expect(await backend.getOne('widgets', 'toString')).toBeNull()
    expect(await backend.getOne('widgets', '__proto__')).toBeNull()
  })

  test('writing to __proto__ stores a document rather than reshaping the map', async () => {
    await backend.set('widgets', '__proto__', { n: 1 })
    const all = await backend.getAll<Record<string, unknown>>('widgets')
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: '__proto__', n: 1 })
    expect(({} as Record<string, unknown>).n).toBeUndefined()
  })

  test('a stored id that shadows Object still round-trips', async () => {
    await backend.set('widgets', 'constructor', { n: 7 })
    expect(await backend.getOne('widgets', 'constructor')).toMatchObject({ n: 7 })
    await backend.remove('widgets', 'constructor')
    expect(await backend.getOne('widgets', 'constructor')).toBeNull()
  })
})
