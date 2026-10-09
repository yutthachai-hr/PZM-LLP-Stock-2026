/**
 * G13 — the TypeScript reference for crates/pzm-integrity: ten invariants over a snapshot.
 *
 * The Rust crate is checked against THIS file through generated vectors
 * (crates/pzm-integrity/vectors, `cargo test`). Anything changed here is a change to the
 * vectors, so the two cannot drift silently. The rules are the app's own:
 *  - a balance is what the non-voided ledger adds up to, `from` minus and `to` plus
 *    (lib/levelKey.ts balancesFromLedger), keyed `${location}__${product}`;
 *  - unit rates resolve with lib/inventoryRules/uom.ts resolveFactor;
 *  - a month is the Bangkok month (lib/monthlyCount.ts monthOf).
 *
 * Simplified on purpose: base units only (legacy `#Unit` balances are the app auditor's job),
 * and numbers leave as strings so both languages print them identically.
 *
 * Pure: no I/O, no clock. Not on any request path.
 */
import { resolveFactor } from '../lib/inventoryRules/uom'

export const INTEGRITY_SCHEMA = 'pzm-integrity/1'
export const TRANSIT = 'transit'
const EPS = 0.0005
const BKK_OFFSET_MS = 7 * 3_600_000

export interface IntegritySnapshot {
  schema: typeof INTEGRITY_SCHEMA
  products: { id: string; unitType: string; unitConversions?: { label: string; size: number; per?: number; of?: string }[] }[]
  locations: { id: string }[]
  levels: { id: string; qty: number; reserved?: number }[]
  movements: {
    id: string
    productId: string
    qty: number
    fromLocationId?: string
    toLocationId?: string
    date: number
    createdAt: number
    voided?: boolean
    operationId?: string
    poId?: string
    transferId?: string
    /** An admin's reason for filing into a closed month (the only way in). */
    lockOverride?: string
  }[]
  orders: { id: string; status: string; locationId: string; lines: { productId: string; receivedQty: number }[] }[]
  transfers: { id: string; status: string; fromLocationId: string; toLocationId: string }[]
  closedPeriods: { locationId: string; month: string; postedAt: number }[]
}

export type Severity = 'critical' | 'warning'
export interface Finding {
  ruleId: string
  severity: Severity
  entity: string
  expected: string
  actual: string
  reason: string
}
export interface IntegrityReport {
  schema: typeof INTEGRITY_SCHEMA
  status: 'PASS' | 'WARNING' | 'FAIL'
  findings: Finding[]
}

export const INVARIANTS = [
  'INV.LEVEL_EQ_LEDGER',
  'INV.NO_NEGATIVE_LEDGER',
  'INV.PO_RECEIVED_EQ_RECEIPTS',
  'INV.NO_DUPLICATE_RECEIPT_OP',
  'INV.TRANSFER_CONSERVATION',
  'INV.TRANSIT_EQ_OPEN_TRANSFERS',
  'INV.UNIT_CONVERSION_VALID',
  'INV.NO_ORPHAN_LEDGER',
  'INV.AVAILABLE_LE_ONHAND',
  'INV.PERIOD_LOCK_CONSISTENT',
] as const

/** Transfers whose goods may still be on the road. */
export const OPEN_TRANSFER = ['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval']
/** Transfers that are over: nothing of theirs may remain in transit. */
export const CLOSED_TRANSFER = ['completed', 'resolved', 'cancelled', 'rejected']

/** Math.round to three decimals — half up, as JavaScript rounds. Rust mirrors it exactly. */
export function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000
  return r === 0 ? 0 : r
}

/** A number as both languages print it (three decimals, no exponent, no negative zero). */
export function num(n: number): string {
  return String(round3(n))
}

