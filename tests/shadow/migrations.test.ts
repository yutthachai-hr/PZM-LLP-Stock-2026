import { describe, expect, test } from 'vitest'
import { freshDb, migrationFiles } from './pg'

describe('supabase shadow migrations', () => {
  test('apply cleanly, in order, on a fresh database — twice gives the same schema', async () => {
    const schema = async () => {
      const db = await freshDb()
      const r = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'shadow' order by 1`)
      await db.close()
      return r.rows.map((x) => x.table_name)
    }
    const a = await schema()
    const b = await schema()
    expect(a).toEqual(b)
    expect(a).toEqual(expect.arrayContaining([
      'products', 'locations', 'suppliers', 'supplier_products', 'unit_conversions', 'purchase_requests', 'purchase_request_lines',
      'purchase_orders', 'purchase_order_lines', 'receipts', 'receipt_lines', 'stock_movements', 'stock_balances', 'transfers',
      'transfer_lines', 'notifications', 'notification_recipients', 'audit_log', 'product_aliases', 'supplier_metrics',
      'delivery_risks', 'inventory_risks', 'prediction_snapshots', 'outbox_events', 'migration_checkpoints', 'app_users',
      'stock_balance_from_ledger', 'replication_status',
    ]))
    expect(migrationFiles()[0]).toBe('0001_core.sql')
  }, 60_000)

  test('every table in the shadow schema has row-level security on', async () => {
    const db = await freshDb()
    const r = await db.query<{ relname: string }>(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'shadow' and c.relkind = 'r' and not c.relrowsecurity`)
    await db.close()
    expect(r.rows.map((x) => x.relname)).toEqual([])
  }, 60_000)
})
