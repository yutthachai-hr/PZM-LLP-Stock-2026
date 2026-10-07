import type { Entity } from '../../src/shadow/mapping'
import { applyPending, ingest, type OutboxEvent } from '../../src/shadow/replicate'
import type { SqlClient } from '../../src/shadow/writer'
import type { Store } from './store'

/**
 * The Supabase shadow replicator (7 Oct 2026). Firestore is the source of truth; this copies
 * what committed into the shadow PostgreSQL, idempotently, on its own cron run.
 *
 * Two feeds, one consumer:
 *  - the OUTBOX — events the server's stock commands wrote in the same commit as the change
 *    (functions/_lib/serverTx.ts). Exact and ordered; carries the command's name;
 *  - a CHANGE SCAN of what clients still write themselves (catalogue, suppliers, orders,
 *    requests, transfers, people): documents whose `updatedAt` moved since the last run.
 *    Each becomes an event with a deterministic id, so the same version scanned twice is
 *    stored once.
 * Both go through `ingest` (dedup on event_id) and `applyPending` (version guard, retries,
 * dead letter) — src/shadow/replicate.ts.
 *
 * Cost: about one Firestore query per collection per brand per run plus the documents that
 * changed; a free-plan invocation may make 50 outgoing requests, which is why this has a
 * cron of its own. Nothing here writes Firestore except `meta/shadowCursor`,
 * `meta/shadowStatus` and deleting outbox events already replicated a week ago.
 */

export const SHADOW_BRANDS = [
  { brand: 'pizza', prefix: '' },
  { brand: 'lelapin', prefix: 'lelapin__' },
] as const

/** Client-written collections the scan covers, as shadow entities. The stock ledger and
 * balances come through the outbox; they are scanned too, as a net for admin corrections. */
export const SCANNED: readonly Entity[] = ['locations', 'suppliers', 'products', 'supplierItems', 'productAliases', 'purchaseRequests', 'purchaseOrders', 'transfers', 'stockMovements', 'stockLevels']

const OUTBOX_PAGE = 300
const SCAN_PAGE = 300
/** Re-read this far behind each cursor: writers' clocks disagree a little; repeats are free. */
const SKEW_MS = 5 * 60_000
const PURGE_AFTER_MS = 7 * 86_400_000

export interface ShadowCursor {
  /** `<brand>:outbox` and `<brand>:<entity>` → epoch ms already taken. */
  at: Record<string, number>
}

export interface ShadowReport {
  ingested: number
  applied: number
  stale: number
  failed: number
  dead: number
  purged: number
  read: number
}

