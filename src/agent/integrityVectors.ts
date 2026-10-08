/**
 * G13 — test vectors for crates/pzm-integrity, produced by the TypeScript reference.
 *
 * Each vector is `{ name, input, expected }`; `expected` is `checkIntegrity(input)`. The crate's
 * `cargo test` must reproduce every one exactly. Hand-made cases name each invariant and the
 * edges where two languages could disagree (rounding, the Bangkok month boundary, Thai unit
 * names, conversion cycles); seeded random snapshots cover the rest.
 */
import { checkIntegrity, INTEGRITY_SCHEMA, TRANSIT, type IntegritySnapshot } from './integrityReference'

export const VECTOR_SEED = 13

type Snap = IntegritySnapshot
type Mv = Snap['movements'][number]

const T0 = Date.UTC(2026, 9, 1, 3) // 1 Oct 2026, 10:00 Bangkok
const H = 3_600_000

/** A small consistent world: every balance equals its ledger, every order its receipts. */
export function cleanWorld(): Snap {
  const movements: Mv[] = [
    { id: 'm01', productId: 'p_mozz', qty: 50, toLocationId: 'loc_suk', date: T0, createdAt: T0, poId: 'po_1', operationId: 'op_r1' },
    { id: 'm02', productId: 'p_flour', qty: 250, toLocationId: 'loc_suk', date: T0, createdAt: T0 + H, poId: 'po_1', operationId: 'op_r2' },
    { id: 'm03', productId: 'p_mozz', qty: 12.5, fromLocationId: 'loc_suk', date: T0 + 24 * H, createdAt: T0 + 24 * H },
    { id: 'm04', productId: 'p_mozz', qty: 10, fromLocationId: 'loc_suk', toLocationId: TRANSIT, transferId: 'tr_1', date: T0 + 25 * H, createdAt: T0 + 25 * H },
    { id: 'm05', productId: 'p_mozz', qty: 10, fromLocationId: TRANSIT, toLocationId: 'loc_onnut', transferId: 'tr_1', date: T0 + 26 * H, createdAt: T0 + 26 * H },
    { id: 'm06', productId: 'p_flour', qty: 25, fromLocationId: 'loc_suk', toLocationId: TRANSIT, transferId: 'tr_2', date: T0 + 27 * H, createdAt: T0 + 27 * H },
    { id: 'm07', productId: 'p_box', qty: 500, toLocationId: 'loc_onnut', date: T0, createdAt: T0, poId: 'po_2', operationId: 'op_r3' },
    { id: 'm08', productId: 'p_box', qty: 999, toLocationId: 'loc_onnut', date: T0, createdAt: T0, poId: 'po_2', operationId: 'op_r4', voided: true },
  ]
  return {
    schema: INTEGRITY_SCHEMA,
    products: [
      { id: 'p_mozz', unitType: 'KG', unitConversions: [{ label: 'Bag', size: 2.5 }, { label: 'กรัม', size: 0.001 }] },
      { id: 'p_flour', unitType: 'กก.', unitConversions: [{ label: 'Sack', size: 25 }, { label: 'Pallet', size: 40, of: 'Sack' }] },
      { id: 'p_box', unitType: 'EA', unitConversions: [{ label: 'Pack', size: 25 }, { label: 'Carton', size: 12, of: 'Pack' }] },
      { id: 'p_oil', unitType: 'L', unitConversions: [{ label: 'Can', size: 18 }, { label: 'EA', size: 2.72, per: 1 }] },
    ],
    locations: [{ id: 'loc_suk' }, { id: 'loc_onnut' }],
    levels: [
      { id: 'loc_suk__p_mozz', qty: 27.5, reserved: 5 },
      { id: 'loc_onnut__p_mozz', qty: 10 },
      { id: 'loc_suk__p_flour', qty: 225 },
      { id: 'transit__p_flour', qty: 25 },
      { id: 'loc_onnut__p_box', qty: 500 },
      { id: 'transit__p_mozz', qty: 0 },
    ],
    movements,
    orders: [
      { id: 'po_1', status: 'received', locationId: 'loc_suk', lines: [{ productId: 'p_mozz', receivedQty: 50 }, { productId: 'p_flour', receivedQty: 250 }] },
      { id: 'po_2', status: 'received', locationId: 'loc_onnut', lines: [{ productId: 'p_box', receivedQty: 500 }] },
    ],
    transfers: [
      { id: 'tr_1', status: 'completed', fromLocationId: 'loc_suk', toLocationId: 'loc_onnut' },
      { id: 'tr_2', status: 'inTransit', fromLocationId: 'loc_suk', toLocationId: 'loc_onnut' },
    ],
    closedPeriods: [{ locationId: 'loc_suk', month: '2026-09', postedAt: T0 - 2 * H }],
  }
}

