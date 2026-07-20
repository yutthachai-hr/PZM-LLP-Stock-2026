import type { Backend, SubscribeOptions, TxContext } from './types'
import { resolveCollection } from '../brand/brand'

// localStorage-backed backend with cross-tab real-time via BroadcastChannel + storage events.
// All data lives under one key per collection so it is easy to inspect, export, and back up.
// Collection names are brand-scoped via resolveCollection() so brands never mix.

const PREFIX = 'pmstock:v1:'
const CHANNEL = 'pmstock:v1'

type DocMap = Record<string, Record<string, unknown>>

function keyOf(collection: string): string {
  return PREFIX + collection
}

function loadMap(collection: string): DocMap {
  try {
    const raw = localStorage.getItem(keyOf(collection))
    return raw ? (JSON.parse(raw) as DocMap) : {}
  } catch {
    return {}
  }
}

function saveMap(collection: string, map: DocMap): void {
  localStorage.setItem(keyOf(collection), JSON.stringify(map))
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

function notifyLocal(collection: string): void {
  const set = listeners.get(collection)
  if (!set) return
  const docs = Object.values(loadMap(collection))
  set.forEach((cb) => cb(docs))
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
  if (ev.key && ev.key.startsWith(PREFIX)) {
    const col = ev.key.slice(PREFIX.length)
    notifyLocal(col)
  }
})

function commit(collection: string, map: DocMap): void {
  saveMap(collection, map)
  notifyLocal(collection)
  broadcast(collection)
}

export function createLocalBackend(): Backend {
  return {
    mode: 'local',

    subscribe<T>(collection: string, cb: (docs: T[]) => void, opts?: SubscribeOptions): () => void {
      const c = resolveCollection(collection)
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
      // fire immediately with current data
      cb(apply(Object.values(loadMap(c))) as T[])
      return () => {
        set?.delete(listener)
      }
    },

    async getAll<T>(collection: string): Promise<T[]> {
      return Object.values(loadMap(resolveCollection(collection))) as T[]
    },

    async getOne<T>(collection: string, id: string): Promise<T | null> {
      const map = loadMap(resolveCollection(collection))
      return (map[id] as T) ?? null
    },

    async add(collection: string, data: Record<string, unknown>): Promise<string> {
      const c = resolveCollection(collection)
      const id = genId()
      const map = loadMap(c)
      map[id] = { ...data, id }
      commit(c, map)
      return id
    },

    async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
      const c = resolveCollection(collection)
      const map = loadMap(c)
      map[id] = { ...data, id }
      commit(c, map)
    },

    async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
      const c = resolveCollection(collection)
      const map = loadMap(c)
      map[id] = { ...(map[id] ?? { id }), ...patch, id }
      commit(c, map)
    },

    async remove(collection: string, id: string): Promise<void> {
      const c = resolveCollection(collection)
      const map = loadMap(c)
      delete map[id]
      commit(c, map)
    },

    async transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
      // Single-threaded + synchronous storage => a simple read/buffer/commit is atomic enough.
      const touched = new Map<string, DocMap>()
      const load = (col: string): DocMap => {
        let m = touched.get(col)
        if (!m) {
          m = loadMap(col)
          touched.set(col, m)
        }
        return m
      }
      const tx: TxContext = {
        async get<T>(col: string, id: string): Promise<T | null> {
          const m = load(resolveCollection(col))
          return (m[id] as T) ?? null
        },
        set(col, id, data) {
          load(resolveCollection(col))[id] = { ...data, id }
        },
        update(col, id, patch) {
          const c = resolveCollection(col)
          const m = load(c)
          m[id] = { ...(m[id] ?? { id }), ...patch, id }
        },
        delete(col, id) {
          delete load(resolveCollection(col))[id]
        },
      }
      const result = await fn(tx)
      // commit every touched collection
      for (const [col, m] of touched) commit(col, m)
      return result
    },
  }
}
