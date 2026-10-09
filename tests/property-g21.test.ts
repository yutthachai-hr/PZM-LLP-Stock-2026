// G21 (owner, 8 Oct 2026): the important invariants on 10,000 generated cases each —
// idempotency of a receipt, transfer conservation, the exact stock floor, and conservation of
// stock across sites. Expected answers come from independent formulas, never from the code
// under test. Seeded: a failure prints its counterexample and reproduces.
import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'

// 10,000 generated cases per property (G21) take longer than vitest's 5 s default.
vi.setConfig({ testTimeout: 120_000 })
import { memoryServerStore } from '../functions/_lib/memoryStore'
import { runStockCommand, type StockDeps } from '../functions/_lib/stockCommands'
import { checkIntegrity, INTEGRITY_SCHEMA, TRANSIT, type IntegritySnapshot } from '../src/agent/integrityReference'
import { guard } from '../src/agent/guard'
import { proposal, world } from '../src/agent/safety/world'
import type { GuardSnapshot } from '../src/agent/snapshot'

const SEED = 20261008
const RUNS = 10_000

// ---------------------------------------------------------------- idempotency ----

describe('idempotency: a receipt filed again under the same operation changes nothing', () => {
  const product = (id: string) => ({ sku: id, name: id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 })
  const world0 = (ordered: number[]) => ({
    users: { staff: { name: 'Staff A', role: 'staff', active: true } },
    products: Object.fromEntries(ordered.map((_, i) => [`p${i}`, product(`p${i}`)])),
    locations: { wh: { name: 'Main', type: 'warehouse', active: true, createdAt: 1 } },
    purchaseOrders: {
      po1: {
        docNo: 'PO-00001', supplierId: 's1', supplierName: 'S', status: 'ordered', locationId: 'wh', orderedAt: 1,
        lines: ordered.map((q, i) => ({ productId: `p${i}`, productName: `P${i}`, unit: 'KG', orderedQty: q })),
        createdBy: 'mgr', createdByName: 'M', createdAt: 1, updatedAt: 1,
      },
    },
    counters: { receive: { value: 0 } },
  })
  const state = (d: { store: ReturnType<typeof memoryServerStore> }) =>
    JSON.stringify([...d.store.data.entries()].filter(([k]) => !k.startsWith('outbox/')).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.doc]))

  test(`${RUNS} receipts: the second, third … filing returns the first and writes nothing`, async () => {
    // Counted so the property cannot pass vacuously: most generated receipts must actually be filed.
    let reached = 0
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 4 }),
        fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 4, maxLength: 4 }),
        fc.integer({ min: 2, max: 4 }),
        async (ordered, got, repeats) => {
          let n = 0
          const d: StockDeps & { store: ReturnType<typeof memoryServerStore> } = { store: memoryServerStore(world0(ordered)), now: () => 1_791_000_000_000, makeId: () => `id${++n}`, verifyUser: async () => 'staff' }
          const body = { brand: 'pizza', params: { orderId: 'po1', invoiceNo: 'IV-1', operationId: 'op-prop-0001', date: 1_791_000_000_000, lines: ordered.map((q, i) => ({ productId: `p${i}`, receivedQty: Math.min(got[i], q), checked: true, ...(got[i] < q ? { note: 'ส่งมาไม่ครบ' } : {}) })) } }
          const first = await runStockCommand(d, 'receivePO', 'Bearer staff', body)
          if (first.status !== 200) return // a refused receipt (e.g. nothing arrived) is not this property's business
          reached++
          const once = state(d)
          const writes = d.store.writes
          for (let r = 1; r < repeats; r++) {
            const again = await runStockCommand(d, 'receivePO', 'Bearer staff', body)
            expect(again.status).toBe(200)
            expect((again.body.result as { replayed?: boolean }).replayed).toBe(true)
          }
          expect(d.store.writes).toBe(writes)
          expect(state(d)).toBe(once)
        },
      ),
      { seed: SEED, numRuns: RUNS },
    )
    expect(reached).toBeGreaterThan(RUNS * 0.8)
  }, 600_000)
})

// ---------------------------------------------------------------- transfers and conservation ----

