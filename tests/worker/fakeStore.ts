import { assertWritable, type Filter, type Store, type WriteOp } from '../../worker/src/store'

/**
 * The Worker's Store in memory, with Firestore's semantics where the jobs depend on them:
 * a create is refused when the id exists, a patch when it does not, and the collections
 * the Worker may write are checked exactly as the REST store checks them.
 */
export function fakeStore() {
  const data = new Map<string, Map<string, Record<string, unknown>>>()
  const col = (c: string) => {
    let m = data.get(c)
    if (!m) data.set(c, (m = new Map()))
    return m
  }
  let queries = 0
  let writes = 0
  const match = (doc: Record<string, unknown>, f: Filter) => {
    const v = doc[f.field] as never
    if (v === undefined) return false
    switch (f.op) {
      case '==':
        return v === f.value
      case '>=':
        return v >= (f.value as never)
      case '<=':
        return v <= (f.value as never)
      case '<':
        return v < (f.value as never)
      case '>':
        return v > (f.value as never)
      case 'in':
        return (f.value as unknown[]).includes(v)
    }
  }
  const store: Store = {
    async query<T>(c: string, filters: Filter[] = [], opts: { limit?: number } = {}) {
      queries++
      const rows = [...col(c).values()].filter((d) => filters.every((f) => match(d, f)))
      return structuredClone(opts.limit ? rows.slice(0, opts.limit) : rows) as T[]
    },
    async get<T>(c: string, id: string) {
      queries++
      const d = col(c).get(id)
      return d ? (structuredClone(d) as T) : null
    },
    async write(ops: WriteOp[]) {
      return ops.map((op) => {
        assertWritable(op.collection)
        writes++
        const m = col(op.collection)
        switch (op.type) {
          case 'create':
            if (m.has(op.id)) return false
            m.set(op.id, structuredClone({ ...op.doc, id: op.id }))
            return true
          case 'set':
            m.set(op.id, structuredClone({ ...op.doc, id: op.id }))
            return true
          case 'patch': {
            const cur = m.get(op.id)
            if (!cur) return false
            m.set(op.id, { ...cur, ...structuredClone(op.fields) })
            return true
          }
          case 'delete':
            m.delete(op.id)
            return true
        }
      })
    },
  }
  return {
    store,
    seed: (c: string, docs: Record<string, unknown>[]) => docs.forEach((d) => col(c).set(d.id as string, structuredClone(d))),
    all: (c: string) => [...col(c).values()],
    doc: (c: string, id: string) => col(c).get(id),
    counts: () => ({ queries, writes }),
  }
}
