import { DELETE_FIELD } from '../../src/backend/types'
import type { Backend, SubscribeOptions, TxContext } from '../../src/backend/types'
import { resolveCollection, type BrandId } from '../../src/brand/brand'

// An in-memory stand-in for the Backend interface, so the stock engine can be tested
// without Firebase or a browser.
//
// It resolves collection names through the real brand resolver, because half of what these
// tests are checking is which namespace a write lands in.
//
// Its transaction copies Firestore's shape deliberately: reads see the committed state,
// writes are buffered, and the whole buffer lands at the end or not at all. A double that
// wrote through immediately would make the engine look atomic when it is not.

type Docs = Map<string, Record<string, unknown>>

let store = new Map<string, Docs>()
let failWrite: ((collection: string, id: string) => boolean) | null = null
let seq = 0

function col(name: string, brand?: BrandId): Docs {
  const c = resolveCollection(name, brand)
  let m = store.get(c)
  if (!m) {
    m = new Map()
    store.set(c, m)
  }
  return m
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

/**
 * Apply a patch the way both real backends do, DELETE_FIELD included.
 *
 * This used to spread the patch straight in, so a DELETE_FIELD marker was stored as a
 * value rather than removing the key — the double said a cleared field was still there
 * while Firestore and localStorage both said it was gone. A test double that disagrees
 * with production about what "cleared" means will pass the wrong code.
 *
 * JSON.stringify also drops a Symbol value silently, so the marker cannot go through
 * clone() at all.
 */
function applyPatch_(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing }
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE_FIELD) delete out[k]
    else out[k] = clone(v)
  }
  return out
}

/** Empty the database and clear any injected failure. */
export function resetMemory(): void {
  store = new Map()
  failWrite = null
  seq = 0
}

/** Make writes matching `predicate` throw, to test what a half-finished operation leaves. */
export function failWritesWhere(predicate: (collection: string, id: string) => boolean): void {
  failWrite = predicate
}

/** Every document in a PHYSICAL collection name, i.e. including the brand prefix. */
export function raw(physicalCollection: string): Record<string, unknown>[] {
  return [...(store.get(physicalCollection)?.values() ?? [])].map(clone)
}

export function seed(physicalCollection: string, docs: Record<string, unknown>[]): void {
  let m = store.get(physicalCollection)
  if (!m) {
    m = new Map()
    store.set(physicalCollection, m)
  }
  for (const d of docs) m.set(d.id as string, clone(d))
}

function guard(collection: string, id: string, brand?: BrandId): void {
  const c = resolveCollection(collection, brand)
  if (failWrite?.(c, id)) {
    throw new Error(`injected write failure: ${c}/${id}`)
  }
}

export function createMemoryBackend(brand?: BrandId): Backend {
  const col_ = (name: string) => col(name, brand)
  const guard_ = (name: string, id: string) => guard(name, id, brand)
  const resolve = (name: string) => resolveCollection(name, brand)
  return {
  forBrand: (b: BrandId) => createMemoryBackend(b),

  mode: 'local',

  subscribe<T>(collection: string, cb: (docs: T[]) => void, _opts?: SubscribeOptions): () => void {
    cb([...col_(collection).values()].map(clone) as T[])
    return () => {}
  },

  subscribeOne<T>(collection: string, id: string, cb: (doc: T | null) => void): () => void {
    cb((clone(col_(collection).get(id)) as T) ?? null)
    return () => {}
  },

  async getAll<T>(collection: string): Promise<T[]> {
    return [...col_(collection).values()].map(clone) as T[]
  },

  async getRange<T>(collection: string, field: string, from: number, to: number): Promise<T[]> {
    return ([...col_(collection).values()].map(clone) as T[]).filter((d) => {
      const v = (d as Record<string, unknown>)[field]
      return typeof v === 'number' && v >= from && v <= to
    })
  },

  async getBy<T>(c: string, field: string, value: string | number | boolean): Promise<T[]> {
    return [...col_(c).values()].map((d) => clone(d)).filter((d) => d[field] === value) as T[]
  },

  async getOne<T>(collection: string, id: string): Promise<T | null> {
    return (clone(col_(collection).get(id)) as T) ?? null
  },

  async add(collection: string, data: Record<string, unknown>): Promise<string> {
    const id = `gen-${++seq}`
    guard_(collection, id)
    col_(collection).set(id, { ...clone(data), id })
    return id
  },

  async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    guard_(collection, id)
    col_(collection).set(id, { ...clone(data), id })
  },

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
    guard_(collection, id)
    const m = col_(collection)
    m.set(id, { ...applyPatch_(m.get(id) ?? { id }, patch), id })
  },

  async remove(collection: string, id: string): Promise<void> {
    guard_(collection, id)
    col_(collection).delete(id)
  },

  async transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
    // collection name (as resolved AT WRITE TIME) -> id -> value, or null for a delete
    const writes: [string, string, Record<string, unknown> | null][] = []

    const tx: TxContext = {
      async get<T>(c: string, id: string): Promise<T | null> {
        return (clone(col_(c).get(id)) as T) ?? null
      },
      set(c, id, data) {
        writes.push([resolve(c), id, { ...clone(data), id }])
      },
      update(c, id, patch) {
        // Not clone(patch): a JSON round-trip drops a Symbol-valued key outright, so the
        // DELETE_FIELD marker disappeared and the field it should have removed survived.
        const cur = col_(c).get(id) ?? { id }
        writes.push([resolve(c), id, { ...applyPatch_(cur, patch), id }])
      },
      delete(c, id) {
        writes.push([resolve(c), id, null])
      },
    }

    const result = await fn(tx)

    // Commit as one unit: check every write first, so an injected failure leaves nothing.
    for (const [c, id] of writes) {
      if (failWrite?.(c, id)) throw new Error(`injected write failure: ${c}/${id}`)
    }
    for (const [c, id, value] of writes) {
      let m = store.get(c)
      if (!m) {
        m = new Map()
        store.set(c, m)
      }
      if (value === null) m.delete(id)
      else m.set(id, value)
    }
    return result
  },
  }
}

/** The instance the tests inject in place of src/backend. */
export const memoryBackend: Backend = createMemoryBackend()
