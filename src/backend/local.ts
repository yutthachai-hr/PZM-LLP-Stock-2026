import type { Backend, SubscribeOptions, TxContext } from './types'
import { resolveCollection, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'

// localStorage-backed backend with cross-tab real-time via BroadcastChannel + storage events.
// All data lives under one key per collection so it is easy to inspect, export, and back up.
// Collection names are brand-scoped via resolveCollection() so brands never mix.
//
// This is the try-it-out mode. It is NOT a place for real stock: passwords live in
// localStorage in the clear and nothing on a server checks who is asking. What it still has
// to do is not lose or silently rewrite what it was given, which is what the code below is
// mostly about.
//
// Known limit, deliberately not fixed: writes are serialised within one tab, not across
// tabs. Two tabs racing on the same collection can still lose an update. Closing that needs
// Web Locks or IndexedDB transactions, which is not worth building for a demo mode.

const PREFIX = 'pmstock:v1:'
/** Where unparseable data is kept so it is not thrown away with the next write. */
const CORRUPT_PREFIX = 'pmstock:v1:corrupt:'
const CHANNEL = 'pmstock:v1'

type DocMap = Record<string, Record<string, unknown>>

/**
 * A dictionary with no prototype.
 *
 * With a plain `{}`, `map['constructor']` returns a function nobody stored, and writing to
 * `map['__proto__']` reshapes the map instead of saving a document. Document ids come from
 * generated strings and from restored files, so neither is hypothetical.
 */
function emptyMap(): DocMap {
  return Object.create(null) as DocMap
}

function keyOf(collection: string): string {
  return PREFIX + collection
}

/**
 * Stash the unreadable bytes and explain what happened.
 *
 * This used to be `catch { return {} }`, which is the worst possible answer: damaged data
 * looked like an empty collection, the screens showed an empty warehouse, and the next
 * write saved that emptiness over the only copy. Failing here keeps the original bytes
 * where a person can still get at them.
 */
function corrupt(collection: string): AppError {
  const key = keyOf(collection)
  const raw = localStorage.getItem(key)
  try {
    const stash = CORRUPT_PREFIX + collection
    if (raw !== null && localStorage.getItem(stash) === null) {
      localStorage.setItem(stash, raw)
    }
  } catch {
    /* the original key is untouched either way, which is the part that matters */
  }
  return new AppError(
    'ข้อมูลในเครื่องของ "{collection}" เสียหาย อ่านไม่ได้ — ระบบหยุดไว้เพื่อไม่ให้เขียนทับ (สำเนาที่เสียถูกเก็บไว้ที่ {key})',
    { collection, key: CORRUPT_PREFIX + collection },
  )
}

function loadMap(collection: string): DocMap {
  const raw = localStorage.getItem(keyOf(collection))
  if (raw === null || raw === '') return emptyMap()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw corrupt(collection)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw corrupt(collection)
  }

  // JSON.parse defines "__proto__" as an own property rather than invoking the setter, so
  // copying entry by entry into a null-prototype map keeps it a document.
  const map = emptyMap()
  for (const [id, doc] of Object.entries(parsed as Record<string, unknown>)) {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw corrupt(collection)
    map[id] = doc as Record<string, unknown>
  }
  return map
}

function saveMap(collection: string, map: DocMap): void {
  localStorage.setItem(keyOf(collection), JSON.stringify(map))
}

/**
 * Write several collections, or none of them.
 *
 * Storage is one key per collection, so a transaction spanning two of them is two writes,
 * and the second can fail on a full quota after the first has landed — a balance saved
 * without the movement that explains it. Keeping the previous values and putting them back
 * is the closest thing to a rollback this storage offers; the restore writes strings that
 * already fitted, so it does not fail for the reason the commit did.
 */
function commitAll(entries: [string, DocMap][]): void {
  const previous: [string, string | null][] = entries.map(([c]) => [
    keyOf(c),
    localStorage.getItem(keyOf(c)),
  ])
  try {
    for (const [c, m] of entries) saveMap(c, m)
  } catch (e) {
    for (const [key, prev] of previous) {
      try {
        if (prev === null) localStorage.removeItem(key)
        else localStorage.setItem(key, prev)
      } catch {
        /* nothing left to try; the throw below is still the honest answer */
      }
    }
    throw e
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

function genId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
  ).toUpperCase()
}

type Listener = (docs: unknown[]) => void

const listeners = new Map<string, Set<Listener>>()

// One BroadcastChannel shared across the app instance for other-tab notifications.
let channel: BroadcastChannel | null = null
try {
  channel = new BroadcastChannel(CHANNEL)
} catch {
  channel = null
}

/**
 * Run one subscriber callback without letting its failure escape into the caller.
 *
 * Telling the screens is not part of saving. A subscriber that throws — a screen that blows
 * up while rendering — used to reject the write that had already been committed, so the app
 * reported a failure for data that was safely stored, and stopped notifying everyone after
 * it in the same pass.
 */
function emit(deliver: () => void, collection: string): void {
  try {
    deliver()
  } catch (e) {
    console.error(`[local] a subscriber to ${collection} threw`, e)
  }
}

/** Tell every screen watching this collection that it changed. */
function notifyLocal(collection: string): void {
  const set = listeners.get(collection)
  if (!set || set.size === 0) return
  let docs: unknown[]
  try {
    docs = Object.values(loadMap(collection))
  } catch (e) {
    console.error(`[local] cannot read ${collection} to notify subscribers`, e)
    return
  }
  for (const cb of [...set]) emit(() => cb(docs), collection)
}

function broadcast(collection: string): void {
  try {
    channel?.postMessage({ collection })
  } catch {
    /* ignore */
  }
}

