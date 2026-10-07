import { DELETE_FIELD, VERSIONED, type TxContext } from '../../src/backend/tx'
import { assertCommandWrite, baseOf, brandCollection, type ServerStore, type ServerWrite } from './serverStore'

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

/**
 * The outbox (Supabase shadow, owner-approved 7 Oct 2026): every document a command writes
 * is also described as an event in `outbox/{eventId}` — IN THE SAME COMMIT, so an event
 * exists if and only if the change it describes committed. The replicator (worker shadow
 * job) copies events to the Supabase shadow; Firestore stays the source of truth and the
 * client never writes either the outbox or Supabase.
 *
 * Only what the shadow models becomes an event; counters and photos do not.
 */
export const OUTBOX_ENTITIES = new Set(['stockMovements', 'stockLevels', 'purchaseOrders', 'purchaseRequests', 'transfers'])

export interface OutboxOptions {
  now: () => number
  /** A UUID per event: the idempotency key all the way to Supabase. */
  eventId: () => string
  /** G18: the workflow, the request and the business operation this commit belongs to. */
  trace?: { traceId: string; requestId: string; operationId?: string }
}

export interface OutboxEventDoc {
  eventId: string
  brand: 'pizza' | 'lelapin'
  eventType: string
  entityType: string
  entityId: string
  entityVersion: number | null
  occurredAt: number
  createdAt: number
  /** Order of events inside one commit (they share occurredAt). */
  seq: number
  schemaVersion: 1
  /** G18 correlation ids — present when the command arrived with (or was given) a trace. */
  traceId?: string
  requestId?: string
  operationId?: string
  /** The document as committed. */
  payload: Record<string, unknown>
  replicationStatus: 'pending'
  attemptCount: 0
}

/** A document after a buffered update: the read copy with the patch applied (null removes). */
function merged(before: Record<string, unknown> | null, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(before ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (k.includes('.')) {
      // A dotted path (readBy.uid) as Firestore applies it.
      const parts = k.split('.')
      let at = out
      for (const p of parts.slice(0, -1)) at = (at[p] = { ...((at[p] as Record<string, unknown>) ?? {}) }) as Record<string, unknown>
      at[parts[parts.length - 1]] = v
    } else out[k] = v
  }
  return out
}

/** The outbox writes for a commit's writes. Pure, for the tests. */
export function outboxWrites(
  brand: 'pizza' | 'lelapin',
  eventType: string,
  writes: readonly ServerWrite[],
  readDocs: ReadonlyMap<string, Record<string, unknown> | null>,
  opts: OutboxOptions,
): ServerWrite[] {
  const now = opts.now()
  const out: ServerWrite[] = []
  let seq = 0
  for (const w of writes) {
    if (w.op === 'verify') continue
    const entityType = baseOf(w.collection)
    if (!OUTBOX_ENTITIES.has(entityType)) continue
    const payload: Record<string, unknown> = w.op === 'set' ? { ...w.data, id: w.id } : { ...merged(readDocs.get(`${w.collection}/${w.id}`) ?? null, w.data), id: w.id }
    const version = typeof payload.updatedAt === 'number' ? payload.updatedAt : typeof payload.createdAt === 'number' ? payload.createdAt : null
    const eventId = opts.eventId()
    const doc: OutboxEventDoc = {
      eventId,
      brand,
      eventType,
      entityType,
      entityId: w.id,
      entityVersion: version,
      occurredAt: now,
      createdAt: now,
      seq: seq++,
      schemaVersion: 1,
      ...(opts.trace ? { traceId: opts.trace.traceId, requestId: opts.trace.requestId, ...(opts.trace.operationId ? { operationId: opts.trace.operationId } : {}) } : {}),
      payload,
      replicationStatus: 'pending',
      attemptCount: 0,
    }
    out.push({ op: 'set', collection: brandCollection(brand, 'outbox'), id: eventId, data: doc as unknown as Record<string, unknown>, precondition: { exists: false } })
  }
  return out
}

/**
 * G25: a versioned entity's write carries its next version, worked out from the copy this
 * transaction read. Race-safe: the commit's precondition is that copy's updateTime, so a
 * newer version landing in between makes the commit fail and the body run again. A
 * versioned update that was not read first is a programming error, not a silent skip.
 */
export function versioned(w: ServerWrite, read: Record<string, unknown> | null | undefined, wasRead: boolean): ServerWrite {
  if (w.op === 'verify' || !VERSIONED.has(baseOf(w.collection)) || 'version' in w.data) return w
  if (!wasRead) {
    if (w.op === 'set') return { ...w, data: { ...w.data, version: 1 } }
    throw new Error(`${w.collection}/${w.id}: a versioned update must read the document first`)
  }
  const current = typeof read?.version === 'number' ? read.version : 0
  return { ...w, data: { ...w.data, version: read ? current + 1 : 1 } }
}

export async function runServerTx<R>(
  store: ServerStore,
  brand: 'pizza' | 'lelapin',
  command: { name: string; writes: Readonly<Record<string, readonly string[]>> },
  body: (tx: TxContext) => Promise<R>,
  tries = 5,
  outbox?: OutboxOptions,
): Promise<R> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const reads = new Map<string, string | null>() // physical path → updateTime, or null when missing
    const readDocs = new Map<string, Record<string, unknown> | null>()
    const writes = new Map<string, ServerWrite>()
    const physical = (c: string) => brandCollection(brand, c)
    const path = (c: string, id: string) => `${physical(c)}/${id}`
    let writing = false

    const tx: TxContext = {
      async get<T>(collection: string, id: string): Promise<T | null> {
        if (writing) throw new Error('a transaction must read everything before it writes')
        const got = await store.get<T>(physical(collection), id)
        reads.set(path(collection, id), got ? got.updateTime : null)
        readDocs.set(path(collection, id), got ? (got.doc as Record<string, unknown>) : null)
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
      return { ...versioned(w, readDocs.get(p), seen !== undefined), precondition }
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
    // Checked above against the command's own list; the outbox is added after, by the server.
    const all: ServerWrite[] = outbox ? [...list, ...outboxWrites(brand, command.name, list, readDocs, outbox)] : list
    if (await store.commit(all)) return result
  }
  throw new TxConflict()
}

/** DELETE_FIELD becomes null (removal) in the server store's terms. */
function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) out[k] = v === DELETE_FIELD ? null : v
  return out
}