/** A UUID-shaped id from a stable key (SHA-256), so a scanned version always maps to one event. */
export async function stableEventId(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
  const hex = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

type Doc = Record<string, unknown> & { id: string }

const stampOf = (d: Record<string, unknown>): number => (typeof d.updatedAt === 'number' ? d.updatedAt : typeof d.createdAt === 'number' ? d.createdAt : 0)

export async function shadowSync(store: Store, sql: SqlClient, now: number): Promise<ShadowReport> {
  const report: ShadowReport = { ingested: 0, applied: 0, stale: 0, failed: 0, dead: 0, purged: 0, read: 0 }
  const cursor: ShadowCursor = (await store.get<ShadowCursor>('meta', 'shadowCursor')) ?? { at: {} }
  cursor.at ??= {}
  const purge: { collection: string; id: string }[] = []

  for (const { brand, prefix } of SHADOW_BRANDS) {
    // 1. The outbox.
    const okey = `${brand}:outbox`
    const since = cursor.at[okey] ?? 0
    const outbox = await store.query<Doc & OutboxEvent>(`${prefix}outbox`, [{ field: 'createdAt', op: '>=', value: since }], { limit: OUTBOX_PAGE, orderBy: 'createdAt' })
    report.read += outbox.length
    const events: OutboxEvent[] = outbox
      .filter((e) => typeof e.eventId === 'string' && e.payload && typeof e.entityType === 'string')
      .map((e) => ({
        eventId: e.eventId,
        brand,
        // A malformed event is still taken (and shows up if it cannot apply), never fatal to the run.
        eventType: typeof e.eventType === 'string' ? e.eventType : 'unknown',
        entityType: e.entityType as Entity,
        entityId: e.entityId,
        entityVersion: e.entityVersion ?? undefined,
        occurredAt: Number(e.occurredAt ?? (e as { createdAt?: number }).createdAt ?? now),
        schemaVersion: e.schemaVersion ?? 1,
        payload: e.payload,
        // G18: the command's trace, carried to the shadow row.
        ...(e.traceId ? { traceId: e.traceId } : {}),
        ...(e.requestId ? { requestId: e.requestId } : {}),
        ...(e.operationId ? { operationId: e.operationId } : {}),
      }))
    report.ingested += await ingest(sql, events)
    const newest = Math.max(since, ...outbox.map((e) => Number((e as { createdAt?: number }).createdAt ?? 0)))
    // A full page may have more behind it at the same instant: keep the cursor, the repeat is free.
    cursor.at[okey] = outbox.length >= OUTBOX_PAGE ? since : newest

    // 2. The change scan.
    for (const entity of SCANNED) {
      const key = `${brand}:${entity}`
      const from = Math.max(0, (cursor.at[key] ?? 0) - SKEW_MS)
      const docs = await store.query<Doc>(`${prefix}${entity}`, [{ field: 'updatedAt', op: '>=', value: from }], { limit: SCAN_PAGE, orderBy: 'updatedAt' })
      report.read += docs.length
      const scanned: OutboxEvent[] = []
      for (const d of docs) {
        const v = stampOf(d)
        scanned.push({
          eventId: await stableEventId(`${brand}|${entity}|${d.id}|${v}`),
          brand,
          eventType: 'scan',
          entityType: entity,
          entityId: d.id,
          entityVersion: v,
          occurredAt: v || now,
          payload: d,
        })
      }
      report.ingested += await ingest(sql, scanned)
      if (docs.length < SCAN_PAGE) cursor.at[key] = Math.max(cursor.at[key] ?? 0, ...docs.map(stampOf))
      else cursor.at[key] = Math.max(cursor.at[key] ?? 0, stampOf(docs[docs.length - 1]) - 1)
    }

    // 3. Outbox events a week behind the cursor were replicated long ago.
    const old = await store.query<Doc>(`${prefix}outbox`, [{ field: 'createdAt', op: '<', value: Math.min(cursor.at[okey] ?? 0, now - PURGE_AFTER_MS) }], { limit: 100 })
    for (const e of old) purge.push({ collection: `${prefix}outbox`, id: e.id })
  }

  // People are shared by both brands, few, and carry no updatedAt (a role change would not
  // show in a "changed since" scan) — so all of them, every run; the event id includes role
  // and active, so an unchanged person is stored once.
  const users = await store.query<Doc>('users', [], { limit: SCAN_PAGE })
  report.read += users.length
  const people: OutboxEvent[] = []
  for (const u of users) {
    const { localPassword: _drop, ...safe } = u as Doc & { localPassword?: string }
    void _drop
    people.push({ eventId: await stableEventId(`users|${u.id}|${String(u.role)}|${String(u.active)}|${JSON.stringify(u.siteIds ?? [])}`), brand: 'pizza', eventType: 'scan', entityType: 'users', entityId: u.id, occurredAt: stampOf(u) || now, payload: safe })
  }
  report.ingested += await ingest(sql, people)

  // 4. Apply everything pending (this run's and any earlier failure's).
  const r = await applyPending(sql, { limit: 2000 })
  report.applied = r.applied
  report.stale = r.stale
  report.failed = r.failed
  report.dead = r.dead

  // 5. Remember where we are; forget what is long replicated.
  await store.write([
    { type: 'set', collection: 'meta', id: 'shadowCursor', doc: cursor as unknown as Record<string, unknown> },
    ...purge.map((p) => ({ type: 'delete' as const, collection: p.collection, id: p.id })),
  ])
  report.purged = purge.length
  return report
}
