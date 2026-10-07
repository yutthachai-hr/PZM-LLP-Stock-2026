// G13 — the TypeScript integrity reference: agrees with the app's own rules, and the Rust
// vectors on disk are exactly what it produces today.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { balancesFromLedger } from '../src/lib/levelKey'
import { monthOf } from '../src/lib/monthlyCount'
import { bkkMonth, checkIntegrity, INVARIANTS, num, round3 } from '../src/agent/integrityReference'
import { cleanWorld, handCases, vectorFile, vectors } from '../src/agent/integrityVectors'
import type { StockMovement } from '../src/types'

const dir = new URL('../crates/pzm-integrity/vectors/', import.meta.url)

describe('G13 integrity reference', () => {
  test('the clean world passes, and each named case trips what it names', () => {
    expect(checkIntegrity(cleanWorld())).toEqual({ schema: 'pzm-integrity/1', status: 'PASS', findings: [] })
    const fired = Object.fromEntries(handCases().map(([n, s]) => [n, [...new Set(checkIntegrity(s).findings.map((f) => f.ruleId))]]))
    expect(fired['level-drift']).toEqual(['INV.LEVEL_EQ_LEDGER'])
    expect(fired['po-received-mismatch']).toEqual(['INV.PO_RECEIVED_EQ_RECEIPTS'])
    expect(fired['duplicate-operation']).toEqual(['INV.NO_DUPLICATE_RECEIPT_OP'])
    expect(fired['duplicate-operation-voided-ok']).toEqual([])
    expect(fired['closed-transfer-in-transit']).toEqual(['INV.TRANSFER_CONSERVATION', 'INV.TRANSIT_EQ_OPEN_TRANSFERS'])
    expect(fired['transit-without-transfer']).toEqual(['INV.TRANSIT_EQ_OPEN_TRANSFERS'])
    expect(fired['bad-conversion-zero']).toEqual(['INV.UNIT_CONVERSION_VALID'])
    expect(fired['conversion-cycle']).toEqual(['INV.UNIT_CONVERSION_VALID'])
    expect(fired['conversion-standard-measure']).toEqual([])
    expect(fired['orphan-product']).toEqual(['INV.NO_ORPHAN_LEDGER'])
    expect(fired['reserved-above-onhand']).toEqual(['INV.AVAILABLE_LE_ONHAND'])
    expect(fired['period-lock-violation']).toEqual(['INV.PERIOD_LOCK_CONSISTENT'])
    expect(fired['period-lock-override']).toEqual([])
    expect(fired['bangkok-month-boundary']).toEqual([])
    expect(fired['bangkok-month-boundary-before']).toEqual(['INV.PERIOD_LOCK_CONSISTENT'])
    expect(fired['float-sum']).toEqual([])
  })

  test('every invariant has at least one vector that fires it', () => {
    const seen = new Set(vectors().flatMap((v) => v.expected.findings.map((f) => f.ruleId)))
    for (const inv of INVARIANTS) expect(seen.has(inv), inv).toBe(true)
  })

  test('the Bangkok month is the app’s monthOf', () => {
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 1, 1); ms += 3_600_000 * 7 + 13 * 60_000) expect(bkkMonth(ms), new Date(ms).toISOString()).toBe(monthOf(ms))
  })

  test('the ledger is the app’s balancesFromLedger', () => {
    const s = cleanWorld()
    const app = balancesFromLedger(s.movements.map((m) => ({ ...m, unit: 'X', docNo: m.id, type: 'adjust', productName: '' })) as unknown as StockMovement[])
    const drift = checkIntegrity({ ...s, levels: [...app].map(([id, qty]) => ({ id, qty })) }).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER')
    expect(drift).toEqual([])
  })

  test('numbers print the way Rust is told to print them', () => {
    expect(num(-0.0001)).toBe('0')
    expect(num(0.1 + 0.2)).toBe('0.3')
    expect(round3(-0.0625)).toBe(-0.062)
    expect(num(Number.NaN)).toBe('NaN')
  })

  test('the committed vectors are exactly what the reference produces now', () => {
    expect(existsSync(dir)).toBe(true)
    const want = vectors().map((v, i) => [`${String(i).padStart(3, '0')}-${v.name}.json`, vectorFile(v)] as const)
    const have = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    expect(have).toEqual(want.map(([f]) => f).sort())
    for (const [f, body] of want) expect(readFileSync(new URL(f, dir), 'utf8'), f).toBe(body)
  })
})
