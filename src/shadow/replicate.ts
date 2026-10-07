import { mapDoc, type Brand, type Entity } from './mapping'
import { applyPlan, type SqlClient } from './writer'
import { supported } from '../lib/concurrency'

/**
 * The outbox consumer: Firestore commit → `outbox/{eventId}` (same transaction) → here.
 *
 * Run by the cron Worker with the service role. Two steps, both safe to repeat:
 *  1. `ingest` copies events into shadow.outbox_events keyed by event_id — an event seen
 *     twice is stored once;
 *  2. `applyPending` applies each pending event in its own transaction: the mapped rows
 *     with their version guard, then the event's status. A stale event (older than what is
 *     stored) is marked `skipped_stale`, not applied. A failing event is retried up to
 *     `maxAttempts`, then marked `dead` and left visible (replication_status.dead_letter) —
 *     never dropped.
 */

export interface OutboxEvent {
  eventId: string
  brand: Brand
  eventType: string
  entityType: Entity
  entityId: string
  entityVersion?: number
  occurredAt: number
  schemaVersion?: number
  /** The document as committed, or `{ deleted: true }`. */
  payload: Record<string, unknown>
}

export async function ingest(db: SqlClient, events: readonly OutboxEvent[]): Promise<number> {
  let added = 0
  for (const e of events) {
    const r = await db.query(
      `insert into shadow.outbox_events (event_id, brand, event_type, entity_type, entity_id, entity_version, occurred_at, schema_version, payload)
       values ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9::jsonb)
       on conflict (event_id) do nothing returning 1 as ok`,
      [e.eventId, e.brand, e.eventType, e.entityType, e.entityId, e.entityVersion ?? null, e.occurredAt, e.schemaVersion ?? 1, JSON.stringify(e.payload)],
    )
    added += r.rows.length
  }
  return added
}

/** Where a deleted document goes: master data is soft-deleted, the rest removed. */
const DELETE: Partial<Record<Entity, { table: string; soft: boolean }>> = {
  locations: { table: 'locations', soft: true },
  suppliers: { table: 'suppliers', soft: true },
  products: { table: 'products', soft: true },
  supplierItems: { table: 'supplier_products', soft: false },
  productAliases: { table: 'product_aliases', soft: false },
  purchaseOrders: { table: 'purchase_orders', soft: false },
  purchaseRequests: { table: 'purchase_requests', soft: false },
  transfers: { table: 'transfers', soft: false },
}

interface Row {
  event_id: string
  brand: Brand
  entity_type: Entity
  entity_id: string
  schema_version: number
  payload: Record<string, unknown> | string
  attempt_count: number
}

export interface ApplyReport {
  applied: number
  stale: number
  failed: number
  dead: number
}

export async function applyPending(db: SqlClient, opts: { limit?: number; maxAttempts?: number } = {}): Promise<ApplyReport> {
  const max = opts.maxAttempts ?? 5
  const report: ApplyReport = { applied: 0, stale: 0, failed: 0, dead: 0 }
  const pending = await db.query<Row>(
    `select event_id, brand, entity_type, entity_id, schema_version, payload, attempt_count from shadow.outbox_events
      where replication_status in ('pending', 'failed') order by occurred_at, event_id limit $1`,
    [opts.limit ?? 500],
  )
  for (const ev of pending.rows) {
    const payload = typeof ev.payload === 'string' ? (JSON.parse(ev.payload) as Record<string, unknown>) : ev.payload
    try {
      // G25: an event in a shape this consumer does not know is never applied — it fails,
      // then sits dead and visible for a consumer that does (never silently misread).
      if (!supported('OutboxEvent', { schemaVersion: Number(ev.schema_version) })) throw new Error(`unsupported outbox schema_version ${ev.schema_version}`)
      const status = await db.transaction(async (tx) => {
        let applied = true
        if (payload.deleted === true) {
          const d = DELETE[ev.entity_type]
          if (!d) throw new Error(`no delete rule for ${ev.entity_type}`)
          await tx.query(
            d.soft
              ? `update shadow.${d.table} set deleted_at = now(), active = false where brand = $1 and id = $2`
              : `delete from shadow.${d.table} where brand = $1 and id = $2`,
            [ev.brand, ev.entity_id],
          )
        } else {
          applied = (await applyPlan(tx, mapDoc(ev.entity_type, ev.brand, { ...payload, id: payload.id ?? ev.entity_id }))).applied
        }
        const s = applied ? 'applied' : 'skipped_stale'
        await tx.query(
          `update shadow.outbox_events set replication_status = $2, attempt_count = attempt_count + 1, applied_at = now(), last_error = null where event_id = $1`,
          [ev.event_id, s],
        )
        return s
      })
      if (status === 'applied') report.applied++
      else report.stale++
    } catch (e) {
      const dead = ev.attempt_count + 1 >= max
      await db.query(
        `update shadow.outbox_events set replication_status = $2, attempt_count = attempt_count + 1, last_error = $3 where event_id = $1`,
        [ev.event_id, dead ? 'dead' : 'failed', String(e).slice(0, 500)],
      )
      if (dead) report.dead++
      else report.failed++
    }
  }
  return report
}