describe('conservation', () => {
  const SITES = ['a', 'b', 'c']
  /** Random transfers: each dispatches into transit and is received in full (closed) or partly (open). */
  const flows = fc.array(
    fc.record({ from: fc.constantFrom(...SITES), to: fc.constantFrom(...SITES), qty: fc.integer({ min: 1, max: 40 }), received: fc.integer({ min: 0, max: 40 }), closed: fc.boolean() }),
    { maxLength: 12 },
  )
  const build = (stockIn: number, fs: fc.TypeOf<typeof flows>): IntegritySnapshot => {
    const movements: IntegritySnapshot['movements'] = SITES.map((s, i) => ({ id: `in${i}`, productId: 'p', qty: stockIn, toLocationId: s, date: 1, createdAt: 1 }))
    const transfers: IntegritySnapshot['transfers'] = []
    fs.forEach((f, i) => {
      const id = `t${i}`
      movements.push({ id: `${id}o`, productId: 'p', qty: f.qty, fromLocationId: f.from, toLocationId: TRANSIT, transferId: id, date: 1, createdAt: 1 })
      // A closed transfer has everything out of transit; an open one only what arrived so far.
      const out = f.closed ? f.qty : Math.min(f.received, f.qty)
      if (out > 0) movements.push({ id: `${id}i`, productId: 'p', qty: out, fromLocationId: TRANSIT, toLocationId: f.to, transferId: id, date: 1, createdAt: 1 })
      transfers.push({ id, status: f.closed ? 'completed' : 'inTransit', fromLocationId: f.from, toLocationId: f.to })
    })
    const base: IntegritySnapshot = { schema: INTEGRITY_SCHEMA, products: [{ id: 'p', unitType: 'KG' }], locations: SITES.map((id) => ({ id })), levels: [], movements, orders: [], transfers, closedPeriods: [] }
    const ledger = checkIntegrity(base).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER')
    return { ...base, levels: ledger.map((f) => ({ id: f.entity, qty: Number(f.expected) })) }
  }

  test(`${RUNS} transfer histories: properly dispatched and received goods never break transfer or transit conservation`, () => {
    fc.assert(
      fc.property(flows, (fs) => {
        const bad = checkIntegrity(build(1000, fs)).findings.filter((f) => f.ruleId === 'INV.TRANSFER_CONSERVATION' || f.ruleId === 'INV.TRANSIT_EQ_OPEN_TRANSFERS')
        expect(bad).toEqual([])
      }),
      { seed: SEED, numRuns: RUNS },
    )
  })

  test(`${RUNS} histories: stock is neither made nor lost — sites plus transit equal what was received`, () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), flows, (stockIn, fs) => {
        const s = build(stockIn, fs)
        const total = s.levels.reduce((n, l) => n + l.qty, 0)
        expect(total).toBe(stockIn * SITES.length)
      }),
      { seed: SEED, numRuns: RUNS },
    )
  })

  test(`${RUNS} histories: taking more out of transit than went in is always caught`, () => {
    fc.assert(
      fc.property(flows.filter((fs) => fs.length > 0), fc.integer({ min: 1, max: 30 }), (fs, extra) => {
        const s = build(1000, fs)
        // One more receipt out of the first transfer than it ever carried.
        s.movements.push({ id: 'x', productId: 'p', qty: fs[0].qty + extra, fromLocationId: TRANSIT, toLocationId: fs[0].to, transferId: 't0', date: 1, createdAt: 1 })
        expect(checkIntegrity(s).findings.some((f) => f.ruleId === 'INV.TRANSFER_CONSERVATION' && f.entity === 't0/p')).toBe(true)
      }),
      { seed: SEED, numRuns: RUNS },
    )
  })
})

// ---------------------------------------------------------------- the stock floor ----

describe('stock floor: the guard refuses exactly what would leave the source short', () => {
  test(`${RUNS} random sources and quantities match the floor formula`, () => {
    fc.assert(
      fc.property(
        fc.record({
          onHand: fc.integer({ min: 0, max: 300 }),
          reserved: fc.integer({ min: 0, max: 40 }),
          pending: fc.integer({ min: 0, max: 40 }),
          min: fc.integer({ min: 0, max: 60 }),
          avgDaily: fc.integer({ min: 0, max: 20 }),
          q: fc.integer({ min: 1, max: 350 }),
        }),
        (w) => {
          const base = world()
          const snap: GuardSnapshot = {
            ...base,
            levels: base.levels.map((l) => (l.locationId === 'loc_silom' && l.productId === 'p_mozz' ? { ...l, onHand: w.onHand, reserved: w.reserved } : l)),
            pendingOut: [...base.pendingOut, { locationId: 'loc_silom', productId: 'p_mozz', qty: w.pending }],
            mins: [{ locationId: 'loc_silom', productId: 'p_mozz', min: w.min }],
            usage: base.usage.map((u) => (u.locationId === 'loc_silom' && u.productId === 'p_mozz' ? { ...u, avgDaily: w.avgDaily } : u)),
            // Destination sanity bound out of the way: this property is about the source.
            limits: { sanityDays: 10_000 },
          }
          const p = proposal({ kind: 'CREATE_TRANSFER_DRAFT', fromLocationId: 'loc_silom', toLocationId: 'loc_onnut', lines: [{ productId: 'p_mozz', qty: w.q }] })
          const r = guard(JSON.parse(JSON.stringify(p)), snap)
          // Independently: what the source can spare, and what it must keep (1 lead day + 3 keep days of use).
          const available = Math.max(0, w.onHand - w.reserved - w.pending)
          const required = Math.max(w.min, w.avgDaily * 4)
          const short = w.q > available
          const belowFloor = !short && available - w.q < required
          const fired = (id: string) => r.results.some((x) => x.ruleId === id && x.outcome === 'DENY')
          expect(fired('G.TRANSFER.SOURCE_SUFFICIENT')).toBe(short)
          expect(fired('G.TRANSFER.SOURCE_FLOOR')).toBe(belowFloor)
          if (short || belowFloor) expect(r.decision).toBe('DENY')
        },
      ),
      { seed: SEED, numRuns: RUNS },
    )
  })
})
