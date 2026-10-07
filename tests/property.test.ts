// G21 — property-based tests: the invariants hold for generated inputs, not only the examples.
// fast-check, seeded so a failure reproduces; each property runs NUM_RUNS cases.
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { balancesFromLedger } from '../src/lib/levelKey'
import { checkIntegrity, INTEGRITY_SCHEMA, type IntegritySnapshot } from '../src/agent/integrityReference'
import { canonicalJson, proposalHash, seal } from '../src/agent/proposal'
import { guard } from '../src/agent/guard'
import { proposal, world } from '../src/agent/safety/world'
import { assertVersion, versionOf } from '../src/lib/concurrency'
import { check, MACHINES, type Machine } from '../src/lib/workflow'
import type { StockMovement } from '../src/types'

const SEED = 20261007
const NUM_RUNS = 2000
const opts = { seed: SEED, numRuns: NUM_RUNS }

// ---------------------------------------------------------------- the ledger ----

const LOCS = ['wh', 'br1', 'br2']
const movement = fc.record({
  productId: fc.constantFrom('p1', 'p2', 'p3'),
  qty: fc.integer({ min: 1, max: 5000 }).map((n) => n / 4), // quarter units: exact in binary
  from: fc.option(fc.constantFrom(...LOCS), { nil: undefined }),
  to: fc.option(fc.constantFrom(...LOCS), { nil: undefined }),
  voided: fc.boolean(),
})
const asRows = (ms: fc.TypeOf<typeof movement>[]) =>
  ms.map((m, i) => ({ id: `m${i}`, productId: m.productId, qty: m.qty, unit: 'KG', fromLocationId: m.from, toLocationId: m.to, voided: m.voided || undefined }) as unknown as StockMovement)

describe('ledger', () => {
  test('a balance is what came in minus what went out, whatever the order; voided rows do not count', () => {
    fc.assert(
      fc.property(fc.array(movement, { maxLength: 60 }), fc.integer(), (ms, shuffleSeed) => {
        const rows = asRows(ms)
        const a = balancesFromLedger(rows)
        // Shuffled deterministically by the generated seed.
        const shuffled = [...rows].sort((x, y) => ((Number(x.id.slice(1)) * 7919 + shuffleSeed) % 101) - ((Number(y.id.slice(1)) * 7919 + shuffleSeed) % 101))
        const b = balancesFromLedger(shuffled)
        for (const k of new Set([...a.keys(), ...b.keys()])) expect(a.get(k) ?? 0).toBeCloseTo(b.get(k) ?? 0, 9)
        for (const loc of LOCS)
          for (const p of ['p1', 'p2', 'p3']) {
            const live = ms.filter((m) => !m.voided && m.productId === p)
            const expected = live.filter((m) => m.to === loc).reduce((s, m) => s + m.qty, 0) - live.filter((m) => m.from === loc).reduce((s, m) => s + m.qty, 0)
            expect(a.get(`${loc}__${p}`) ?? 0).toBeCloseTo(expected, 9)
          }
      }),
      opts,
    )
  })
})

// ---------------------------------------------------------------- the integrity reference ----

