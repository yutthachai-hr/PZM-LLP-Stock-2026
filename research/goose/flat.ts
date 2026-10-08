/**
 * R&D (Goose evaluation, 8 Oct 2026). NOT on any app path.
 *
 * `pzm-integrity-flat/1`: the `pzm-integrity/1` snapshot (src/agent/integrityReference.ts),
 * re-encoded so that a program without a JSON reader — the Goose prototype — reads EXACTLY
 * what the Rust engine reads from the JSON:
 *
 *   - one record per line, fields separated by TAB, first field the record type;
 *   - numbers as the 16 hex digits of their IEEE-754 bits (no decimal parsing anywhere, so
 *     no rounding can differ); JSON `null` (a NaN rate in the vectors) is NaN, as in Rust;
 *   - optional strings as "" when absent and "=" + text when present, because the reference
 *     tells absent from empty (`m.poId === o.id`);
 *   - text escaped: \\ \t \n \r.
 *
 *   S                              start of a snapshot
 *   P  id unitType                 product
 *   C  label size per? of?         a conversion of the last P (per/of optional)
 *   L  id                          location
 *   V  id qty reserved?            level
 *   M  id productId qty from? to? date createdAt voided operationId? poId? transferId? lockOverride?
 *   O  id status locationId        order
 *   I  productId receivedQty       a line of the last O
 *   T  id status from to           transfer
 *   K  locationId month postedAt   closed period
 *   E                              end of the snapshot
 *
 * The input is taken as `JSON.parse(JSON.stringify(snapshot))` — what the Rust CLI is handed —
 * and anything the contract cannot carry exactly is refused (an Error), never approximated.
 */
import type { IntegritySnapshot } from '../../src/agent/integrityReference'

export const FLAT_SCHEMA = 'pzm-integrity-flat/1'

const buf = new DataView(new ArrayBuffer(8))
function bits(n: unknown): string {
  const v = n === null ? NaN : n
  if (typeof v !== 'number') throw new Error(`not a number: ${JSON.stringify(n)}`)
  buf.setFloat64(0, v)
  return buf.getBigUint64(0).toString(16).padStart(16, '0')
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
function str(s: unknown): string {
  if (typeof s !== 'string') throw new Error(`not a string: ${JSON.stringify(s)}`)
  return esc(s)
}
const opt = (s: unknown) => (s === undefined ? '' : `=${str(s)}`)
const optNum = (n: unknown) => (n === undefined ? '' : `=${bits(n)}`)

/** One snapshot as flat lines (with S … E). Throws on anything outside the contract. */
export function flatten(snapshot: IntegritySnapshot): string {
  const s = JSON.parse(JSON.stringify(snapshot)) as IntegritySnapshot
  if (s.schema !== 'pzm-integrity/1') throw new Error(`schema ${String(s.schema)}`)
  const out: string[] = ['S']
  const row = (...f: string[]) => out.push(f.join('\t'))
  for (const p of s.products) {
    row('P', str(p.id), str(p.unitType))
    for (const c of p.unitConversions ?? []) row('C', str(c.label), bits(c.size), optNum(c.per), opt(c.of))
  }
  for (const l of s.locations) row('L', str(l.id))
  for (const v of s.levels) row('V', str(v.id), bits(v.qty), optNum(v.reserved))
  for (const m of s.movements)
    row('M', str(m.id), str(m.productId), bits(m.qty), opt(m.fromLocationId), opt(m.toLocationId), bits(m.date), bits(m.createdAt), m.voided ? '1' : '0', opt(m.operationId), opt(m.poId), opt(m.transferId), opt(m.lockOverride))
  for (const o of s.orders) {
    row('O', str(o.id), str(o.status), str(o.locationId))
    for (const l of o.lines) row('I', str(l.productId), bits(l.receivedQty))
  }
  for (const t of s.transfers) row('T', str(t.id), str(t.status), str(t.fromLocationId), str(t.toLocationId))
  for (const c of s.closedPeriods) row('K', str(c.locationId), str(c.month), bits(c.postedAt))
  out.push('E')
  return out.join('\n') + '\n'
}
