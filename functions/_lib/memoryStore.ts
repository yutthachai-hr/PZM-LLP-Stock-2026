import { assertServerWrite, type ServerStore, type Versioned } from './serverStore'

/**
 * The ServerStore in memory: the tests' database, and the local preview's
 * (SUPPLIER_DEV_FIXTURE, see supplierEnv.ts). Enforces the same write allow-list and the
 * same updateTime precondition as the REST one, so a lost race behaves the same here.
 */
export function memoryServerStore(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const data = new Map<string, { doc: Record<string, unknown>; updateTime: string }>()
  let clock = 0
  const stamp = () => `t${++clock}`
  const key = (c: string, id: string) => `${c}/${id}`
  for (const [c, docs] of Object.entries(seed)) for (const [id, doc] of Object.entries(docs)) data.set(key(c, id), { doc: { ...doc, id }, updateTime: stamp() })

  const store: ServerStore & {
    data: typeof data
    /** Change a document behind the handlers' back, as another writer would. */
    touch(c: string, id: string, fields: Record<string, unknown>): void
    writes: number
  } = {
    data,
    writes: 0,
    async get<T>(c: string, id: string): Promise<Versioned<T> | null> {
      const row = data.get(key(c, id))
      return row ? { doc: structuredClone(row.doc) as T, updateTime: row.updateTime } : null
    },
    async patchIf(c, id, fields, updateTime) {
      assertServerWrite(c, fields, 'patch')
      const row = data.get(key(c, id))
      if (!row || row.updateTime !== updateTime) return false
      const next = { ...row.doc }
      for (const [k, v] of Object.entries(fields)) {
        if (v === null) delete next[k]
        else if (v !== undefined) next[k] = structuredClone(v)
      }
      data.set(key(c, id), { doc: next, updateTime: stamp() })
      store.writes++
      return true
    },
    async create(c, id, doc) {
      assertServerWrite(c, doc, 'create')
      if (data.has(key(c, id))) return false
      data.set(key(c, id), { doc: { ...structuredClone(doc), id }, updateTime: stamp() })
      store.writes++
      return true
    },
    touch(c, id, fields) {
      const row = data.get(key(c, id))
      if (row) data.set(key(c, id), { doc: { ...row.doc, ...fields }, updateTime: stamp() })
    },
  }
  return store
}
