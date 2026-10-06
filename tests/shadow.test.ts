// Phase G9 — shadow mode: predictions kept once, judged later against what happened, and
// nothing written but the snapshot itself.
import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
})

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const mem = await import('./helpers/memory-backend')
const { recordShadow } = await import('../src/services/intelShadow')
const { deliverySnapshot, evaluateShadow, stockoutSnapshot } = await import('../src/intel/shadow')
const { deliveryRiskIntel } = await import('../src/intel/supplier')
const { stockoutFor } = await import('../src/intel/stockout')
const { asOf } = await import('../src/intel/backtest')
const { syntheticHistory } = await import('../src/intel/synthetic')
const { deliveryOutcome } = await import('../src/lib/deliveryMetrics')
const { usageIndex } = await import('../src/lib/inventoryRules/usage')
const { DAY_MS } = await import('../src/lib/inventoryRules/time')
const { setActiveBrand } = await import('../src/brand/brand')

const H = syntheticHistory({ seed: 42 })

beforeEach(() => {
  mem.resetMemory()
  setActiveBrand('pizza')
  localStorage.clear()
})

describe('shadow snapshots', () => {
  test('kept once; a second attempt writes nothing; only intelShadow is touched', async () => {
    const o = H.orders[20]
    const t = o.orderedAt + 60_000
    const known = asOf(H, t)
    const r = deliveryRiskIntel(known.orders.find((x) => x.id === o.id)!, { now: t, history: known.orders.filter((x) => x.status === 'received').map(deliveryOutcome) })!
    const snap = deliverySnapshot(r, 'mgr')
    expect(await recordShadow(snap)).toBe(true)
    expect(await recordShadow({ ...snap, score: 1 })).toBe(false)
    expect(mem.raw('intelShadow')).toEqual([expect.objectContaining({ id: `dr__${o.id}`, score: r.score, engineVersion: 'delivery-rules-1' })])
    for (const c of ['purchaseOrders', 'purchaseRequests', 'transfers', 'stockMovements', 'stockLevels', 'notifications']) expect(mem.raw(c)).toEqual([])
  })

  test('judged later: delivery snapshots against how each order finished', () => {
    const snaps = H.orders.slice(10, 60).map((o) => {
      const t = o.orderedAt + 60_000
      const known = asOf(H, t)
      const r = deliveryRiskIntel(known.orders.find((x) => x.id === o.id)!, { now: t, history: known.orders.filter((x) => x.status === 'received' || x.status === 'cancelled').map(deliveryOutcome) })!
      return deliverySnapshot(r, 'mgr')
    })
    const e = evaluateShadow(snaps, H.orders, H.movements, H.end)
    expect(e.delivery.rows).toHaveLength(50)
    expect(e.delivery.metrics.n + e.delivery.pending).toBe(50)
    expect(e.delivery.metrics.tp + e.delivery.metrics.fp + e.delivery.metrics.fn + e.delivery.metrics.tn).toBe(e.delivery.metrics.n)
  })

  test('a stock-out snapshot is pending until its 7-day window has passed', () => {
    const t = H.start + 80 * DAY_MS
    const known = asOf(H, t)
    const usage = usageIndex(known.movements, t, 30)
    const bal = (l: string, p: string) => known.movements.reduce((s, m) => s + (m.productId !== p ? 0 : (m.toLocationId === l ? m.qty : 0) - (m.fromLocationId === l ? m.qty : 0)), 0)
    const input = { products: known.products, locations: known.locations, qtyAt: bal, tracksProduct: () => true, usage, orders: known.orders, transfers: known.transfers, risks: new Map(), now: t }
    const results = known.locations.flatMap((l) => known.products.map((p) => stockoutFor(input, p, l))).filter((r) => r.prediction)
    const snap = stockoutSnapshot(results, t, 'mgr', 'stockout-1')
    expect(snap.items.length).toBeGreaterThan(0)
    expect(evaluateShadow([snap], H.orders, H.movements, t + 3 * DAY_MS).stockout.pending).toBe(snap.items.length)
    const later = evaluateShadow([snap], H.orders, H.movements, t + 8 * DAY_MS).stockout
    expect(later.pending).toBe(0)
    expect(later.metrics.n).toBe(snap.items.length)
  })
})
