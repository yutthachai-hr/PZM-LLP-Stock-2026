import { describe, expect, test } from 'vitest'
import { shadowSync, stableEventId } from '../../worker/src/shadowSync'
import { pgliteClient } from '../../src/shadow/pglite'
import { freshDb } from '../shadow/pg'
import { fakeStore } from './fakeStore'

/** The Supabase shadow replicator (7 Oct 2026): outbox + change scan → PostgreSQL, idempotently. */

const T = 1_791_300_000_000
async function world() {
  const f = fakeStore()
  const store = f.store
  const put = (c: string, id: string, d: Record<string, unknown>) => f.seed(c, [{ ...d, id }])
  const data = { get: (c: string) => ({ get: (id: string) => f.doc(c, id), has: (id: string) => !!f.doc(c, id) }) }
  put('users', 'u1', { name: 'Staff', role: 'staff', active: true, createdAt: T })
  put('locations', 'wh', { name: 'Main', type: 'warehouse', active: true, createdAt: T, updatedAt: T })
  put('products', 'flour', { sku: 'F', name: 'FLOUR', unitType: 'KG', unit: 'Kilogram', minStock: 0, active: true, createdAt: T, updatedAt: T })
  put('lelapin__products', 'bread', { sku: 'B', name: 'BREAD', unitType: 'EA', unit: 'Each', minStock: 0, active: true, createdAt: T, updatedAt: T })
  // An event a stock command wrote in its own commit.
  put('outbox', 'e-1', {
    eventId: '11111111-1111-4111-8111-111111111111', brand: 'pizza', eventType: 'adjust', entityType: 'stockMovements', entityId: 'm1',
    entityVersion: T + 5, occurredAt: T + 5, createdAt: T + 5, seq: 0, schemaVersion: 1, replicationStatus: 'pending', attemptCount: 0,
    payload: { id: 'm1', docNo: 'ADJ-1', type: 'adjust', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 2, toLocationId: 'wh', reason: 'found', date: T, byUserId: 'u1', byUserName: 'Staff', createdAt: T + 5 },
  })
  return { store, data, put }
}

describe('shadow replicator', () => {
  test('copies the outbox and the scanned collections of both brands, and the people', async () => {
    const { store, data } = await world()
    const pg = await freshDb()
    const sql = pgliteClient(pg)
    const r = await shadowSync(store, sql, T + 60_000)
    expect(r.failed + r.dead).toBe(0)
    expect(r.applied).toBe(r.ingested)
    const count = async (q: string) => Number(((await pg.query<{ n: number }>(q)).rows[0] as { n: number }).n)
    expect(await count(`select count(*)::int as n from shadow.stock_movements where id = 'm1'`)).toBe(1)
    expect(await count(`select count(*)::int as n from shadow.products where brand = 'pizza' and id = 'flour'`)).toBe(1)
    expect(await count(`select count(*)::int as n from shadow.products where brand = 'lelapin' and id = 'bread'`)).toBe(1)
    expect(await count(`select count(*)::int as n from shadow.app_users where uid = 'u1'`)).toBe(1)
    expect(data.get('meta')?.get('shadowCursor')).toBeTruthy()
    await pg.close()
  }, 60_000)

  test('a second run with nothing new stores nothing new; a change arrives as one event', async () => {
    const { store, put } = await world()
    const pg = await freshDb()
    const sql = pgliteClient(pg)
    await shadowSync(store, sql, T + 60_000)
    const again = await shadowSync(store, sql, T + 120_000)
    expect(again.ingested).toBe(0)
    put('products', 'flour', { sku: 'F', name: 'FLOUR NEW', unitType: 'KG', unit: 'Kilogram', minStock: 0, active: true, createdAt: T, updatedAt: T + 100_000 })
    const changed = await shadowSync(store, sql, T + 180_000)
    expect(changed.ingested).toBe(1)
    expect((await pg.query<{ name: string }>(`select name from shadow.products where id = 'flour'`)).rows[0].name).toBe('FLOUR NEW')
    await pg.close()
  }, 60_000)

  test('a person whose role changes is replicated even though people carry no updatedAt', async () => {
    const { store, put } = await world()
    const pg = await freshDb()
    const sql = pgliteClient(pg)
    await shadowSync(store, sql, T + 60_000)
    put('users', 'u1', { name: 'Staff', role: 'manager', active: true, createdAt: T })
    await shadowSync(store, sql, T + 120_000)
    expect((await pg.query<{ role: string }>(`select role from shadow.app_users where uid = 'u1'`)).rows[0].role).toBe('manager')
    await pg.close()
  }, 60_000)

  test('outbox events a week behind are deleted from Firestore; recent ones stay', async () => {
    const { store, data, put } = await world()
    put('outbox', 'e-old', { eventId: '22222222-2222-4222-8222-222222222222', entityType: 'stockMovements', entityId: 'x', createdAt: T - 8 * 86_400_000, payload: { id: 'x', docNo: 'X', type: 'adjust', productId: 'flour', unit: 'KG', qty: 1, toLocationId: 'wh', date: T - 8 * 86_400_000, createdAt: T - 8 * 86_400_000 } })
    const pg = await freshDb()
    const sql = pgliteClient(pg)
    // Taken into the shadow first, then deleted in the same run: never deleted unreplicated.
    const r = await shadowSync(store, sql, T + 60_000)
    expect(r.purged).toBe(1)
    expect(Number(((await pg.query<{ n: number }>(`select count(*)::int as n from shadow.outbox_events where entity_id = 'x'`)).rows[0] as { n: number }).n)).toBe(1)
    expect(data.get('outbox')?.has('e-old')).toBe(false)
    expect(data.get('outbox')?.has('e-1')).toBe(true)
    await pg.close()
  }, 60_000)

  test('scanned event ids are stable per version, different across versions', async () => {
    expect(await stableEventId('pizza|products|flour|1')).toBe(await stableEventId('pizza|products|flour|1'))
    expect(await stableEventId('pizza|products|flour|1')).not.toBe(await stableEventId('pizza|products|flour|2'))
    expect(await stableEventId('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
