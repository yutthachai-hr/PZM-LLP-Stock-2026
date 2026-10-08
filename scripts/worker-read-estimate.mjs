#!/usr/bin/env node
// Owner gate B (8 Oct 2026): what the cron Worker would read from Firestore if it were deployed
// and its triggers fired — measured, not guessed, before anyone redeploys it.
//
//   node scripts/worker-read-estimate.mjs
//
// Runs worker/src/jobs.ts against an in-memory store holding a production-sized brand (the
// e2e "big brand" shape: 460 products, 1,400 balances, 45 days × 60 movements, 120 orders,
// a week of notifications) and counts billed reads the way Firestore bills them: one per
// document returned, and one for a query that returns nothing. No network, no Firestore.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { fakeStore } = await vite.ssrLoadModule('/tests/worker/fakeStore.ts')
  const { runForBrand, CRONS } = await vite.ssrLoadModule('/worker/src/jobs.ts')
  const DAY = 86_400_000
  const now = Date.now()
  const base = fakeStore()
  const put = (c, id, doc) => base.seed(c, [{ ...doc, id }])
  const sites = ['wh', 'b1', 'b2']
  for (const s of sites) await put('locations', s, { name: s, type: s === 'wh' ? 'warehouse' : 'branch', active: true, createdAt: now })
  for (let i = 0; i < 30; i++) await put('suppliers', `s${i}`, { name: `S${i}`, active: true, leadTimeDays: 2, createdAt: now, updatedAt: now })
  for (let i = 0; i < 460; i++) await put('products', `p${i}`, { sku: `K${i}`, name: `P${i}`, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 5, active: true, supplierId: `s${i % 30}`, createdAt: now - 60 * DAY, updatedAt: now - (i % 30) * DAY })
  for (let i = 0, n = 0; n < 1400; i++, n++) { const loc = sites[i % 3]; const p = `p${Math.floor(i / 3) % 460}`; await put('stockLevels', `${loc}__${p}`, { productId: p, locationId: loc, qty: 10 + (i % 40), updatedAt: now - (i % 30) * DAY }) }
  for (let d = 0; d < 45; d++) for (let k = 0; k < 60; k++) { const at = now - d * DAY - k * 720_000; const p = `p${(d * 7 + k) % 460}`; await put('stockMovements', `m${d}_${k}`, { type: k % 5 ? 'consume' : 'receive', productId: p, unit: 'KG', qty: 1 + (k % 4), ...(k % 5 ? { fromLocationId: sites[k % 3] } : { toLocationId: 'wh' }), date: at, createdAt: at }) }
  for (let i = 0; i < 120; i++) { const at = now - i * DAY; await put('purchaseOrders', `po${i}`, { docNo: `PO${i}`, supplierId: `s${i % 30}`, status: i > 5 ? 'received' : 'ordered', locationId: 'wh', orderedAt: at, expectedAt: at + 2 * DAY, lines: [{ productId: `p${i}`, orderedQty: 10 }], createdAt: at, updatedAt: at }) }
  for (let i = 0; i < 280; i++) { const at = now - Math.floor(i / 40) * DAY; await put('notifications', `n${i}`, { kind: 'poArriving', category: 'purchasing', priority: 'info', to: { all: true }, params: {}, link: '/', active: true, readBy: {}, source: 'worker', createdBy: 'worker', createdAt: at, updatedAt: at, expiresAt: at + 30 * DAY }) }

  // Billed reads: wrap the store; every document returned is a read, an empty query is one.
  let reads = 0
  const counted = {
    ...base.store,
    async query(c, f, o) { const r = await base.store.query(c, f, o); reads += Math.max(1, r.length); return r },
    async get(c, id) { const r = await base.store.get(c, id); reads += 1; return r },
  }
  const kinds = [...new Set(Object.values(CRONS))]
  const perDay = { frequent: 48, morning: 1, generate: 1, weekly: 1 / 7 }
  const rows = []
  for (const kind of kinds) {
    // First run (cold: writes what is due), then a second run (steady state: nothing new).
    reads = 0; await runForBrand(counted, kind, '', now); const first = reads
    reads = 0; await runForBrand(counted, kind, '', now + 60_000); const steady = reads
    // An empty brand (Le Lapin small, R&D new) costs about one read per query it makes.
    reads = 0; await runForBrand(counted, kind, 'rnd__', now); const empty = reads
    rows.push({ kind, runsPerDay: perDay[kind] ?? 0, firstRun: first, steadyRun: steady, emptyBrandRun: empty })
  }
  const daily = (k) => rows.reduce((s, r) => s + r.runsPerDay * r[k], 0)
  console.table(rows)
  console.log(JSON.stringify({ productionSizedBrandPerDay: Math.round(daily('steadyRun')), emptyBrandPerDay: Math.round(daily('emptyBrandRun')), threeBrandsUpperBoundPerDay: Math.round(3 * daily('steadyRun')) }))
} finally {
  await vite.close()
}
