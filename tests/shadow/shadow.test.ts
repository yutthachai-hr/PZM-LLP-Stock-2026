import { describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { backfill, type BackupLike } from '../../src/shadow/backfill'
import { checkParity } from '../../src/shadow/parity'
import { pgliteClient } from '../../src/shadow/pglite'
import { applyPending, ingest, type OutboxEvent } from '../../src/shadow/replicate'
import { asUser, freshDb } from './pg'

/** Supabase shadow foundation (7 Oct 2026): backfill, replication, parity, RLS — on real PostgreSQL. */

const T = 1_791_000_000_000
function stage(): BackupLike {
  return {
    brand: 'pizza',
    createdAt: T,
    data: {
      users: [
        { id: 'u-admin', name: 'Admin', role: 'admin', active: true, createdAt: T },
        { id: 'u-mgr', name: 'Manager', role: 'manager', active: true, createdAt: T },
        { id: 'u-staff', name: 'Staff', role: 'staff', active: true, siteIds: ['br1'], createdAt: T },
        { id: 'u-off', name: 'Gone', role: 'staff', active: false, createdAt: T },
      ],
      locations: [
        { id: 'wh', name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: T },
        { id: 'br1', name: 'สาขา 1', type: 'branch', active: true, createdAt: T },
      ],
      suppliers: [{ id: 's1', name: 'OLIVA', code: 'S001', type: 'takingReturn', active: true, createdAt: T, updatedAt: T }],
      products: [
        { id: 'flour', sku: 'F-1', name: 'FLOUR', unit: 'Kilogram', unitType: 'KG', minStock: 0, active: true, createdAt: T, updatedAt: T, unitConversions: [{ label: 'Bag', size: 25 }] },
        { id: 'cheese', sku: 'C-1', name: 'CHEESE', unit: 'Kilogram', unitType: 'KG', minStock: 0, active: true, createdAt: T, updatedAt: T },
      ],
      purchaseOrders: [
        {
          id: 'po1', docNo: 'PO-00001', supplierId: 's1', supplierName: 'OLIVA', status: 'received', locationId: 'wh', orderedAt: T, createdAt: T, updatedAt: T + 5,
          lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', entryUnit: 'Bag', orderedQty: 2, baseQty: 50, receivedQty: 2 }],
          receipts: [{ docNo: 'RC-00001', receiptId: 'rc_po1_op1', date: T, invoiceNo: 'INV1', byId: 'u-staff', byName: 'Staff', lines: [{ productId: 'flour', qty: 2 }] }],
        },
      ],
      stockMovements: [
        { id: 'rc_po1_op1_0', docNo: 'RC-00001', type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'KG', entryUnit: 'Bag', entryQty: 2, qty: 50, toLocationId: 'wh', poId: 'po1', invoiceNo: 'INV1', date: T, byUserId: 'u-staff', byUserName: 'Staff', createdAt: T },
        { id: 'm2', docNo: 'IS-00001', type: 'issue', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 10, fromLocationId: 'wh', toLocationId: 'br1', date: T + 1, byUserId: 'u-mgr', byUserName: 'Manager', createdAt: T + 1 },
        { id: 'm3', docNo: 'RC-00002', type: 'receive', productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', qty: 3, toLocationId: 'wh', date: T + 2, byUserId: 'u-staff', byUserName: 'Staff', createdAt: T + 2 },
        { id: 'm4', docNo: 'ADJ-00001', type: 'adjust', productId: 'cheese', productName: 'CHEESE', unit: 'KG', qty: 1, fromLocationId: 'wh', reason: 'damage', voided: true, date: T + 3, byUserId: 'u-staff', byUserName: 'Staff', createdAt: T + 3 },
      ],
      stockLevels: [
        { id: 'wh__flour', locationId: 'wh', productId: 'flour', qty: 40, updatedAt: T + 1, updatedBy: 'u-mgr' },
        { id: 'br1__flour', locationId: 'br1', productId: 'flour', qty: 10, updatedAt: T + 1, updatedBy: 'u-mgr' },
        { id: 'wh__cheese#Pack', locationId: 'wh', productId: 'cheese', unit: 'Pack', qty: 3, updatedAt: T + 2, updatedBy: 'u-staff' },
      ],
      transfers: [],
      purchaseRequests: [],
      supplierItems: [],
      productAliases: [],
    },
  }
}

async function loaded(): Promise<{ pg: PGlite; db: ReturnType<typeof pgliteClient>; backup: BackupLike }> {
  const pg = await freshDb()
  const db = pgliteClient(pg)
  const backup = stage()
  await backfill(db, backup, { runId: 'r1' })
  return { pg, db, backup }
}

describe('backfill', () => {
  test('loads a backup and parity passes, balances per product × location × unit included', async () => {
    const { pg, db, backup } = await loaded()
    const r = await checkParity(db, backup)
    expect(r.pass).toBe(true)
    const ledger = r.balances[0]
    expect(ledger.combinations).toBe(3) // wh flour 40, br1 flour 10, wh cheese#Pack 3 (the voided adjust counts for nothing)
    expect(ledger.mismatches).toEqual([])
    const receipt = (await db.query<{ po_id: string; receipt_id: string }>(`select po_id, receipt_id from shadow.receipts where doc_no = 'RC-00001'`)).rows[0]
    expect(receipt).toEqual({ po_id: 'po1', receipt_id: 'rc_po1_op1' })
    await pg.close()
  }, 60_000)

  test('a run that fails part-way resumes from its last committed chunk, and nothing doubles', async () => {
    const pg = await freshDb()
    const db = pgliteClient(pg)
    const backup = stage()
    await expect(backfill(db, backup, { runId: 'r2', chunk: 1, failAfter: 8 })).rejects.toThrow('simulated failure')
    const failed = (await db.query<{ entity: string; done: number }>(`select entity, done from shadow.migration_checkpoints where run_id = 'r2' and status = 'failed'`)).rows
    expect(failed).toHaveLength(1) // the entity it died in, with the chunks it had committed
    const finished = (await db.query(`select 1 from shadow.migration_checkpoints where run_id = 'r2' and status = 'done'`)).rows
    expect(finished.length).toBeGreaterThan(0)
    const res = await backfill(db, backup, { runId: 'r2', chunk: 1 })
    expect(res.entities.filter((e) => e.skipped).length).toBeGreaterThan(0)
    expect((await checkParity(db, backup)).pass).toBe(true)
    // Running it again — or another run over the same data — changes nothing.
    await backfill(db, backup, { runId: 'r3' })
    expect((await checkParity(db, backup)).pass).toBe(true)
    await pg.close()
  }, 60_000)

  test('a run id cannot be resumed against a different source', async () => {
    const { pg, db } = await loaded()
    await expect(backfill(db, { ...stage(), createdAt: T + 99 }, { runId: 'r1' })).rejects.toThrow(/new run id/)
    await pg.close()
  }, 60_000)

  test('parity reports a tampered row by id instead of passing', async () => {
    const { pg, db, backup } = await loaded()
    await pg.query(`update shadow.stock_movements set qty = 99, doc = jsonb_set(doc, '{qty}', '99') where id = 'm2'`)
    await pg.query(`delete from shadow.products where id = 'cheese'`).catch(() => {})
    const r = await checkParity(db, backup)
    expect(r.pass).toBe(false)
    expect(r.entities.find((e) => e.name === 'stock_movements')?.changed).toEqual(['m2'])
    expect(r.balances[0].mismatches.map((m) => m.key).sort()).toEqual(['br1__flour', 'wh__flour'])
    await pg.close()
  }, 60_000)
})

describe('replication (outbox consumer)', () => {
  const ev = (over: Partial<OutboxEvent>): OutboxEvent => ({
    eventId: crypto.randomUUID(),
    brand: 'pizza',
    eventType: 'movement.filed',
    entityType: 'stockMovements',
    entityId: 'm9',
    occurredAt: T + 10,
    payload: { id: 'm9', docNo: 'IS-00009', type: 'issue', productId: 'cheese', productName: 'CHEESE', unit: 'KG', qty: 2, fromLocationId: 'wh', toLocationId: 'br1', date: T + 10, byUserId: 'u-mgr', byUserName: 'Manager', createdAt: T + 10 },
    ...over,
  })

  test('the same event delivered twice is stored and applied once', async () => {
    const { pg, db } = await loaded()
    const e = ev({})
    expect(await ingest(db, [e, e])).toBe(1)
    expect(await ingest(db, [e])).toBe(0)
    expect(await applyPending(db)).toEqual({ applied: 1, stale: 0, failed: 0, dead: 0 })
    expect(await applyPending(db)).toEqual({ applied: 0, stale: 0, failed: 0, dead: 0 })
    expect((await db.query(`select 1 from shadow.stock_movements where id = 'm9'`)).rows).toHaveLength(1)
    await pg.close()
  }, 60_000)

  test('an older version arriving late is skipped, not applied over the newer one', async () => {
    const { pg, db } = await loaded()
    const newer = ev({ entityType: 'products', entityId: 'flour', payload: { ...stage().data.products[0], name: 'FLOUR NEW', updatedAt: T + 50 }, occurredAt: T + 50 })
    const older = ev({ entityType: 'products', entityId: 'flour', payload: { ...stage().data.products[0], name: 'FLOUR OLD', updatedAt: T + 20 }, occurredAt: T + 60 })
    await ingest(db, [newer, older])
    expect(await applyPending(db)).toEqual({ applied: 1, stale: 1, failed: 0, dead: 0 })
    expect((await db.query<{ name: string }>(`select name from shadow.products where id = 'flour'`)).rows[0].name).toBe('FLOUR NEW')
    await pg.close()
  }, 60_000)

  test('a deleted product is soft-deleted; a deleted draft order is removed', async () => {
    const { pg, db } = await loaded()
    await ingest(db, [ev({ entityType: 'products', entityId: 'cheese', payload: { deleted: true } }), ev({ entityType: 'purchaseOrders', entityId: 'po1', payload: { deleted: true } })])
    expect((await applyPending(db)).applied).toBe(2)
    expect((await db.query<{ active: boolean; gone: boolean }>(`select active, deleted_at is not null as gone from shadow.products where id = 'cheese'`)).rows[0]).toEqual({ active: false, gone: true })
    expect((await db.query(`select 1 from shadow.purchase_orders where id = 'po1'`)).rows).toHaveLength(0)
    await pg.close()
  }, 60_000)

  test('a failing event is retried, then dead-lettered and counted — never dropped', async () => {
    const { pg, db } = await loaded()
    const bad = ev({ entityType: 'stockMovements', entityId: 'bad', payload: { id: 'bad', docNo: 'X', type: 'issue', productId: 'flour', unit: 'KG', qty: -5, date: T } })
    await ingest(db, [bad])
    expect((await applyPending(db, { maxAttempts: 3 })).failed).toBe(1)
    expect((await applyPending(db, { maxAttempts: 3 })).failed).toBe(1)
    expect((await applyPending(db, { maxAttempts: 3 })).dead).toBe(1)
    const s = (await db.query<{ dead_letter: string; retries: string; failed: string }>(`select dead_letter, retries, failed from shadow.replication_status`)).rows[0]
    expect({ dead: Number(s.dead_letter), retries: Number(s.retries) }).toEqual({ dead: 1, retries: 2 })
    expect((await db.query<{ last_error: string }>(`select last_error from shadow.outbox_events where entity_id = 'bad'`)).rows[0].last_error).toMatch(/check/)
    await pg.close()
  }, 60_000)
})

describe('row-level security (Firebase identity)', () => {
  const count = async (pg: PGlite, sql: string) => Number(((await pg.query<{ n: number }>(sql)).rows[0] as { n: number }).n)

  test('active staff, manager and admin read operational data; staff with a site still sees every site (as Firestore today)', async () => {
    const { pg } = await loaded()
    for (const uid of ['u-staff', 'u-mgr', 'u-admin']) {
      await asUser(pg, uid, async () => {
        expect(await count(pg, `select count(*)::int as n from shadow.stock_movements`)).toBe(4)
        expect(await count(pg, `select count(*)::int as n from shadow.stock_balances where location_id = 'wh'`)).toBe(2)
      })
    }
    await pg.close()
  }, 60_000)

  test('inactive, unknown and anonymous callers read nothing', async () => {
    const { pg } = await loaded()
    for (const uid of ['u-off', 'nobody', null]) {
      await asUser(pg, uid, async () => {
        expect(await count(pg, `select count(*)::int as n from shadow.products`)).toBe(0)
      })
    }
    await pg.close()
  }, 60_000)

  test('a revoked account reads nothing even while marked active', async () => {
    const { pg } = await loaded()
    await pg.query(`update shadow.app_users set revoked_at = now() where uid = 'u-mgr'`)
    await asUser(pg, 'u-mgr', async () => expect(await count(pg, `select count(*)::int as n from shadow.products`)).toBe(0))
    await pg.close()
  }, 60_000)

  test('people: yourself only; an admin everyone. Audit and outbox: admins only', async () => {
    const { pg } = await loaded()
    await asUser(pg, 'u-staff', async () => {
      expect(await count(pg, `select count(*)::int as n from shadow.app_users`)).toBe(1)
      expect(await count(pg, `select count(*)::int as n from shadow.migration_checkpoints`)).toBe(0)
    })
    await asUser(pg, 'u-admin', async () => {
      expect(await count(pg, `select count(*)::int as n from shadow.app_users`)).toBe(4)
      expect(await count(pg, `select count(*)::int as n from shadow.migration_checkpoints`)).toBeGreaterThan(0)
    })
    await pg.close()
  }, 60_000)

  test('notifications reach only their recipients', async () => {
    const { pg } = await loaded()
    await pg.query(`insert into shadow.notifications (brand, id, kind, category, priority, created_at, updated_at, expires_at, doc)
      values ('pizza', 'lowStock__flour', 'lowStock', 'inventory', 'high', now(), now(), now() + interval '7 days', '{}')`)
    await pg.query(`insert into shadow.notification_recipients (brand, notification_id, user_id) values ('pizza', 'lowStock__flour', 'u-mgr')`)
    await asUser(pg, 'u-mgr', async () => expect(await count(pg, `select count(*)::int as n from shadow.notifications`)).toBe(1))
    await asUser(pg, 'u-staff', async () => expect(await count(pg, `select count(*)::int as n from shadow.notifications`)).toBe(0))
    await pg.close()
  }, 60_000)

  test('no signed-in role can write anything — not even an admin', async () => {
    const { pg } = await loaded()
    for (const sql of [
      `insert into shadow.stock_movements (brand, id, doc_no, type, product_id, unit, qty, to_location, occurred_ms, doc) values ('pizza','x','X','receive','flour','KG',1,'wh',0,'{}')`,
      `update shadow.stock_balances set qty = 999`,
      `delete from shadow.products`,
      `insert into shadow.outbox_events (event_id, brand, event_type, entity_type, entity_id, occurred_at, payload) values (gen_random_uuid(),'pizza','x','products','x',now(),'{}')`,
    ]) {
      await asUser(pg, 'u-admin', async () => {
        await expect(pg.query(sql)).rejects.toThrow(/permission denied/)
      })
    }
    await pg.close()
  }, 60_000)
})
