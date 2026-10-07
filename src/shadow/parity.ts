import { balancesFromLedger, parseLevelId } from '../lib/levelKey'
import type { StockMovement } from '../types'
import type { BackupLike } from './backfill'
import { brandOf } from './backfill'
import { BACKUP_COLLECTION, unitKeyOf, type Entity } from './mapping'
import type { SqlClient } from './writer'

/**
 * Firestore (a backup file) against the shadow database. Read-only on both sides; nothing
 * is reconciled — a mismatch is reported with its ids and left for a person.
 *
 * Checked per entity: every Firestore id is present, nothing extra is present, and the
 * stored document is the source document (so no field was lost or altered). Then the child
 * rows (PO lines, transfer lines, receipt lines), and — the one that matters most — stock
 * balance per product × location × unit, three ways:
 *
 *   ledger (Firestore movements, the engine's own rule, src/lib/levelKey)
 *     vs ledger (the same movements summed in SQL, view stock_balance_from_ledger)   → must match;
 *   cached balances (Firestore stockLevels) vs shadow stock_balances                  → must match;
 *   cached vs ledger inside Firestore itself                                          → reported (that is the integrity auditor's finding, not the migration's).
 */

export interface EntityParity {
  name: string
  source: number
  shadow: number
  missing: string[]
  extra: string[]
  changed: string[]
  pass: boolean
}

export interface BalanceParity {
  name: string
  combinations: number
  equal: number
  mismatches: { key: string; source: number; shadow: number }[]
  pass: boolean
}

export interface ParityReport {
  source: string
  brand: string
  entities: EntityParity[]
  balances: BalanceParity[]
  /** Firestore's own cached-vs-ledger drift: information, not a migration failure. */
  sourceDrift: { key: string; cached: number; ledger: number }[]
  pass: boolean
}

const TABLE: Partial<Record<Entity, string>> = {
  locations: 'locations',
  suppliers: 'suppliers',
  products: 'products',
  supplierItems: 'supplier_products',
  productAliases: 'product_aliases',
  purchaseRequests: 'purchase_requests',
  purchaseOrders: 'purchase_orders',
  stockMovements: 'stock_movements',
  transfers: 'transfers',
}

