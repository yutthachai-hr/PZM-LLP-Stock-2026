// Release gate: what the cron Worker reads in a day, on a brand the size of the read
// benchmark's (e2e/bigFixture.ts). Firestore bills a query by the documents it returns,
// one for an empty result. The app's own budget is tests/read-budget.test.ts; this is the
// part the app cannot cache.
//
//   npm test

import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import { runJob } from '../../worker/src/jobs'
import type { Store } from '../../worker/src/store'
import { fakeStore } from './fakeStore'

const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 8, 18, 3)), '07:00')

function seedBrand(db: ReturnType<typeof fakeStore>, prefix: string, scale: number) {
  const n = (x: number) => Math.round(x * scale)
  const c = (name: string) => prefix + name
  db.seed(c('locations'), [{ id: 'wh', name: 'WH', active: true }, { id: 'b1', name: 'B1', active: true }, { id: 'b2', name: 'B2', active: true }])
  db.seed(c('inventorySchedules'), [{ id: 'settings', usageWindowDays: 30, coverDays: 7 }, { id: 'sc1', kind: 'stockCount', name: 'n', locationId: 'wh', frequency: 'weekly', weekday: 1, startTime: '09:00', priority: 'normal', enabled: true, createdBy: 'a', createdAt: 1, updatedAt: 1 }])
  const products = Array.from({ length: n(460) }, (_, i) => ({ id: `p${i}`, sku: `S${i}`, name: `P${i}`, unit: 'Kilogram', minStock: 5, active: true, supplierId: `s${i % 30}` }))
  db.seed(c('products'), products)
  db.seed(c('stockLevels'), products.flatMap((p, i) => (['wh', 'b1', 'b2'].slice(0, i % 3 === 0 ? 2 : 3)).map((l) => ({ id: `${l}__${p.id}`, productId: p.id, locationId: l, qty: 10 + (i % 40) }))))
  db.seed(c('productMinOverrides'), Array.from({ length: n(50) }, (_, i) => ({ id: `b1__p${i}`, productId: `p${i}`, locationId: 'b1', minStock: 3 })))
  db.seed(c('suppliers'), Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, active: true, leadTimeDays: 2 })))
  const moves = []
  for (let d = 0; d < 45; d++) for (let k = 0; k < n(60); k++) moves.push({ id: `m${d}_${k}`, type: 'OUT', productId: `p${(d * 7 + k) % products.length}`, locationId: 'b1', qty: 1, date: NOW - d * DAY_MS, createdAt: NOW - d * DAY_MS })
  db.seed(c('stockMovements'), moves)
  db.seed(c('purchaseOrders'), Array.from({ length: n(120) }, (_, i) => ({ id: `po${i}`, status: i % 4 ? 'received' : 'ordered', supplierId: `s${i % 30}`, docNo: `PO${i}`, locationId: 'wh', lines: [], expectedDate: NOW + (i % 5) * DAY_MS, createdAt: NOW - i * DAY_MS / 3, receivedAt: i % 4 ? NOW - i * DAY_MS / 3 : undefined })))
  db.seed(c('notifications'), Array.from({ length: n(280) }, (_, i) => ({ id: `nt${i}`, kind: 'poArriving', active: true, createdAt: NOW - i * 36 * 60_000, expiresAt: NOW + DAY_MS })))
}

function counting(store: Store) {
  let docs = 0
  const wrapped: Store = {
    async query(c, f, o) {
      const r = await store.query(c, f, o)
      docs += Math.max(1, r.length)
      return r as never
    },
    async get(c, id) {
      docs += 1
      return store.get(c, id)
    },
    write: (ops) => store.write(ops),
  }
  return { store: wrapped, take: () => [docs, (docs = 0)][0] }
}

test('the cron Worker reads a few thousand documents a day at production size', async () => {
  const db = fakeStore()
  seedBrand(db, '', 1)
  seedBrand(db, 'lelapin__', 0.25)
  const { store, take } = counting(db.store)
  const per: Record<string, number> = {}
  await runJob(store, 'frequent', NOW)
  per.frequentRun = take()
  await runJob(store, 'generate', NOW)
  per.generate = take()
  await runJob(store, 'morning', NOW)
  per.morning = take()
  await runJob(store, 'weekly', NOW)
  per.weekly = take()
  const day = 48 * per.frequentRun + per.generate + per.morning + per.weekly / 7
  const out = { ...per, perDay: Math.round(day) }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/worker-reads.json', JSON.stringify(out, null, 1))
  // The app (tests/read-budget.test.ts, ~18k) and the Worker together stay under 25k.
  expect(day).toBeLessThan(7_000)
})