/** 'YYYY-MM' of the Bangkok day containing `ms`. */
export function bkkMonth(ms: number): string {
  const d = new Date(ms + BKK_OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const key = (loc: string, pid: string) => `${loc}__${pid}`
const byEntity = (a: Finding, b: Finding) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0)

export function checkIntegrity(s: IntegritySnapshot): IntegrityReport {
  const groups: Record<string, Finding[]> = Object.fromEntries(INVARIANTS.map((r) => [r, []]))
  const add = (ruleId: (typeof INVARIANTS)[number], severity: Severity, entity: string, expected: string, actual: string, reason: string) => groups[ruleId].push({ ruleId, severity, entity, expected, actual, reason })
  const live = s.movements.filter((m) => !m.voided)

  // The ledger, in the order given (sums are order-sensitive in floating point; Rust uses the same order).
  const ledger = new Map<string, number>()
  const bump = (k: string, d: number) => ledger.set(k, round3((ledger.get(k) ?? 0) + d))
  for (const m of live) {
    if (m.fromLocationId) bump(key(m.fromLocationId, m.productId), -m.qty)
    if (m.toLocationId) bump(key(m.toLocationId, m.productId), m.qty)
  }

  // 1. Every stored balance equals the ledger, and every ledger balance has a stored row.
  const stored = new Map(s.levels.map((l) => [l.id, l]))
  for (const id of new Set([...ledger.keys(), ...stored.keys()])) {
    const a = ledger.get(id) ?? 0
    const b = stored.get(id)?.qty ?? 0
    if (Math.abs(a - b) > EPS) add('INV.LEVEL_EQ_LEDGER', 'critical', id, num(a), num(b), 'stored balance differs from the ledger')
  }
  // 2. Nothing the ledger adds up to is below zero.
  for (const [id, a] of ledger) if (a < -EPS) add('INV.NO_NEGATIVE_LEDGER', 'critical', id, '0', num(a), 'ledger balance below zero')

  // 3. What an order line says was received equals its receipts.
  for (const o of s.orders) {
    for (const l of o.lines) {
      let sum = 0
      for (const m of live) if (m.poId === o.id && m.productId === l.productId && m.toLocationId) sum = round3(sum + m.qty)
      if (Math.abs(sum - l.receivedQty) > EPS) add('INV.PO_RECEIVED_EQ_RECEIPTS', 'critical', `${o.id}/${l.productId}`, num(sum), num(l.receivedQty), 'order line received differs from its receipts')
    }
  }
  // 4. One operation, one movement.
  const ops = new Map<string, string[]>()
  for (const m of live) if (m.operationId) ops.set(m.operationId, [...(ops.get(m.operationId) ?? []), m.id])
  for (const [op, ids] of ops) if (ids.length > 1) add('INV.NO_DUPLICATE_RECEIPT_OP', 'critical', op, '1', String(ids.length), `operation filed more than once: ${[...ids].sort().join(',')}`)

  // 5./6. Transit: per transfer and product, what went in minus what came out.
  const transitNet = new Map<string, number>() // `${transferId}/${productId}`
  for (const m of live) {
    if (!m.transferId) continue
    const k = `${m.transferId}/${m.productId}`
    if (m.toLocationId === TRANSIT) transitNet.set(k, round3((transitNet.get(k) ?? 0) + m.qty))
    if (m.fromLocationId === TRANSIT) transitNet.set(k, round3((transitNet.get(k) ?? 0) - m.qty))
  }
  const transfers = new Map(s.transfers.map((t) => [t.id, t]))
  const openByProduct = new Map<string, number>()
  for (const [k, net] of transitNet) {
    const [tid, pid] = [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1)]
    const t = transfers.get(tid)
    if (net < -EPS) add('INV.TRANSFER_CONSERVATION', 'critical', k, '>=0', num(net), 'more left transit than entered it')
    else if (t && CLOSED_TRANSFER.includes(t.status) && Math.abs(net) > EPS) add('INV.TRANSFER_CONSERVATION', 'critical', k, '0', num(net), 'closed transfer still holds goods in transit')
    if (t && OPEN_TRANSFER.includes(t.status)) openByProduct.set(pid, round3((openByProduct.get(pid) ?? 0) + net))
  }
  const transitProducts = new Set<string>([...openByProduct.keys()])
  for (const id of ledger.keys()) if (id.startsWith(`${TRANSIT}__`)) transitProducts.add(id.slice(TRANSIT.length + 2))
  for (const pid of transitProducts) {
    const a = openByProduct.get(pid) ?? 0
    const b = ledger.get(key(TRANSIT, pid)) ?? 0
    if (Math.abs(a - b) > EPS) add('INV.TRANSIT_EQ_OPEN_TRANSFERS', 'critical', key(TRANSIT, pid), num(a), num(b), 'transit balance differs from open transfers')
  }

  // 7. Every stated unit rate is a positive number that leads to the product's own unit.
  for (const p of s.products) {
    for (const c of p.unitConversions ?? []) {
      const ent = `${p.id}/${c.label}`
      if (!(Number.isFinite(c.size) && c.size > 0) || (c.per !== undefined && !(Number.isFinite(c.per) && c.per > 0))) add('INV.UNIT_CONVERSION_VALID', 'critical', ent, '>0', `${num(c.size)}/${c.per === undefined ? '1' : num(c.per)}`, 'conversion rate is not a positive number')
      else if (resolveFactor(p, c.label) === null) add('INV.UNIT_CONVERSION_VALID', 'warning', ent, p.unitType, c.of ?? '', 'conversion does not resolve to the product unit')
    }
  }
  // 8. Every movement names a product and locations that exist.
  const products = new Set(s.products.map((p) => p.id))
  const locations = new Set(s.locations.map((l) => l.id))
  for (const m of s.movements) {
    if (!products.has(m.productId)) add('INV.NO_ORPHAN_LEDGER', 'warning', m.id, 'product', m.productId, 'movement names a missing product')
    for (const loc of [m.fromLocationId, m.toLocationId]) if (loc && loc !== TRANSIT && !locations.has(loc)) add('INV.NO_ORPHAN_LEDGER', 'warning', m.id, 'location', loc, 'movement names a missing location')
  }
  // 9. Reserved is between zero and what is on hand.
  for (const l of s.levels) {
    const r = l.reserved ?? 0
    if (r < -EPS || r - l.qty > EPS) add('INV.AVAILABLE_LE_ONHAND', 'critical', l.id, `0..${num(l.qty)}`, num(r), 'reserved is outside 0..on hand')
  }
  // 10. Nothing filed into a month after its count was posted, unless an admin gave a reason.
  const posted = new Map(s.closedPeriods.map((c) => [`${c.locationId}__${c.month}`, c.postedAt]))
  for (const m of live) {
    if (m.lockOverride && m.lockOverride.trim()) continue
    const month = bkkMonth(m.date)
    for (const loc of [m.fromLocationId, m.toLocationId]) {
      if (!loc || loc === TRANSIT) continue
      const at = posted.get(`${loc}__${month}`)
      if (at !== undefined && m.createdAt > at) add('INV.PERIOD_LOCK_CONSISTENT', 'critical', `${m.id}@${loc}`, `<=${at}`, String(m.createdAt), `filed into ${month} after its count was posted`)
    }
  }

  const findings = INVARIANTS.flatMap((r) => groups[r].sort(byEntity))
  const status = findings.some((f) => f.severity === 'critical') ? 'FAIL' : findings.length ? 'WARNING' : 'PASS'
  return { schema: INTEGRITY_SCHEMA, status, findings }
}