describe('integrity reference', () => {
  const consistent = (ms: fc.TypeOf<typeof movement>[]): IntegritySnapshot => {
    const movements = ms.map((m, i) => ({ id: `m${i}`, productId: m.productId, qty: m.qty, ...(m.from ? { fromLocationId: m.from } : {}), ...(m.to ? { toLocationId: m.to } : {}), date: 1, createdAt: 1, ...(m.voided ? { voided: true } : {}) }))
    const base: IntegritySnapshot = { schema: INTEGRITY_SCHEMA, products: ['p1', 'p2', 'p3'].map((id) => ({ id, unitType: 'KG' })), locations: LOCS.map((id) => ({ id })), levels: [], movements, orders: [], transfers: [], closedPeriods: [] }
    const ledger = checkIntegrity(base).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER')
    return { ...base, levels: ledger.map((f) => ({ id: f.entity, qty: Number(f.expected) })) }
  }
  test('levels caught up with the ledger never drift; one changed level is reported exactly', () => {
    fc.assert(
      fc.property(fc.array(movement, { minLength: 1, maxLength: 40 }), fc.integer({ min: 1, max: 1000 }), (ms, delta) => {
        const s = consistent(ms)
        expect(checkIntegrity(s).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER')).toEqual([])
        if (!s.levels.length) return
        const drifted = { ...s, levels: s.levels.map((l, i) => (i === 0 ? { ...l, qty: l.qty + delta } : l)) }
        expect(checkIntegrity(drifted).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER').map((f) => f.entity)).toEqual([s.levels[0].id])
      }),
      opts,
    )
  })
  test('the reference is deterministic: same snapshot, same report', () => {
    fc.assert(
      fc.property(fc.array(movement, { maxLength: 30 }), (ms) => {
        expect(checkIntegrity(consistent(ms))).toEqual(checkIntegrity(consistent(ms)))
      }),
      opts,
    )
  })
})

// ---------------------------------------------------------------- the business guard ----

describe('business guard', () => {
  const W = world()
  const xfer = (qty: number, untrusted?: string) => {
    const p = proposal({ kind: 'CREATE_TRANSFER_DRAFT', fromLocationId: 'loc_silom', toLocationId: 'loc_onnut', lines: [{ productId: 'p_mozz', qty }] })
    if (untrusted === undefined) return p
    const { integrity: _i, ...rest } = p
    void _i
    return seal({ ...rest, untrusted: [{ source: 'ocr', text: untrusted }] })
  }
  test('untrusted text never changes a decision, whatever it says', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), fc.string({ maxLength: 400 }), (qty, text) => {
        const a = guard(JSON.parse(JSON.stringify(xfer(qty))), W)
        const b = guard(JSON.parse(JSON.stringify(xfer(qty, text))), W)
        expect(b.decision).toBe(a.decision)
        expect(b.results.filter((r) => r.ruleId !== 'G.INTEGRITY.HASH')).toEqual(a.results.filter((r) => r.ruleId !== 'G.INTEGRITY.HASH'))
      }),
      { ...opts, numRuns: 500 },
    )
  })
  test('monotone in quantity: once a transfer is refused for the source, more is refused too', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 200 }), (q, extra) => {
        const a = guard(JSON.parse(JSON.stringify(xfer(q))), W)
        const b = guard(JSON.parse(JSON.stringify(xfer(q + extra))), W)
        if (a.decision === 'DENY') expect(b.decision).toBe('DENY')
      }),
      { ...opts, numRuns: 500 },
    )
  })
  test('the hash is the same whatever order the keys arrive in', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.oneof(fc.integer(), fc.string(), fc.boolean())), (d) => {
        const reversed = Object.fromEntries(Object.entries(d).reverse())
        expect(canonicalJson(reversed)).toBe(canonicalJson(d))
      }),
      opts,
    )
    const p = xfer(10)
    expect(proposalHash(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(p).reverse()))))).toBe(p.integrity.hash)
  })
})

// ---------------------------------------------------------------- optimistic concurrency ----

describe('optimistic concurrency', () => {
  test('of any interleaving of edits, only those made from the current version land; the version counts them', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ seen: fc.integer({ min: 0, max: 12 }), value: fc.integer() }), { maxLength: 40 }), (edits) => {
        const doc: { version?: number; value?: number } = {}
        let landed = 0
        for (const e of edits) {
          try {
            assertVersion(doc, e.seen)
          } catch {
            expect(e.seen).not.toBe(versionOf(doc))
            continue
          }
          doc.value = e.value
          doc.version = versionOf(doc) + 1
          landed++
        }
        expect(versionOf(doc)).toBe(landed)
        // The last write standing is the last one that saw the version before it.
        const accepted = edits.filter((e, i) => e.seen === edits.slice(0, i).reduce((v, x) => (x.seen === v ? v + 1 : v), 0))
        if (accepted.length) expect(doc.value).toBe(accepted[accepted.length - 1].value)
      }),
      opts,
    )
  })
})

// ---------------------------------------------------------------- the workflow machines ----

describe('workflow machines', () => {
  const machines = Object.values(MACHINES) as Machine<string, string>[]
  test('any sequence of attempted actions stays inside the machine, and nothing leaves a terminal state', () => {
    for (const m of machines) {
      const actions = Object.keys(m.actions)
      fc.assert(
        fc.property(fc.array(fc.record({ action: fc.constantFrom(...actions), role: fc.constantFrom('staff', 'manager', 'admin' as const), owner: fc.boolean() }), { maxLength: 30 }), (steps) => {
          let state = m.initial
          for (const s of steps) {
            const r = check(m, state, s.action, { role: s.role, isOwner: s.owner })
            if (m.terminal.includes(state)) expect(r.ok).toBe(false)
            if (r.ok) state = r.to
            expect(m.states).toContain(state)
          }
        }),
        { ...opts, numRuns: 300 },
      )
    }
  })
})
