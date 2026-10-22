// Command-private atomic adapter for the trusted stock commands (stockCommand.ts). Brand-scoped,
// optimistic: every read pins its updateTime (or absence) and the one commit verifies them all.
// shortcut: same REST transaction shape as R25's experimentalStore, kept separate so neither
// widens the other's allow-list; fold into one policy-driven adapter once both have merged.
import type { Transactional, TxContext } from '../../src/backend/tx'
import { decodeFields, encodeFields, type FsValue } from '../../worker/src/codec'
import { brandCollection } from './serverStore'

export type StockBrand = 'pizza' | 'lelapin' | 'rnd'

const readable = new Set(['users', 'revokedUsers', 'meta', 'products', 'locations', 'counters', 'stockLevels'])
const writable = new Set(['meta', 'counters', 'stockLevels', 'stockMovements'])
const ATTEMPTS = 5
const safeId = (s: string) => /^[A-Za-z0-9_\-]{1,200}$/.test(s)

export class StockConflict extends Error {
  constructor() {
    super('STOCK_CONFLICT')
  }
}

export function stockCommandStore(
  projectId: string,
  brand: StockBrand,
  token: () => Promise<string>,
  fetcher: typeof fetch = fetch,
): Transactional {
  if (!/^[a-z0-9-]{4,40}$/.test(projectId)) throw Error('invalid project')
  const root = `projects/${projectId}/databases/(default)/documents`
  const base = `https://firestore.googleapis.com/v1/${root}`
  const name = (c: string, id: string) => {
    if (!safeId(id)) throw Error('invalid document id')
    // meta is global: only this brand's ledger revision and operation receipts are reachable.
    if (c === 'meta' && !(id === `stockLedger_${brand}` || /^stockop_[a-f0-9]{64}$/.test(id))) throw Error('invalid meta key')
    return `${root}/${brandCollection(brand, c)}/${id}`
  }
  async function call(suffix: string, body: unknown) {
    const r = await fetcher(base + suffix, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) {
      let status = ''
      try {
        status = ((await r.json()) as { error?: { status?: string } }).error?.status ?? ''
      } catch {
        /* the status code is enough */
      }
      if ([409, 412].includes(r.status) || ['ABORTED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(status)) throw new StockConflict()
      throw Error('STOCK_DATABASE_UNAVAILABLE')
    }
    return r.json()
  }

  return {
    async transaction<R>(run: (tx: TxContext) => Promise<R>): Promise<R> {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const reads = new Map<string, { doc: Record<string, unknown> | null; precondition: Record<string, unknown> }>()
        const writes = new Map<string, Record<string, unknown>>()
        let writing = false
        async function prefetch(documents: readonly { collection: string; id: string }[]) {
          if (writing) throw Error('read after write')
          const pending = new Map<string, string>()
          for (const { collection, id } of documents) {
            if (!readable.has(collection)) throw Error(`read not allowed: ${collection}`)
            const n = name(collection, id)
            if (!reads.has(n)) pending.set(n, id)
          }
          if (!pending.size) return
          if (pending.size > 200) throw Error('read budget exceeded')
          const rows = (await call(':batchGet', { documents: [...pending.keys()] })) as {
            found?: { name: string; fields?: Record<string, FsValue>; updateTime: string }
            missing?: string
          }[]
          if (!Array.isArray(rows)) throw Error('invalid read response')
          for (const row of rows) {
            const found = row?.found
            const n = found?.name ?? row?.missing
            if (!n || !pending.has(n) || reads.has(n)) throw Error('invalid read response')
            if (found && !found.updateTime) throw Error('missing read precondition')
            reads.set(n, {
              doc: found ? { ...decodeFields(found.fields ?? {}), id: pending.get(n)! } : null,
              precondition: found ? { updateTime: found.updateTime } : { exists: false },
            })
          }
          for (const n of pending.keys()) if (!reads.has(n)) throw Error('invalid read response')
        }
        const tx: TxContext = {
          prefetch,
          async get<T>(c: string, id: string) {
            await prefetch([{ collection: c, id }])
            return reads.get(name(c, id))!.doc as T | null
          },
          set(c, id, data) {
            writing = true
            if (!writable.has(c)) throw Error(`write not allowed: ${c}`)
            if (c === 'counters' && id !== 'adjust') throw Error('counter not allowed')
            if (c === 'stockMovements' && data.type !== 'adjust') throw Error('movement type not allowed')
            const n = name(c, id)
            const prior = reads.get(n)
            // Balances, counters and meta are read-modify-write; a movement is always a new row.
            if (!prior && c !== 'stockMovements') throw Error('write requires prior read')
            writes.set(n, { update: { name: n, fields: encodeFields({ ...data, id }) }, currentDocument: prior?.precondition ?? { exists: false } })
          },
          update() {
            throw Error('update not allowed')
          },
          delete() {
            throw Error('delete not allowed')
          },
        }
        try {
          const result = await run(tx)
          if (!writes.size) return result
          const all = [...writes.values()]
          // Reads that are not written still fence the commit: a revoked user or a retired
          // product between read and commit fails it.
          for (const [n, r] of reads) if (!writes.has(n)) all.push({ verify: n, currentDocument: r.precondition })
          if (all.length > 500) throw Error('write budget exceeded')
          await call(':commit', { writes: all })
          return result
        } catch (e) {
          if (e instanceof StockConflict && attempt < ATTEMPTS - 1) {
            // Two writers that collided collide again at once; back off with jitter so the winner commits.
            await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20))
            continue
          }
          throw e
        }
      }
      throw new StockConflict()
    },
  }
}
