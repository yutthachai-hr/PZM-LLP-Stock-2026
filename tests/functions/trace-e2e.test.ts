// G18 exit gate: one receipt can be reconstructed end to end from its traceId alone — the
// app's call, the API command, the committed outbox events, and the Supabase shadow rows —
// and no log line carries business data.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { runStockCommand, type StockDeps } from '../../functions/_lib/stockCommands'
import { fromHeaders, isTraceId, newRequestId, newTraceId, traceHeaders, traceLine, type TraceContext } from '../../src/lib/trace'
import { ingest, type OutboxEvent } from '../../src/shadow/replicate'
import { freshDb } from '../shadow/pg'
import type { PurchaseOrder } from '../../src/types'

const NOW = Date.UTC(2026, 9, 7, 3)
const product = (id: string) => ({ sku: id, name: id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 })
const order = (): Omit<PurchaseOrder, 'id'> => ({
  docNo: 'PO-00001', supplierId: 'sup1', supplierName: 'SUP', status: 'ordered', locationId: 'wh', orderedAt: 1,
  lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 }],
  createdBy: 'mgr', createdByName: 'Manager', createdAt: 1, updatedAt: 1,
})
const world = () => ({
  users: { staff: { name: 'Staff A', role: 'staff', active: true } },
  products: { flour: product('flour') },
  locations: { wh: { name: 'Main', type: 'warehouse', active: true, createdAt: 1 } },
  purchaseOrders: { po1: order() },
  counters: { receive: { value: 7 } },
})
let n = 0
const deps = (): StockDeps & { store: ReturnType<typeof memoryServerStore> } => ({
  store: memoryServerStore(world()),
  now: () => NOW,
  makeId: () => `id${++n}`,
  eventId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  verifyUser: async (h) => (h?.startsWith('Bearer ') ? h.slice(7) : null),
})
const body = { brand: 'pizza', params: { orderId: 'po1', invoiceNo: 'IV-SECRET-1', operationId: 'op-trace-0001', date: NOW, lines: [{ productId: 'flour', receivedQty: 10, checked: true }] } }

const logs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  logs.length = 0
})

describe('G18: one receipt, followed by its traceId', () => {
  test('API log line, outbox events and shadow rows all carry the same ids; nothing else leaks', async () => {
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line))
    // The app: a workflow, and one request inside it (services/stock.ts callCommand).
    const traceId = newTraceId()
    const sent = traceHeaders({ traceId, requestId: newRequestId() })
    // The API: ids taken from the headers (functions/api/stock/[command].ts).
    const { inherited, ...trace } = fromHeaders((h) => sent[h] ?? null, body.params.operationId)
    expect(inherited).toBe(true)
    const d = deps()
    const reply = await runStockCommand(d, 'receivePO', 'Bearer staff', body, trace as TraceContext)
    expect(reply.status).toBe(200)

    // 1. The API's one structured line.
    const lines = logs.map((l) => JSON.parse(l)).filter((l) => l.kind === 'pzm.trace' && l.traceId === traceId)
    expect(lines).toEqual([expect.objectContaining({ stage: 'api.command', name: 'receivePO', outcome: 'ok', code: 200, requestId: trace.requestId, operationId: 'op-trace-0001', brand: 'pizza' })])
    for (const l of logs) {
      expect(l).not.toContain('IV-SECRET-1')
      expect(l).not.toContain('FLOUR')
      expect(l).not.toContain('Staff A')
    }

    // 2. Every outbox event of that commit.
    const events = [...d.store.data.entries()].filter(([k]) => k.startsWith('outbox/')).map(([, v]) => v.doc as unknown as OutboxEvent & { traceId?: string })
    expect(events.length).toBeGreaterThanOrEqual(3)
    for (const e of events) expect(e).toMatchObject({ traceId, requestId: trace.requestId, operationId: 'op-trace-0001' })
    expect(new Set(events.map((e) => e.entityType))).toEqual(new Set(['stockMovements', 'stockLevels', 'purchaseOrders']))

    // 3. The Supabase shadow rows they become.
    const db = await freshDb()
    await ingest(db, events.map((e) => ({ ...e, brand: 'pizza' })))
    const rows = await db.query<{ trace_id: string; request_id: string; operation_id: string; entity_type: string }>(
      `select trace_id, request_id, operation_id, entity_type from shadow.outbox_events where trace_id = $1 order by entity_type`,
      [traceId],
    )
    await db.close()
    expect(rows.rows).toHaveLength(events.length)
    for (const r of rows.rows) expect(r).toMatchObject({ trace_id: traceId, request_id: trace.requestId, operation_id: 'op-trace-0001' })
  }, 60_000)

  test('an untraced call (no headers) still gets fresh ids — never none, never echoed garbage', () => {
    const t = fromHeaders(() => 'x"; drop table')
    expect(t.inherited).toBe(false)
    expect(isTraceId(t.traceId)).toBe(true)
  })
})

describe('traceLine: ids, stages and counts only', () => {
  test('payload keys are dropped, malformed ids are dropped, strings are capped', () => {
    const line = JSON.parse(
      traceLine(
        // Everything a careless caller might pass along.
        { stage: 'api.command', outcome: 'ok', traceId: 'not-an-id', requestId: 'abc', name: 'x'.repeat(300), ...({ qty: 10, invoiceNo: 'IV1', productName: 'FLOUR' } as object) },
        1,
      ),
    )
    expect(line).toEqual({ kind: 'pzm.trace', at: 1, stage: 'api.command', outcome: 'ok', name: 'x'.repeat(80) })
  })
})
