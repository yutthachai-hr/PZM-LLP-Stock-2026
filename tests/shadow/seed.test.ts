// P1 cold-start seed pilot (8 Oct 2026): a device takes products / balances from the Supabase
// shadow instead of a full Firestore read, then follows Firestore from the shadow's proof.
// The SQL and RLS are real (PostgreSQL 17 in PGlite, migrations 0001–0008); the transport is
// the same interface the app's PostgREST client implements.
//
//   npm test
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, test, vi } from 'vitest'
import { backfill } from '../../src/shadow/backfill'
import { pgliteClient } from '../../src/shadow/pglite'
import { deltaStart, PARITY_MAX_AGE_MS, postgrestTransport, refuseReason, SEED_MAX_AGE_MS, seedConfig, seedFromShadow, seedMayReplaceFullRead, toDoc, type SeedEntity, type SeedStatus, type SeedTransport } from '../../src/data/shadowSeed'
import { recordWatermarks } from '../../worker/src/shadowSync'
import { asUser, freshDb } from './pg'

vi.mock('../../src/backend', async () => {
  const m = await import('../helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { mergeDelta } = await import('../../src/data/syncedCollection')

const T = Date.UTC(2026, 9, 8, 3)
const backup = (brand = 'pizza') => ({
  brand, createdAt: T,
  data: {
    users: [
      { id: 'u-admin', name: 'Admin', role: 'admin', active: true, createdAt: T },
      { id: 'u-staff', name: 'Staff', role: 'staff', active: true, siteIds: ['br1'], createdAt: T },
      { id: 'u-gone', name: 'Gone', role: 'staff', active: true, createdAt: T },
    ],
    locations: [{ id: 'wh', name: 'WH', type: 'warehouse', active: true, createdAt: T }, { id: 'br1', name: 'BR1', type: 'branch', active: true, createdAt: T }],
    suppliers: [],
    products: [
      { id: 'flour', sku: 'F', name: 'FLOUR', category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, active: true, createdAt: T, updatedAt: T - 5000 },
      { id: 'cheese', sku: 'C', name: 'CHEESE', category: 'Dairy', unit: 'Kilogram', unitType: 'KG', minStock: 0, active: true, createdAt: T, updatedAt: T - 4000 },
    ],
    stockLevels: [
      { id: 'wh__flour', locationId: 'wh', productId: 'flour', qty: 40, updatedAt: T - 3000 },
      { id: 'wh__cheese#Pack', locationId: 'wh', productId: 'cheese', unit: 'Pack', qty: 3, updatedAt: T - 2000 },
    ],
    stockMovements: [], purchaseOrders: [], purchaseRequests: [], transfers: [], productAliases: [], supplierItems: [],
  },
})

/** A shadow as the Worker leaves it: backfilled, watermarked, one parity run. */
async function shadow(opts: { parity?: boolean; parityAt?: number; unresolved?: boolean; watermarkAt?: number } = {}) {
  const pg = await freshDb()
  const db = pgliteClient(pg)
  await backfill(db, backup('pizza') as never, { runId: 'p' })
  await backfill(db, backup('lelapin') as never, { runId: 'l' })
  await pg.query(`update shadow.app_users set revoked_at = now() where uid = 'u-gone'`)
  await recordWatermarks(db, { at: { 'pizza:products': T, 'pizza:stockLevels': T, 'lelapin:products': T, 'lelapin:stockLevels': T } })
  if (opts.watermarkAt !== undefined) await pg.query(`update shadow.sync_watermarks set synced_at = to_timestamp($1 / 1000.0)`, [opts.watermarkAt])
  if (opts.unresolved) {
    await pg.query(`insert into shadow.outbox_events (event_id, brand, event_type, entity_type, entity_id, occurred_at, payload, replication_status) values (gen_random_uuid(), 'pizza', 'x', 'stockLevels', 'wh__flour', now(), '{}', 'dead')`)
    await recordWatermarks(db, { at: { 'pizza:stockLevels': T } })
  }
  if (opts.parity !== false) await pg.query(`insert into shadow.parity_runs (ran_at, source, passed, summary) values (to_timestamp($1 / 1000.0), 'test', true, '{}')`, [opts.parityAt ?? Date.now() - 60_000])
  return pg
}

/** What PostgREST would run for the app's two requests, as that person, in PGlite. */
function pgTransport(pg: PGlite, uid: string, project?: string): SeedTransport {
  return {
    status: (brand: string, entity: SeedEntity) => asUser(pg, uid, async () => ((await pg.query<{ s: SeedStatus | null }>(`select shadow.seed_status($1, $2) as s`, [brand, entity])).rows[0]?.s ?? null), project),
    rows: (brand: string, entity: SeedEntity) =>
      asUser(pg, uid, async () =>
        entity === 'products'
          ? (await pg.query<Record<string, unknown>>(`select id, doc from shadow.products where brand = $1 and deleted_at is null order by id`, [brand])).rows
          : (await pg.query<Record<string, unknown>>(`select location_id, product_id, unit_key, qty::float8 as qty, version from shadow.stock_balances where brand = $1 order by location_id, product_id, unit_key`, [brand])).rows,
      project),
  }
}

describe('seeding from the shadow (real RLS, migrations 0001–0008)', () => {
  test('an active person gets the brand exactly as Firestore holds it: documents, ids, units', async () => {
    const pg = await shadow()
    const r = await seedFromShadow<Record<string, unknown>>(pgTransport(pg, 'u-staff'), 'pizza', 'stockLevels', Date.now(), undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.docs.sort((a, b) => String(a.id).localeCompare(String(b.id)))).toEqual([
      { id: 'wh__cheese#Pack', locationId: 'wh', productId: 'cheese', unit: 'Pack', qty: 3, updatedAt: T - 2000 },
      { id: 'wh__flour', locationId: 'wh', productId: 'flour', qty: 40, updatedAt: T - 3000 },
    ])
    expect(r.completeThrough).toBe(T - 5 * 60_000)
    const p = await seedFromShadow<Record<string, unknown>>(pgTransport(pg, 'u-staff'), 'pizza', 'products', Date.now(), undefined)
    expect(p.ok && p.docs.map((d) => d.id).sort()).toEqual(['cheese', 'flour'])
    await pg.close()
  }, 60_000)

  test('multi-brand: a Pizza seed holds no Le Lapin row, though RLS lets the person read both', async () => {
    const pg = await shadow()
    await pg.query(`insert into shadow.stock_balances (brand, location_id, product_id, unit_key, qty, version) values ('lelapin', 'wh', 'butter', '', 9, 1)`)
    const r = await seedFromShadow<Record<string, unknown>>(pgTransport(pg, 'u-staff'), 'pizza', 'stockLevels', Date.now(), undefined)
    expect(r.ok && r.docs.some((d) => d.productId === 'butter')).toBe(false)
    await pg.close()
  }, 60_000)

  test('revoked, unknown or foreign-project callers get no proof, so the device reads Firestore instead', async () => {
    const pg = await shadow()
    for (const [uid, project] of [['u-gone', undefined], ['nobody', undefined], ['u-admin', 'someone-else']] as const) {
      const r = await seedFromShadow(pgTransport(pg, uid, project), 'pizza', 'products', Date.now(), undefined)
      expect(r, uid).toEqual({ ok: false, reason: 'no-status' })
    }
    await pg.close()
  }, 60_000)

  test('deleted documents: a soft-deleted product is not seeded, and the count it is checked against agrees', async () => {
    const pg = await shadow()
    await pg.query(`update shadow.products set deleted_at = now() where brand = 'pizza' and id = 'cheese'`)
    const r = await seedFromShadow<Record<string, unknown>>(pgTransport(pg, 'u-staff'), 'pizza', 'products', Date.now(), undefined)
    expect(r.ok && r.docs.map((d) => d.id)).toEqual(['flour'])
    await pg.close()
  }, 60_000)

  test('replication not proven: unresolved events, a stale proof, no recent parity — refused', async () => {
    const stuck = await shadow({ unresolved: true })
    expect(await seedFromShadow(pgTransport(stuck, 'u-staff'), 'pizza', 'stockLevels', Date.now(), undefined)).toEqual({ ok: false, reason: 'unresolved-events' })
    await stuck.close()
    const stale = await shadow({ watermarkAt: Date.now() - SEED_MAX_AGE_MS - 60_000 })
    expect(await seedFromShadow(pgTransport(stale, 'u-staff'), 'pizza', 'products', Date.now(), undefined)).toEqual({ ok: false, reason: 'stale-proof' })
    await stale.close()
    const noParity = await shadow({ parity: false })
    expect(await seedFromShadow(pgTransport(noParity, 'u-staff'), 'pizza', 'products', Date.now(), undefined)).toEqual({ ok: false, reason: 'no-recent-parity' })
    await noParity.close()
  }, 120_000)

  test('cache epoch: after an admin change (restore, void, delete) the seed waits for a parity run newer than it', async () => {
    const pg = await shadow({ parityAt: Date.now() - 10 * 60_000 })
    const epoch = Date.now() - 60_000 // bumped after the last parity run
    expect(await seedFromShadow(pgTransport(pg, 'u-staff'), 'pizza', 'products', Date.now(), epoch)).toEqual({ ok: false, reason: 'epoch-after-parity' })
    expect((await seedFromShadow(pgTransport(pg, 'u-staff'), 'pizza', 'products', Date.now(), Date.now() - 3_600_000)).ok).toBe(true)
    // And a copy dropped BECAUSE the epoch moved is never replaced by a seed at all.
    expect(seedMayReplaceFullRead({ fullAt: 1, epoch: 5 }, 6)).toBe(false)
    expect(seedMayReplaceFullRead({ fullAt: 1, epoch: 6 }, 6)).toBe(true) // merely a day old
    expect(seedMayReplaceFullRead(null, 6)).toBe(true) // a new device
    await pg.close()
  }, 60_000)
})

describe('watermark and delta: Firestore stays the authority after the proof', () => {
  test('the delta starts at the proof, not at the newest row the shadow happens to hold', () => {
    // The shadow holds a row stamped T+10 min but only PROVES completeness to T: a row stamped
    // T+5 min may still be on its way. Starting at the newest held row would skip it.
    expect(deltaStart(T + 600_000, T, 300_000)).toBe(T - 300_000)
    expect(deltaStart(T - 600_000, T, 300_000)).toBe(T - 900_000)
    expect(deltaStart(T + 600_000, null, 300_000)).toBe(T + 300_000) // no seed: as today
  })

  test('concurrent updates: what Firestore delivers after the proof replaces the seeded copy', () => {
    const held = new Map<string, { id: string; qty: number; updatedAt: number }>([
      ['wh__flour', { id: 'wh__flour', qty: 40, updatedAt: T - 3000 }],
      ['wh__oil', { id: 'wh__oil', qty: 2, updatedAt: T - 1000 }],
    ])
    // Two devices received flour after the proof; the shadow had not caught up.
    mergeDelta(held, new Set(), [{ id: 'wh__flour', qty: 52, updatedAt: T + 1000 }, { id: 'wh__salt', qty: 1, updatedAt: T + 2000 }])
    expect(held.get('wh__flour')?.qty).toBe(52)
    expect(held.get('wh__salt')?.qty).toBe(1)
    expect(held.get('wh__oil')?.qty).toBe(2)
  })
})

describe('failure and rollback', () => {
  test('connection failure or a slow shadow: refused quickly, the device reads Firestore', async () => {
    const down: SeedTransport = { status: () => Promise.reject(new TypeError('Failed to fetch')), rows: () => Promise.resolve([]) }
    expect(await seedFromShadow(down, 'pizza', 'products', Date.now(), undefined)).toEqual({ ok: false, reason: 'transport-error' })
    const slow: SeedTransport = { status: () => new Promise(() => {}), rows: () => Promise.resolve([]) }
    expect(await seedFromShadow(slow, 'pizza', 'products', Date.now(), undefined, 50)).toEqual({ ok: false, reason: 'timeout' })
  })

  test('rows that do not add up to what the shadow says it holds are refused, never half-used', async () => {
    const st: SeedStatus = { completeThrough: T, unresolved: 0, syncedAt: Date.now(), parityPassedAt: Date.now() - 1000, rows: 3 }
    const short: SeedTransport = { status: async () => st, rows: async () => [{ id: 'a', doc: { name: 'A' } }] }
    expect(await seedFromShadow(short, 'pizza', 'products', Date.now(), undefined)).toEqual({ ok: false, reason: 'row-count-mismatch' })
    expect(toDoc('stockLevels', { location_id: 'wh', product_id: 'x', unit_key: '', qty: 'NaN', version: 1 })).toBeNull()
  })

  test('off by default; on only with every setting and a listed brand; a browser switch turns it off', () => {
    expect(seedConfig({})).toBeNull()
    expect(seedConfig({ VITE_SHADOW_SEED: '1', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBeNull() // no brand
    expect(seedConfig({ VITE_SHADOW_SEED: '1', VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k', VITE_SHADOW_SEED_BRANDS: 'pizza' })).toBeNull() // not https
    expect(seedConfig({ VITE_SHADOW_SEED: '1', VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'k', VITE_SHADOW_SEED_BRANDS: 'pizza' })).toEqual({ url: 'https://x.supabase.co', key: 'k', brands: ['pizza'] })
  })

  test('the app transport: read-only requests, the person\'s token, the shadow schema, pages of 1,000', async () => {
    const calls: { url: string; method: string; auth: string; profile: string }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>
      calls.push({ url, method: String(init.method), auth: h.Authorization, profile: h['Accept-Profile'] })
      const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? 0)
      const body = url.includes('rpc/') ? { completeThrough: 1 } : Array.from({ length: offset === 0 ? 1000 : 3 }, (_, i) => ({ id: `p${offset + i}` }))
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    const t = postgrestTransport({ url: 'https://x.supabase.co', key: 'pub', brands: ['pizza'] }, async () => 'firebase-id-token', fake)
    await t.status('pizza', 'products')
    expect((await t.rows('pizza', 'products')).length).toBe(1003)
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'GET'])
    expect(calls.every((c) => c.auth === 'Bearer firebase-id-token' && c.profile === 'shadow')).toBe(true)
    expect(calls[1].url).toContain('products?brand=eq.pizza&deleted_at=is.null&select=id,doc&order=id&limit=1000&offset=0')
    expect(calls[2].url).toContain('offset=1000')
    expect(refuseReason(null, 0, undefined)).toBe('no-status')
    expect(PARITY_MAX_AGE_MS).toBe(86_400_000)
  })
})