const edit = (change: (s: Snap) => void): Snap => {
  const s = structuredClone(cleanWorld())
  change(s)
  return s
}
const level = (s: Snap, id: string) => s.levels.find((l) => l.id === id)!

/** Named cases: each breaks one invariant, or probes an edge both languages must agree on. */
export function handCases(): [string, Snap][] {
  return [
    ['clean', cleanWorld()],
    ['empty', { schema: INTEGRITY_SCHEMA, products: [], locations: [], levels: [], movements: [], orders: [], transfers: [], closedPeriods: [] }],
    ['level-drift', edit((s) => { level(s, 'loc_suk__p_mozz').qty = 28 })],
    ['level-missing-row', edit((s) => { s.levels = s.levels.filter((l) => l.id !== 'loc_onnut__p_box') })],
    ['level-without-ledger', edit((s) => { s.levels.push({ id: 'loc_onnut__p_flour', qty: 3 }) })],
    ['drift-within-epsilon', edit((s) => { level(s, 'loc_suk__p_mozz').qty = 27.5004 })],
    ['negative-ledger', edit((s) => { s.movements.push({ id: 'm90', productId: 'p_mozz', qty: 20, fromLocationId: 'loc_onnut', date: T0 + 30 * H, createdAt: T0 + 30 * H }); level(s, 'loc_onnut__p_mozz').qty = -10 })],
    ['po-received-mismatch', edit((s) => { s.orders[0].lines[1].receivedQty = 275 })],
    ['po-voided-receipt-counted', edit((s) => { s.orders[1].lines[0].receivedQty = 1499 })],
    ['duplicate-operation', edit((s) => { s.movements.push({ ...s.movements[0], id: 'm91' }); level(s, 'loc_suk__p_mozz').qty = 77.5; s.orders[0].lines[0].receivedQty = 100 })],
    ['duplicate-operation-voided-ok', edit((s) => { s.movements.push({ ...s.movements[0], id: 'm92', voided: true }) })],
    ['closed-transfer-in-transit', edit((s) => { s.transfers[1].status = 'completed' })],
    ['more-out-of-transit-than-in', edit((s) => { s.movements.push({ id: 'm93', productId: 'p_flour', qty: 30, fromLocationId: TRANSIT, toLocationId: 'loc_onnut', transferId: 'tr_2', date: T0 + 30 * H, createdAt: T0 + 30 * H }); level(s, 'transit__p_flour').qty = -5; s.levels.push({ id: 'loc_onnut__p_flour', qty: 30 }) })],
    ['transit-without-transfer', edit((s) => { s.movements.push({ id: 'm94', productId: 'p_box', qty: 40, fromLocationId: 'loc_onnut', toLocationId: TRANSIT, date: T0 + 30 * H, createdAt: T0 + 30 * H }); level(s, 'loc_onnut__p_box').qty = 460; s.levels.push({ id: 'transit__p_box', qty: 40 }) })],
    ['transfer-unknown-to-file', edit((s) => { s.transfers = s.transfers.filter((t) => t.id !== 'tr_2') })],
    ['bad-conversion-zero', edit((s) => { s.products[0].unitConversions!.push({ label: 'Tub', size: 0 }) })],
    ['bad-conversion-per', edit((s) => { s.products[3].unitConversions!.push({ label: 'Drum', size: 200, per: -1 }) })],
    // A NaN `per` travels as JSON null; the reference refuses it (Rust read it as absent until 8 Oct 2026).
    ['bad-conversion-per-nan', edit((s) => { s.products[3].unitConversions!.push({ label: 'Keg', size: 2, per: Number.NaN }) })],
    ['conversion-cycle', edit((s) => { s.products[2].unitConversions = [{ label: 'Pack', size: 25, of: 'Carton' }, { label: 'Carton', size: 12, of: 'Pack' }] })],
    ['conversion-dead-end', edit((s) => { s.products[2].unitConversions!.push({ label: 'Lot', size: 3, of: 'Crate' }) })],
    ['conversion-standard-measure', edit((s) => { s.products[0].unitConversions!.push({ label: 'Kilo', size: 1000, of: 'g' }) })],
    ['orphan-product', edit((s) => { s.products = s.products.filter((p) => p.id !== 'p_box') })],
    ['orphan-location', edit((s) => { s.locations = s.locations.filter((l) => l.id !== 'loc_onnut') })],
    ['reserved-above-onhand', edit((s) => { level(s, 'loc_suk__p_mozz').reserved = 30 })],
    ['reserved-negative', edit((s) => { level(s, 'loc_onnut__p_box').reserved = -1 })],
    ['period-lock-violation', edit((s) => { s.movements.push({ id: 'm95', productId: 'p_mozz', qty: 1, fromLocationId: 'loc_suk', date: Date.UTC(2026, 8, 20), createdAt: T0 }); level(s, 'loc_suk__p_mozz').qty = 26.5 })],
    ['period-lock-override', edit((s) => { s.movements.push({ id: 'm96', productId: 'p_mozz', qty: 1, fromLocationId: 'loc_suk', date: Date.UTC(2026, 8, 20), createdAt: T0, lockOverride: 'admin: count sheet typo' }); level(s, 'loc_suk__p_mozz').qty = 26.5 })],
    ['period-lock-before-post-ok', edit((s) => { s.movements.push({ id: 'm97', productId: 'p_mozz', qty: 1, fromLocationId: 'loc_suk', date: Date.UTC(2026, 8, 20), createdAt: T0 - 3 * H }); level(s, 'loc_suk__p_mozz').qty = 26.5 })],
    // 30 Sep 17:30 UTC is already 1 Oct in Bangkok: not in the closed September.
    ['bangkok-month-boundary', edit((s) => { s.movements.push({ id: 'm98', productId: 'p_mozz', qty: 1, fromLocationId: 'loc_suk', date: Date.UTC(2026, 8, 30, 17, 30), createdAt: T0 }); level(s, 'loc_suk__p_mozz').qty = 26.5 })],
    ['bangkok-month-boundary-before', edit((s) => { s.movements.push({ id: 'm99', productId: 'p_mozz', qty: 1, fromLocationId: 'loc_suk', date: Date.UTC(2026, 8, 30, 16, 59), createdAt: T0 }); level(s, 'loc_suk__p_mozz').qty = 26.5 })],
    ['float-sum', edit((s) => {
      for (const [i, q] of [0.1, 0.2, 0.7].entries()) s.movements.push({ id: `mf${i}`, productId: 'p_oil', qty: q, toLocationId: 'loc_suk', date: T0, createdAt: T0 })
      s.levels.push({ id: 'loc_suk__p_oil', qty: 1 })
    })],
    ['half-up-rounding', edit((s) => {
      s.movements.push({ id: 'mh1', productId: 'p_oil', qty: 1.0005, toLocationId: 'loc_onnut', date: T0, createdAt: T0 })
      s.movements.push({ id: 'mh2', productId: 'p_oil', qty: 2.0015, fromLocationId: 'loc_onnut', date: T0, createdAt: T0 })
      s.levels.push({ id: 'loc_onnut__p_oil', qty: 0 })
    })],
    // −62.5 thousandths: Math.round gives −62, a half-away-from-zero round would give −63.
    ['negative-half-rounding', edit((s) => {
      s.movements.push({ id: 'mn1', productId: 'p_oil', qty: 0.0625, fromLocationId: 'loc_suk', date: T0, createdAt: T0 })
      s.levels.push({ id: 'loc_suk__p_oil', qty: -0.0625 })
    })],
    ['many-findings', edit((s) => {
      level(s, 'loc_suk__p_mozz').qty = 1
      level(s, 'loc_onnut__p_box').reserved = 600
      s.orders[0].lines[0].receivedQty = 1
      s.transfers[1].status = 'cancelled'
      s.products[0].unitConversions!.push({ label: 'Tub', size: Number.NaN })
    })],
  ]
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded random snapshots: random ledgers, with levels and orders sometimes knocked off. */
export function randomCases(count = 24, seed = VECTOR_SEED): [string, Snap][] {
  const r = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const out: [string, Snap][] = []
  for (let n = 0; n < count; n++) {
    const s = cleanWorld()
    const locs = ['loc_suk', 'loc_onnut', 'loc_ghost']
    const pids = ['p_mozz', 'p_flour', 'p_box', 'p_oil', 'p_ghost']
    for (let i = 0; i < int(5, 40); i++) {
      const q = int(1, 4000) / pick([1, 4, 8, 1000])
      const kind = int(0, 3)
      const loc = pick(locs)
      const m: Mv = { id: `r${n}_${i}`, productId: pick(pids), qty: q, date: T0 - int(-48, 400) * H, createdAt: T0 + int(-48, 48) * H }
      if (kind === 0) m.toLocationId = loc
      else if (kind === 1) m.fromLocationId = loc
      else if (kind === 2) { m.fromLocationId = loc; m.toLocationId = TRANSIT; m.transferId = pick(['tr_1', 'tr_2', 'tr_9']) }
      else { m.fromLocationId = TRANSIT; m.toLocationId = loc; m.transferId = pick(['tr_1', 'tr_2', 'tr_9']) }
      if (r() < 0.2) m.operationId = `op_x${int(1, 6)}`
      if (r() < 0.2) m.poId = pick(['po_1', 'po_2'])
      if (r() < 0.1) m.voided = true
      if (r() < 0.05) m.lockOverride = 'reason'
      s.movements.push(m)
    }
    // Levels: either caught up with the ledger (so drift shows only where knocked off) or left stale.
    const fresh = checkIntegrity({ ...s, levels: [] }).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER')
    if (r() < 0.6) s.levels = fresh.map((f) => ({ id: f.entity, qty: Number(f.expected), ...(r() < 0.2 ? { reserved: int(0, 30) } : {}) }))
    if (r() < 0.5 && s.levels.length) s.levels[int(0, s.levels.length - 1)].qty += pick([0.001, 0.0004, 1, -3.25])
    s.transfers[int(0, 1)].status = pick(['inTransit', 'completed', 'receiving', 'cancelled', 'draft'])
    s.closedPeriods.push({ locationId: pick(locs), month: pick(['2026-09', '2026-10']), postedAt: T0 + int(-24, 24) * H })
    out.push([`random-${String(n).padStart(2, '0')}`, s])
  }
  return out
}

export interface Vector {
  name: string
  input: Snap
  expected: ReturnType<typeof checkIntegrity>
}

export function vectors(): Vector[] {
  return [...handCases(), ...randomCases()].map(([name, input]) => ({ name, input, expected: checkIntegrity(input) }))
}

/** The bytes a vector file holds. A NaN size is written as null (JSON has no NaN); Rust reads it as not-a-number. */
export function vectorFile(v: Vector): string {
  return JSON.stringify(v, null, 1) + '\n'
}

/** A large consistent snapshot for timing (G13 latency/memory): `n` movements over many products. */
export function largeSnapshot(n = 60_000, productCount = 400, seed = VECTOR_SEED): Snap {
  const r = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const locs = ['loc_suk', 'loc_onnut', 'loc_silom', 'loc_ari', 'loc_ram', 'loc_cw']
  const products = Array.from({ length: productCount }, (_, i) => ({ id: `p_${i}`, unitType: i % 3 ? 'KG' : 'EA', unitConversions: [{ label: 'Case', size: int(2, 48) }, { label: 'Pallet', size: 20, of: 'Case' }] }))
  const movements: Mv[] = []
  for (let i = 0; i < n; i++) {
    const pid = `p_${int(0, productCount - 1)}`
    const loc = locs[int(0, locs.length - 1)]
    const kind = int(0, 9)
    const m: Mv = { id: `m${i}`, productId: pid, qty: int(1, 5000) / 4, date: T0 - int(0, 200) * 24 * H, createdAt: T0 - int(0, 200) * 24 * H }
    if (kind < 4) { m.toLocationId = loc; m.operationId = `op_${i}`; m.poId = `po_${i % 3000}` } else if (kind < 9) m.fromLocationId = loc
    else { m.fromLocationId = loc; m.toLocationId = TRANSIT; m.transferId = `tr_${i % 500}` }
    movements.push(m)
  }
  const s: Snap = { schema: INTEGRITY_SCHEMA, products, locations: locs.map((id) => ({ id })), levels: [], movements, orders: [], transfers: Array.from({ length: 500 }, (_, i) => ({ id: `tr_${i}`, status: 'inTransit', fromLocationId: 'loc_suk', toLocationId: 'loc_onnut' })), closedPeriods: locs.map((l) => ({ locationId: l, month: '2026-08', postedAt: T0 - 30 * 24 * H })) }
  s.levels = checkIntegrity(s).findings.filter((f) => f.ruleId === 'INV.LEVEL_EQ_LEDGER').map((f) => ({ id: f.entity, qty: Number(f.expected) }))
  return s
}
