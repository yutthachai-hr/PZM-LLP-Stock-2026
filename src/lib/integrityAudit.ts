import {
  TRANSIT_LOCATION_ID,
  type Product,
  type PurchaseOrder,
  type PurchaseRequest,
  type StockLevel,
  type StockLocation,
  type StockMovement,
  type Transfer,
} from '../types'
import { balancesFromLedger, parseLevelId } from './levelKey'
import { resolveFactor } from './inventoryRules/uom'
import { QTY_STEP, roundQty } from './validate'

/**
 * The integrity auditor (Phase 0 of the Operations OS plan, 6 Oct 2026).
 *
 * Reads a whole brand's stock data and lists every place two records that should agree do
 * not: a cached balance and the ledger, a purchase order and the receipts filed against it,
 * the transit balance and the transfers that put stock there. It only reports. Nothing here
 * writes, and nothing it finds is repaired on its own — each finding names the documents so
 * a person can decide, with the tools that already leave a trail.
 *
 * No database: it runs on a backup file (scripts/integrity-audit.mjs, zero reads) as well
 * as on what the app has loaded. Messages are plain English codes for the script and the
 * tests; a screen that shows them translates by `code`.
 */

export type AuditCategory = 'levels' | 'poReceipts' | 'transit' | 'orphans' | 'units' | 'duplicates'
export type AuditSeverity = 'critical' | 'warning' | 'info'

export interface AuditFinding {
  category: AuditCategory
  severity: AuditSeverity
  /** Stable machine name of the check, e.g. `levelDrift`. */
  code: string
  /** The document to open first. */
  ref: { collection: string; id: string; label?: string }
  /** The numbers behind it, for the report. */
  detail: Record<string, string | number>
}

export interface AuditInput {
  products: readonly Product[]
  locations: readonly StockLocation[]
  /**
   * The cached balances. Absent when the source does not have them (an older or trimmed
   * file) — then the checks that compare against them are skipped and say so, rather
   * than passing.
   */
  stockLevels?: readonly StockLevel[]
  movements: readonly StockMovement[]
  purchaseOrders: readonly PurchaseOrder[]
  purchaseRequests: readonly PurchaseRequest[]
  transfers: readonly Transfer[]
}

export interface AuditReport {
  findings: AuditFinding[]
  /** How many findings per category and severity. */
  summary: Record<AuditCategory, Record<AuditSeverity, number>>
  /** How many documents each check looked at — a clean report over nothing proves nothing. */
  scanned: Record<keyof AuditInput, number>
  /** Checks that could not run on this data, by code. */
  skipped: string[]
}

export const AUDIT_CATEGORIES: readonly AuditCategory[] = ['levels', 'poReceipts', 'transit', 'orphans', 'units', 'duplicates']

/** Transfer statuses after which nothing should be left in transit (services/transfers.ts `isOpen`). */
const CLOSED_TRANSFER = new Set(['completed', 'cancelled', 'rejected'])

const differs = (a: number, b: number) => Math.abs(a - b) >= QTY_STEP / 2

export function auditIntegrity(input: AuditInput): AuditReport {
  const out: AuditFinding[] = []
  const live = input.movements.filter((m) => !m.voided)
  const ledger = balancesFromLedger(input.movements as StockMovement[])

  const skipped: string[] = []
  if (input.stockLevels) checkLevels(input.stockLevels, ledger, out)
  else skipped.push('levelDrift', 'balanceForMissingMaster', 'legacyUnitBalance')
  checkNegative(ledger, out)
  checkPoReceipts(input, live, out)
  checkTransit(input, ledger, out)
  checkOrphans(input, live, out)
  checkUnits(input, out)
  checkDuplicates(live, out)

  const summary = Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c, { critical: 0, warning: 0, info: 0 }])) as AuditReport['summary']
  for (const f of out) summary[f.category][f.severity]++
  const rank: Record<AuditSeverity, number> = { critical: 0, warning: 1, info: 2 }
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || AUDIT_CATEGORIES.indexOf(a.category) - AUDIT_CATEGORIES.indexOf(b.category))
  return {
    findings: out,
    summary,
    skipped,
    scanned: {
      products: input.products.length,
      locations: input.locations.length,
      stockLevels: input.stockLevels?.length ?? 0,
      movements: input.movements.length,
      purchaseOrders: input.purchaseOrders.length,
      purchaseRequests: input.purchaseRequests.length,
      transfers: input.transfers.length,
    },
  }
}

