// The outbox (Supabase shadow, 7 Oct 2026): every stock command writes its events in the
// same commit as the change, and those events replay into the shadow PostgreSQL to the
// same numbers Firestore holds.
import { describe, expect, test, vi } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { outboxWrites } from '../../functions/_lib/serverTx'
import { runStockCommand, type StockDeps } from '../../functions/_lib/stockCommands'
import { applyPending, ingest, type OutboxEvent } from '../../src/shadow/replicate'
import { pgliteClient } from '../../src/shadow/pglite'
import { freshDb } from '../shadow/pg'

vi.mock('../../src/backend', async () => {
  const m = await import('../helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const NOW = Date.UTC(2026, 9, 7, 3)
const product = (id: string, over: Record<string, unknown> = {}) => ({ sku: id, name: id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over })
const world = () => ({
  users: { staff: { name: 'Staff A', role: 'staff', active: true } },
  products: { flour: product('flour'), cheese: product('cheese', { unitConversions: [{ label: 'Pack', size: 2.5 }] }) },
  locations: { wh: { name: 'Main', type: 'warehouse', active: true, createdAt: 1 } },
  purchaseOrders: {
    po1: {
      docNo: 'PO-00001', supplierId: 'sup1', supplierName: 'SUP', status: 'ordered', locationId: 'wh', orderedAt: 1,
      lines: [
        { productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 },
        { productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', orderedQty: 4, baseQty: 10 },
      ],
      createdBy: 'mgr', createdByName: 'Manager', createdAt: 1, updatedAt: 1,
    },
  },
  stockLevels: { wh__flour: { productId: 'flour', locationId: 'wh', qty: 3, updatedAt: 1, updatedBy: 'x' } },
  counters: { receive: { value: 7 } },
})

let n = 0
function deps(withOutbox = true): StockDeps & { store: ReturnType<typeof memoryServerStore> } {
  return {
    store: memoryServerStore(world()),
    now: () => NOW,
    makeId: () => `id${++n}`,
    ...(withOutbox ? { eventId: () => crypto.randomUUID() } : {}),
    verifyUser: async (h) => (h?.startsWith('Bearer ') ? h.slice(7) : null),
  }
}
const body = (brand = 'pizza') => ({
  brand,
  params: { orderId: 'po1', invoiceNo: 'IV-1', operationId: 'op-outbox-1', date: NOW, lines: [{ productId: 'flour', receivedQty: 0, checked: true }, { productId: 'cheese', receivedQty: 0, checked: true }] },
})
const events = (d: ReturnType<typeof deps>, col = 'outbox') =>
  [...d.store.data.entries()].filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v.doc as unknown as OutboxEvent & { seq: number; replicationStatus: string; attemptCount: number })

describe('outbox events are written in the same commit as the change', () => {
  test('a receipt describes every row, balance and the order — not counters', async () => {
    const d = deps()
    expect((await runStockCommand(d, 'receivePO', 'Bearer staff', body())).status).toBe(200)
    const ev = events(d)
    const kinds = ev.map((e) => e.entityType).sort()
    expect(kinds).toEqual(['purchaseOrders', 'stockLevels', 'stockLevels', 'stockMovements', 'stockMovements'])
    for (const e of ev) {
      expect(e.eventId).toMatch(/^[0-9a-f-]{36}$/)
      expect(e).toMatchObject({ brand: 'pizza', eventType: 'receivePO', occurredAt: NOW, schemaVersion: 1, replicationStatus: 'pending', attemptCount: 0 })
      // The payload is the document exactly as committed.
      const stored = d.store.data.get(`${e.entityType}/${e.entityId}`)?.doc as Record<string, unknown>
      expect({ ...e.payload, id: undefined }).toEqual({ ...stored, id: undefined })
    }
    const po = ev.find((e) => e.entityType === 'purchaseOrders')!
    expect(po.payload).toMatchObject({ status: 'received', docNo: 'PO-00001' }) // merged: the read order + the patch
    expect(po.entityVersion).toBe(po.payload.updatedAt)
    expect(new Set(ev.map((e) => e.seq)).size).toBe(ev.length)
  })

  test('a refused command and a replayed one write no events', async () => {
    const d = deps()
    await runStockCommand(d, 'receivePO', 'Bearer staff', body())
    const before = events(d).length
    expect((await runStockCommand(d, 'receivePO', 'Bearer staff', body())).status).toBe(200) // replay
    expect(events(d)).toHaveLength(before)
    const other = { ...body(), params: { ...body().params, operationId: 'op-outbox-2' } }
    expect((await runStockCommand(d, 'receivePO', 'Bearer staff', other)).status).toBe(422) // already received
    expect(events(d)).toHaveLength(before)
  })

  test("Le Lapin's events go to Le Lapin's outbox", () => {
    const w = outboxWrites('lelapin', 'adjust', [{ op: 'set', collection: 'lelapin__stockMovements', id: 'm1', data: { qty: 1, createdAt: 5 } }], new Map(), { now: () => 9, eventId: () => 'e1' })
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ collection: 'lelapin__outbox', id: 'e1', precondition: { exists: false } })
    expect((w[0].data as { entityType: string; entityVersion: number }).entityType).toBe('stockMovements')
    expect((w[0].data as { entityVersion: number }).entityVersion).toBe(5)
  })

  test('without the option nothing extra is written (unchanged behaviour)', async () => {
    const d = deps(false)
    await runStockCommand(d, 'receivePO', 'Bearer staff', body())
    expect(events(d)).toHaveLength(0)
  })
})

describe('outbox → Supabase shadow', () => {
  test('events replay into PostgreSQL to the numbers Firestore holds, and replaying again changes nothing', async () => {
    const d = deps()
    await runStockCommand(d, 'receivePO', 'Bearer staff', body())
    const pg = await freshDb()
    const db = pgliteClient(pg)
    // The shadow already holds the order as it was before (a backfill), then the events arrive.
    await ingest(db, [{ eventId: crypto.randomUUID(), brand: 'pizza', eventType: 'backfill', entityType: 'purchaseOrders', entityId: 'po1', occurredAt: 1, payload: { ...world().purchaseOrders.po1, id: 'po1' } }])
    await applyPending(db)
    const ev = events(d).sort((a, b) => a.seq - b.seq)
    expect(await ingest(db, ev)).toBe(ev.length)
    expect(await ingest(db, ev)).toBe(0) // delivered twice, stored once
    expect(await applyPending(db)).toEqual({ applied: ev.length, stale: 0, failed: 0, dead: 0 })

    const bal = (await db.query<{ product_id: string; qty: string }>(`select product_id, qty from shadow.stock_balances order by 1`)).rows
    expect(bal.map((r) => [r.product_id, Number(r.qty)])).toEqual([['cheese', 10], ['flour', 13]])
    const po = (await db.query<{ status: string }>(`select status from shadow.purchase_orders where id = 'po1'`)).rows[0]
    expect(po.status).toBe('received')
    const lines = (await db.query<{ received_qty: string }>(`select received_qty from shadow.purchase_order_lines where po_id = 'po1' order by line_no`)).rows
    expect(lines.map((l) => Number(l.received_qty))).toEqual([10, 4])
    const receipt = (await db.query<{ po_id: string; receipt_id: string }>(`select po_id, receipt_id from shadow.receipts`)).rows[0]
    expect(receipt).toEqual({ po_id: 'po1', receipt_id: 'rc_po1_op-outbox-1' })
    // The ledger in SQL adds up to the balances the command wrote (the base was 3 before any row: not in the ledger).
    const ledger = (await db.query<{ product_id: string; qty: string }>(`select product_id, qty from shadow.stock_balance_from_ledger order by 1`)).rows
    expect(ledger.map((r) => [r.product_id, Number(r.qty)])).toEqual([['cheese', 10], ['flour', 10]])
    await pg.close()
  }, 60_000)
})
