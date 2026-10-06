import { DELETE_FIELD, type TxContext } from '../../src/backend/tx'
import { assertCommandWrite, brandCollection, type ServerStore, type ServerWrite } from './serverStore'

/**
 * A Firestore-style transaction over the service-account store (ADR-001): the same
 * `TxContext` the app's transactions get, so the stock engine's transaction bodies
 * (src/commands) run here unchanged.
 *
 * Optimistic, like the SDK's: every document read is remembered with its updateTime (or as
 * missing), the writes are buffered, and the commit carries a precondition for each — a
 * read document must be unchanged, a document never read that is being created must not
 * exist yet. If anything moved, the body runs again on fresh reads.
 *
 * Collection names arrive as the app writes them (`stockMovements`) and are mapped to the
 * brand's physical collection (`lelapin__stockMovements`) here, the way backend.forBrand
 * does in the app.
 */
export class TxConflict extends Error {
  constructor() {
    super('busy')
  }
}

export async function runServerTx<R>(
  store: ServerStore,
  brand: 'pizza' | 'lelapin',
  command: { name: string; writes: Readonly<Record<string, readonly string[]>> },
  body: (tx: TxContext) => Promise<R>,
  tries = 5,
): Promise<R> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const reads = new Map<string, string | null>() // physical path → updateTime, or null when missing
    const writes = new Map<string, ServerWrite>()
    const physical = (c: string) => brandCollection(brand, c)
    const path = (c: string, id: string) => `${physical(c)}/${id}`
    let writing = false

    const tx: TxContext = {
      async get<T>(collection: string, id: string): Promise<T | null> {
        if (writing) throw new Error('a transaction must read everything before it writes')
        const got = await store.get<T>(physical(collection), id)
        reads.set(path(collection, id), got ? got.updateTime : null)
        return got ? got.doc : null
      },
      set(collection, id, data) {
        writing = true
        writes.set(path(collection, id), { op: 'set', collection: physical(collection), id, data: clean(data) })
      },
      update(collection, id, patch) {
        writing = true
        const p = path(collection, id)
        const prior = writes.get(p)
        const data = clean(patch)
        // An update after a set in the same body folds into the set.
        writes.set(p, prior ? { ...prior, data: { ...prior.data, ...data } } : { op: 'update', collection: physical(collection), id, data })
      },
      delete() {
        throw new Error('stock commands never delete')
      },
    }

    const result = await body(tx)
    const list = [...writes.entries()].map(([p, w]) => {
      const seen = reads.get(p)
      const precondition: ServerWrite['precondition'] =
        seen === undefined ? (w.op === 'set' ? { exists: false } : { exists: true }) : seen === null ? { exists: false } : { updateTime: seen }
      return { ...w, precondition }
    })
    // The documents only read decided what was written too (a product, a location): the
    // commit verifies they are unchanged, the way the SDK does for a transaction's reads.
    for (const [p, seen] of reads) {
      if (writes.has(p)) continue
      const [c, ...rest] = p.split('/')
      list.push({ op: 'verify', collection: c, id: rest.join('/'), data: {}, precondition: seen === null ? { exists: false } : { updateTime: seen } })
    }
    assertCommandWrite(command.name, command.writes, list)
    if (!list.some((w) => w.op !== 'verify')) return result
    if (await store.commit(list)) return result
  }
  throw new TxConflict()
}

/** DELETE_FIELD becomes null (removal) in the server store's terms. */
function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) out[k] = v === DELETE_FIELD ? null : v
  return out
}