/** 1. Every cached balance equals what the ledger adds up to. */
function checkLevels(levels: readonly StockLevel[], ledger: Map<string, number>, out: AuditFinding[]): void {
  const cached = new Map(levels.map((l) => [l.id, l]))
  for (const id of new Set([...ledger.keys(), ...cached.keys()])) {
    const fromLedger = ledger.get(id) ?? 0
    const stored = cached.get(id)?.qty ?? 0
    const lv = cached.get(id) as (StockLevel & { updatedBy?: string }) | undefined
    if (differs(fromLedger, stored)) {
      out.push({
        category: 'levels',
        severity: 'critical',
        code: 'levelDrift',
        ref: { collection: 'stockLevels', id },
        detail: { stored, fromLedger, diff: roundQty(stored - fromLedger), ...(lv?.updatedBy ? { lastWrittenBy: lv.updatedBy } : {}) },
      })
    }
  }
}

/** …and nothing the ledger adds up to is below zero. */
function checkNegative(ledger: Map<string, number>, out: AuditFinding[]): void {
  for (const [id, fromLedger] of ledger) {
    if (fromLedger < -QTY_STEP / 2) {
      out.push({ category: 'levels', severity: 'critical', code: 'negativeLedgerBalance', ref: { collection: 'stockLevels', id }, detail: { fromLedger } })
    }
  }
}

/** The quantity a receipt row records in the order line's unit: what was keyed, or the base qty. */
function keyedQty(m: StockMovement): number {
  return m.entryQty ?? m.qty
}

/**
 * 2. A purchase order and the stock receipts filed against it tell the same story: every
 * receipt on the order has its stock rows, every stock row naming the order is one of its
 * receipts, and the quantities match.
 */
function checkPoReceipts(input: AuditInput, live: readonly StockMovement[], out: AuditFinding[]): void {
  const byDoc = new Map<string, StockMovement[]>()
  const byPo = new Map<string, StockMovement[]>()
  for (const m of live) {
    if (m.type !== 'receive') continue
    byDoc.set(m.docNo, [...(byDoc.get(m.docNo) ?? []), m])
    if (m.poId) byPo.set(m.poId, [...(byPo.get(m.poId) ?? []), m])
  }
  const voidedDocs = new Set(input.movements.filter((m) => m.voided).map((m) => m.docNo))

  for (const po of input.purchaseOrders) {
    if (po.status === 'draft') continue
    const ref = { collection: 'purchaseOrders', id: po.id, label: po.docNo }
    const receipts = po.receipts ?? []
    // Orders received before 24 Sep 2026 name one stock document and keep no receipt list.
    const docNos = new Set(receipts.map((r) => r.docNo))
    if (!receipts.length && po.movementDocNo) docNos.add(po.movementDocNo)

    for (const r of receipts) {
      const rows = byDoc.get(r.docNo) ?? []
      if (!rows.length) {
        out.push({
          category: 'poReceipts',
          severity: 'critical',
          code: voidedDocs.has(r.docNo) ? 'receiptVoidedButOnPo' : 'receiptWithoutStock',
          ref,
          detail: { receipt: r.docNo },
        })
        continue
      }
      const onStock = new Map<string, number>()
      for (const m of rows) onStock.set(m.productId, roundQty((onStock.get(m.productId) ?? 0) + keyedQty(m)))
      const onReceipt = new Map<string, number>()
      for (const l of r.lines) onReceipt.set(l.productId, roundQty((onReceipt.get(l.productId) ?? 0) + l.qty))
      for (const pid of new Set([...onStock.keys(), ...onReceipt.keys()])) {
        const a = onReceipt.get(pid) ?? 0
        const b = onStock.get(pid) ?? 0
        if (differs(a, b)) {
          out.push({ category: 'poReceipts', severity: 'critical', code: 'receiptQtyVsStock', ref, detail: { receipt: r.docNo, productId: pid, onReceipt: a, onStock: b } })
        }
      }
    }

    // The running total on each line is the sum of the deliveries.
    if (receipts.length) {
      const fromReceipts = new Map<string, number>()
      for (const r of receipts) for (const l of r.lines) fromReceipts.set(l.productId, roundQty((fromReceipts.get(l.productId) ?? 0) + l.qty))
      const onLines = new Map<string, number>()
      for (const l of po.lines) onLines.set(l.productId, roundQty((onLines.get(l.productId) ?? 0) + (l.receivedQty ?? 0)))
      for (const pid of new Set([...fromReceipts.keys(), ...onLines.keys()])) {
        const a = onLines.get(pid) ?? 0
        const b = fromReceipts.get(pid) ?? 0
        if (differs(a, b)) {
          out.push({ category: 'poReceipts', severity: 'warning', code: 'lineTotalVsReceipts', ref, detail: { productId: pid, onLine: a, sumOfReceipts: b } })
        }
      }
    } else if (po.lines.some((l) => (l.receivedQty ?? 0) > 0) && !po.movementDocNo) {
      out.push({ category: 'poReceipts', severity: 'info', code: 'receivedWithoutStockLink', ref, detail: { status: po.status } })
    }

    // Stock that names this order but is none of its receipts: the stock went in and the
    // order was never told — the trace a half-finished receipt leaves.
    const strays = new Set((byPo.get(po.id) ?? []).filter((m) => !docNos.has(m.docNo)).map((m) => m.docNo))
    for (const docNo of strays) {
      out.push({ category: 'poReceipts', severity: 'critical', code: 'stockNotOnPo', ref, detail: { movementDocNo: docNo } })
    }
  }
}