/** Stable JSON: keys sorted, so two equal documents print the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.0005
const cap = <T>(xs: T[]) => xs.slice(0, 50)

export async function checkParity(db: SqlClient, backup: BackupLike): Promise<ParityReport> {
  const brand = brandOf(backup)
  const entities: EntityParity[] = []

  for (const [entity, table] of Object.entries(TABLE) as [Entity, string][]) {
    const src = (backup.data[BACKUP_COLLECTION[entity]] ?? []).filter((d) => d && d.id !== undefined && d.id !== '')
    const rows = (await db.query<{ id: string; doc: unknown }>(`select id, doc from shadow.${table} where brand = $1`, [brand])).rows
    const held = new Map(rows.map((r) => [r.id, typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc]))
    const srcIds = new Set(src.map((d) => String(d.id)))
    const missing = [...srcIds].filter((id) => !held.has(id))
    const extra = [...held.keys()].filter((id) => !srcIds.has(id))
    const changed = src.filter((d) => held.has(String(d.id)) && stable(held.get(String(d.id))) !== stable(d)).map((d) => String(d.id))
    entities.push({ name: table, source: src.length, shadow: rows.length, missing: cap(missing), extra: cap(extra), changed: cap(changed), pass: !missing.length && !extra.length && !changed.length })
  }

  // Child rows.
  const pos = backup.data.purchaseOrders ?? []
  const poLines = new Map<string, number[]>()
  for (const o of pos) (o.lines as Record<string, unknown>[] | undefined)?.forEach((l, i) => poLines.set(`${o.id}#${i}`, [Number(l.orderedQty ?? 0), Number(l.receivedQty ?? 0)]))
  const dbPoLines = (await db.query<{ po_id: string; line_no: number; ordered_qty: string; received_qty: string }>(`select po_id, line_no, ordered_qty, received_qty from shadow.purchase_order_lines where brand = $1`, [brand])).rows
  entities.push(childParity('purchase_order_lines', poLines, new Map(dbPoLines.map((r) => [`${r.po_id}#${r.line_no}`, [Number(r.ordered_qty), Number(r.received_qty)]]))))

  const trs = backup.data.transfers ?? []
  const trLines = new Map<string, number[]>()
  for (const t of trs) (t.items as Record<string, unknown>[] | undefined)?.forEach((l, i) => trLines.set(`${t.id}#${Number(l.idx ?? i)}`, [Number(l.dispatchQty ?? 0), Number(l.inTransitQty ?? 0)]))
  const dbTrLines = (await db.query<{ transfer_id: string; line_no: number; dispatch_qty: string; in_transit_qty: string }>(`select transfer_id, line_no, dispatch_qty, in_transit_qty from shadow.transfer_lines where brand = $1`, [brand])).rows
  entities.push(childParity('transfer_lines', trLines, new Map(dbTrLines.map((r) => [`${r.transfer_id}#${r.line_no}`, [Number(r.dispatch_qty), Number(r.in_transit_qty)]]))))

  const movements = (backup.data.stockMovements ?? []) as unknown as StockMovement[]
  const receiveRows = movements.filter((m) => m.type === 'receive')
  const rcLines = new Map(receiveRows.map((m) => [`${m.docNo}#${m.id}`, [Number(m.qty)]]))
  const dbRcLines = (await db.query<{ doc_no: string; movement_id: string; qty_base: string }>(`select doc_no, movement_id, qty_base from shadow.receipt_lines where brand = $1`, [brand])).rows
  entities.push(childParity('receipt_lines', rcLines, new Map(dbRcLines.map((r) => [`${r.doc_no}#${r.movement_id}`, [Number(r.qty_base)]]))))

  const docNos = new Set(receiveRows.map((m) => m.docNo))
  for (const o of pos) {
    for (const r of (o.receipts as { docNo?: string }[] | undefined) ?? []) if (r.docNo) docNos.add(r.docNo)
    if (!(o.receipts as unknown[] | undefined)?.length && typeof o.movementDocNo === 'string') docNos.add(o.movementDocNo)
  }
  const dbReceipts = new Set((await db.query<{ doc_no: string }>(`select doc_no from shadow.receipts where brand = $1`, [brand])).rows.map((r) => r.doc_no))
  entities.push({
    name: 'receipts',
    source: docNos.size,
    shadow: dbReceipts.size,
    missing: cap([...docNos].filter((d) => !dbReceipts.has(d))),
    extra: cap([...dbReceipts].filter((d) => !docNos.has(d))),
    changed: [],
    pass: [...docNos].every((d) => dbReceipts.has(d)) && [...dbReceipts].every((d) => docNos.has(d)),
  })

  // Stock balance per product × location × unit.
  const key = (loc: string, prod: string, unit: string) => `${loc}__${prod}${unit ? `#${unit}` : ''}`
  const fromLedger = balancesFromLedger(movements)
  const sqlLedger = new Map(
    (await db.query<{ location_id: string; product_id: string; unit_key: string; qty: string }>(`select location_id, product_id, unit_key, qty from shadow.stock_balance_from_ledger where brand = $1`, [brand])).rows.map((r) => [
      key(r.location_id, r.product_id, r.unit_key),
      Number(r.qty),
    ]),
  )
  const ledgerKeys = new Map<string, number>()
  for (const [id, qty] of fromLedger) {
    const p = parseLevelId(id)
    ledgerKeys.set(key(p.locationId, p.productId, p.unit ?? ''), qty)
  }
  const balances = [balanceParity('stock_balance (ledger: Firestore rule vs SQL)', ledgerKeys, sqlLedger)]

  const cached = new Map<string, number>()
  for (const l of backup.data.stockLevels ?? []) cached.set(key(String(l.locationId), String(l.productId), unitKeyOf(String(l.id))), Number(l.qty ?? 0))
  const dbCached = new Map(
    (await db.query<{ location_id: string; product_id: string; unit_key: string; qty: string }>(`select location_id, product_id, unit_key, qty from shadow.stock_balances where brand = $1`, [brand])).rows.map((r) => [
      key(r.location_id, r.product_id, r.unit_key),
      Number(r.qty),
    ]),
  )
  balances.push(balanceParity('stock_balance (cached: stockLevels vs shadow)', cached, dbCached))

  const sourceDrift: ParityReport['sourceDrift'] = []
  for (const k of new Set([...cached.keys(), ...ledgerKeys.keys()])) {
    const c = cached.get(k) ?? 0
    const l = ledgerKeys.get(k) ?? 0
    if (!close(c, l)) sourceDrift.push({ key: k, cached: c, ledger: l })
  }

  return {
    source: `backup:${brand}:${backup.createdAt}`,
    brand,
    entities,
    balances,
    sourceDrift: cap(sourceDrift),
    pass: entities.every((e) => e.pass) && balances.every((b) => b.pass),
  }
}

function childParity(name: string, src: Map<string, number[]>, shadow: Map<string, number[]>): EntityParity {
  const missing = [...src.keys()].filter((k) => !shadow.has(k))
  const extra = [...shadow.keys()].filter((k) => !src.has(k))
  const changed = [...src.keys()].filter((k) => shadow.has(k) && src.get(k)!.some((v, i) => !close(v, shadow.get(k)![i])))
  return { name, source: src.size, shadow: shadow.size, missing: cap(missing), extra: cap(extra), changed: cap(changed), pass: !missing.length && !extra.length && !changed.length }
}

function balanceParity(name: string, a: Map<string, number>, b: Map<string, number>): BalanceParity {
  const keys = new Set([...a.keys(), ...b.keys()])
  const mismatches: BalanceParity['mismatches'] = []
  for (const k of keys) {
    const x = a.get(k) ?? 0
    const y = b.get(k) ?? 0
    if (!close(x, y)) mismatches.push({ key: k, source: x, shadow: y })
  }
  return { name, combinations: keys.size, equal: keys.size - mismatches.length, mismatches: cap(mismatches), pass: mismatches.length === 0 }
}

/** The report as the owner asked to read it. */
export function formatParity(r: ParityReport): string {
  const lines = [`PARITY ${r.brand} (${r.source}) — ${r.pass ? 'PASS' : 'FAIL'}`, '']
  for (const e of r.entities) {
    lines.push(`${e.name}: ${e.shadow} / ${e.source} ${e.pass ? 'PASS' : 'FAIL'}`)
    if (e.missing.length) lines.push(`  missing: ${e.missing.join(', ')}`)
    if (e.extra.length) lines.push(`  extra: ${e.extra.join(', ')}`)
    if (e.changed.length) lines.push(`  changed: ${e.changed.join(', ')}`)
  }
  lines.push('')
  for (const b of r.balances) {
    lines.push(`${b.name}:`, `  ${b.combinations} combinations`, `  ${b.equal} equal`, `  ${b.mismatches.length} mismatches ${b.pass ? 'PASS' : 'FAIL'}`)
    for (const m of b.mismatches) lines.push(`    ${m.key}: source ${m.source} vs shadow ${m.shadow}`)
  }
  lines.push('', `Firestore's own cached-vs-ledger drift (not a migration failure): ${r.sourceDrift.length}`)
  for (const d of r.sourceDrift) lines.push(`  ${d.key}: cached ${d.cached} vs ledger ${d.ledger}`)
  return lines.join('\n')
}