// React to changes coming from other tabs.
if (channel) {
  channel.onmessage = (ev: MessageEvent) => {
    const col = ev?.data?.collection
    if (typeof col === 'string') notifyLocal(col)
  }
}
window.addEventListener('storage', (ev) => {
  if (ev.key && ev.key.startsWith(PREFIX) && !ev.key.startsWith(CORRUPT_PREFIX)) {
    const col = ev.key.slice(PREFIX.length)
    notifyLocal(col)
  }
})

function commit(collection: string, map: DocMap): void {
  commitAll([[collection, map]])
  notifyLocal(collection)
  broadcast(collection)
}

/**
 * One write at a time.
 *
 * Every operation here is read-modify-write, and `await` between the read and the write is
 * enough for another one to slip in and be overwritten: ten transactions each adding one to
 * a counter used to end at one. Queueing them costs nothing at this scale and makes the
 * result the obvious one.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<R>(fn: () => Promise<R>): Promise<R> {
  const run = queue.then(fn, fn)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function createLocalBackend(brand?: BrandId): Backend {
  // `brand` undefined means "whatever is selected right now", which is what screens
  // want. Multi-step work calls forBrand() first and gets a copy pinned to one brand.
  const resolve = (name: string) => resolveCollection(name, brand)
  return {
    forBrand: (b: BrandId) => createLocalBackend(b),

    mode: 'local',

    subscribe<T>(collection: string, cb: (docs: T[]) => void, opts?: SubscribeOptions): () => void {
      const c = resolve(collection)
      let set = listeners.get(c)
      if (!set) {
        set = new Set()
        listeners.set(c, set)
      }
      // Mirror the cloud backend's `since` window so both modes show the same rows.
      const since = opts?.since
      const apply = (docs: unknown[]) =>
        since
          ? docs.filter((d) => Number((d as Record<string, unknown>)[since.field] ?? 0) >= since.value)
          : docs
      const listener = ((docs: unknown[]) => cb(apply(docs) as T[])) as Listener
      set.add(listener)
      // Read first, so corruption propagates rather than arriving as an empty list that
      // would show an empty warehouse and invite writing over it. Delivering is separate,
      // and a subscriber that throws is its own problem, not this one's.
      const initial = apply(Object.values(loadMap(c))) as T[]
      emit(() => cb(initial), c)
      return () => {
        set?.delete(listener)
      }
    },

    subscribeOne<T>(collection: string, id: string, cb: (d: T | null) => void): () => void {
      const c = resolve(collection)
      let set = listeners.get(c)
      if (!set) {
        set = new Set()
        listeners.set(c, set)
      }
      const pick = (docs: unknown[]) =>
        (docs.find((d) => (d as Record<string, unknown>).id === id) as T) ?? null
      const listener = ((docs: unknown[]) => cb(pick(docs))) as Listener
      set.add(listener)
      const initial = pick(Object.values(loadMap(c)))
      emit(() => cb(initial), c)
      return () => {
        set?.delete(listener)
      }
    },

    async getAll<T>(collection: string): Promise<T[]> {
      return Object.values(loadMap(resolve(collection))) as T[]
    },

    async getOne<T>(collection: string, id: string): Promise<T | null> {
      const map = loadMap(resolve(collection))
      return (Object.hasOwn(map, id) ? (map[id] as T) : null) ?? null
    },

    async add(collection: string, data: Record<string, unknown>): Promise<string> {
      const c = resolve(collection)
      return serialize(async () => {
        const id = genId()
        const map = loadMap(c)
        map[id] = { ...data, id }
        commit(c, map)
        return id
      })
    },

    async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
      const c = resolve(collection)
      return serialize(async () => {
        const map = loadMap(c)
        map[id] = { ...data, id }
        commit(c, map)
      })
    },

    async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
      const c = resolve(collection)
      return serialize(async () => {
        const map = loadMap(c)
        const existing = Object.hasOwn(map, id) ? map[id] : { id }
        map[id] = { ...existing, ...patch, id }
        commit(c, map)
      })
    },

    async remove(collection: string, id: string): Promise<void> {
      const c = resolve(collection)
      return serialize(async () => {
        const map = loadMap(c)
        delete map[id]
        commit(c, map)
      })
    },

    async transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
      return serialize(async () => {
        // Collections read, and separately the ones actually written. Committing everything
        // that was merely read rewrote untouched data, spent quota, and woke every screen
        // subscribed to it for nothing.
        const loaded = new Map<string, DocMap>()
        const dirty = new Set<string>()

        const load = (col: string): DocMap => {
          let m = loaded.get(col)
          if (!m) {
            m = loadMap(col)
            loaded.set(col, m)
          }
          return m
        }

        const tx: TxContext = {
          async get<T>(col: string, id: string): Promise<T | null> {
            const m = load(resolve(col))
            // A copy: the caller holding a reference into the map could otherwise edit the
            // database by assignment, with no write and no way to see it happen.
            return Object.hasOwn(m, id) ? (clone(m[id]) as T) : null
          },
          set(col, id, data) {
            const c = resolve(col)
            load(c)[id] = { ...clone(data), id }
            dirty.add(c)
          },
          update(col, id, patch) {
            const c = resolve(col)
            const m = load(c)
            const existing = Object.hasOwn(m, id) ? m[id] : { id }
            m[id] = { ...existing, ...clone(patch), id }
            dirty.add(c)
          },
          delete(col, id) {
            const c = resolve(col)
            delete load(c)[id]
            dirty.add(c)
          },
        }

        const result = await fn(tx)

        const changed = [...dirty]
        if (changed.length > 0) {
          commitAll(changed.map((c) => [c, loaded.get(c) as DocMap]))
          for (const c of changed) {
            notifyLocal(c)
            broadcast(c)
          }
        }
        return result
      })
    },
  }
}