/**
 * 3. The transit balance of each product equals what open transfers say is on the road
 * (`inTransitQty`, kept by every movement in and out of transit), and a closed transfer
 * has nothing left there.
 */
function checkTransit(input: AuditInput, ledger: Map<string, number>, out: AuditFinding[]): void {
  const owed = new Map<string, number>()
  for (const t of input.transfers) {
    for (const l of t.items) {
      if (l.removed) continue
      const q = l.inTransitQty ?? 0
      if (!q) continue
      owed.set(l.productId, roundQty((owed.get(l.productId) ?? 0) + q))
      if (CLOSED_TRANSFER.has(t.status) && q > QTY_STEP / 2) {
        out.push({
          category: 'transit',
          severity: 'warning',
          code: 'closedTransferStillInTransit',
          ref: { collection: 'transfers', id: t.id, label: t.docNo },
          detail: { status: t.status, productId: l.productId, inTransitQty: q },
        })
      }
    }
  }
  const inTransit = new Map<string, number>()
  for (const [id, qty] of ledger) {
    const k = parseLevelId(id)
    if (k.locationId !== TRANSIT_LOCATION_ID || k.unit) continue
    inTransit.set(k.productId, qty)
  }
  for (const pid of new Set([...owed.keys(), ...inTransit.keys()])) {
    const a = inTransit.get(pid) ?? 0
    const b = owed.get(pid) ?? 0
    if (differs(a, b)) {
      out.push({
        category: 'transit',
        severity: 'critical',
        code: 'transitVsTransfers',
        ref: { collection: 'stockLevels', id: `${TRANSIT_LOCATION_ID}__${pid}` },
        detail: { productId: pid, transitBalance: a, openTransfers: b },
      })
    }
  }
}

/** 4. Nothing points at a record that is not there. */
function checkOrphans(input: AuditInput, live: readonly StockMovement[], out: AuditFinding[]): void {
  const products = new Set(input.products.map((p) => p.id))
  const locations = new Set([...input.locations.map((l) => l.id), TRANSIT_LOCATION_ID])
  const orders = new Set(input.purchaseOrders.map((o) => o.id))
  const transfers = new Set(input.transfers.map((t) => t.id))
  const requests = new Map(input.purchaseRequests.map((r) => [r.id, r]))

  // One finding per missing target, not per row: a deleted product with 200 rows is one problem.
  const missing = new Map<string, AuditFinding>()
  const note = (code: string, severity: AuditSeverity, collection: string, id: string, m: StockMovement) => {
    const key = `${code}|${id}`
    const f = missing.get(key)
    if (f) f.detail.rows = (f.detail.rows as number) + 1
    else missing.set(key, { category: 'orphans', severity, code, ref: { collection, id }, detail: { rows: 1, firstMovement: m.docNo } })
  }
  for (const m of live) {
    if (!products.has(m.productId)) note('movementMissingProduct', 'warning', 'products', m.productId, m)
    for (const loc of [m.fromLocationId, m.toLocationId]) if (loc && !locations.has(loc)) note('movementMissingLocation', 'warning', 'locations', loc, m)
    if (m.poId && !orders.has(m.poId)) note('movementMissingOrder', 'warning', 'purchaseOrders', m.poId, m)
    // A transfer id that names no transfer is how a row could claim to be part of one — the
    // way around "only a manager moves stock between sites" (audit S2).
    if (m.transferId && !transfers.has(m.transferId)) note('movementMissingTransfer', 'critical', 'transfers', m.transferId, m)
  }
  out.push(...missing.values())

  for (const lv of input.stockLevels ?? []) {
    if (Math.abs(lv.qty) < QTY_STEP / 2) continue
    const k = parseLevelId(lv.id)
    if (!products.has(k.productId) || !locations.has(k.locationId)) {
      out.push({ category: 'orphans', severity: 'info', code: 'balanceForMissingMaster', ref: { collection: 'stockLevels', id: lv.id }, detail: { qty: lv.qty } })
    }
  }

  // Orders made from a request that still reads "approved": the conversion stopped halfway (audit D4).
  const stuck = new Map<string, string[]>()
  for (const o of input.purchaseOrders) {
    if (!o.requestId || o.status === 'cancelled') continue
    const r = requests.get(o.requestId)
    if (!r) continue
    if (r.status === 'approved') stuck.set(r.id, [...(stuck.get(r.id) ?? []), o.docNo])
  }
  for (const [id, docNos] of stuck) {
    out.push({ category: 'orphans', severity: 'warning', code: 'requestStuckWithOrders', ref: { collection: 'purchaseRequests', id }, detail: { orders: docNos.join(', ') } })
  }
}

/** 5. Every unit can be converted; nothing is left on an old per-unit balance unnoticed. */
function checkUnits(input: AuditInput, out: AuditFinding[]): void {
  const products = new Map(input.products.map((p) => [p.id, p]))
  for (const p of input.products) {
    for (const c of p.unitConversions ?? []) {
      if (!Number.isFinite(c.size) || c.size <= 0 || (c.per !== undefined && !(c.per > 0))) {
        out.push({ category: 'units', severity: 'critical', code: 'badConversion', ref: { collection: 'products', id: p.id, label: p.name }, detail: { unit: c.label, size: c.size, per: c.per ?? 1 } })
      } else if (resolveFactor(p, c.label) === null) {
        out.push({ category: 'units', severity: 'warning', code: 'conversionDoesNotResolve', ref: { collection: 'products', id: p.id, label: p.name }, detail: { unit: c.label } })
      }
    }
  }
  for (const lv of input.stockLevels ?? []) {
    const k = parseLevelId(lv.id)
    if (k.unit && Math.abs(lv.qty) >= QTY_STEP / 2) {
      out.push({ category: 'units', severity: 'info', code: 'legacyUnitBalance', ref: { collection: 'stockLevels', id: lv.id }, detail: { unit: k.unit, qty: lv.qty } })
    }
  }
  // An order still awaited with a line keyed in another unit and no base quantity: what is
  // incoming has to be estimated at today's rate, or cannot be counted at all (audit D12).
  for (const o of input.purchaseOrders) {
    if (o.status !== 'ordered') continue
    for (const l of o.lines) {
      if (!l.entryUnit || l.baseQty !== undefined) continue
      const p = products.get(l.productId)
      const factor = p ? resolveFactor(p, l.entryUnit) : null
      out.push({
        category: 'units',
        severity: factor === null ? 'warning' : 'info',
        code: factor === null ? 'legacyLineNoRate' : 'legacyLineEstimated',
        ref: { collection: 'purchaseOrders', id: o.id, label: o.docNo },
        detail: { productId: l.productId, unit: l.entryUnit, orderedQty: l.orderedQty, ...(factor !== null ? { rateToday: factor } : {}) },
      })
    }
  }
}

/**
 * 6. The same delivery booked twice: receipts of the same order, product and quantity on
 * the same bill under different document numbers — what a retried or doubled receipt
 * leaves behind (audit D1).
 */
function checkDuplicates(live: readonly StockMovement[], out: AuditFinding[]): void {
  const groups = new Map<string, Set<string>>()
  for (const m of live) {
    if (m.type !== 'receive' || !m.poId) continue
    const bill = (m.invoiceNo ?? '').trim().toLowerCase()
    const key = `${m.poId}|${m.productId}|${bill}|${roundQty(keyedQty(m))}`
    groups.set(key, (groups.get(key) ?? new Set()).add(m.docNo))
  }
  for (const [key, docs] of groups) {
    if (docs.size < 2) continue
    const [poId, productId, bill, qty] = key.split('|')
    out.push({
      category: 'duplicates',
      severity: bill ? 'critical' : 'warning',
      code: 'possibleDuplicateReceipt',
      ref: { collection: 'purchaseOrders', id: poId },
      detail: { productId, invoiceNo: bill || '-', qty: Number(qty), documents: [...docs].sort().join(', ') },
    })
  }
}
