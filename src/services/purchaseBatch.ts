import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { entryUnitsFor } from '../components/QtyInput'
import type { OrderBlock } from '../lib/orderSheet'
import { buildMatchIndex, matchProduct, type MatchIndex, type ProductAlias } from '../lib/productMatch'
import { sameUnit } from '../lib/units'
import { startOfDay } from '../lib/format'
import { shownUnit } from '../lib/ledger'
import { approvePurchaseOrder, createPurchaseOrder, deletePurchaseOrder } from './purchaseOrders'
import {
  COL,
  type BatchGroup,
  type BatchHistoryEntry,
  type BatchIssue,
  type BatchRow,
  type Product,
  type PurchaseBatch,
  type PurchaseBatchStatus,
  type PurchaseOrder,
  type Supplier,
  type SupplierItem,
} from '../types'

/**
 * An imported order list, from the workbook to a set of draft orders.
 *
 * ## The one rule
 *
 * Nothing in here decides a supplier. A row reaches an order only through a product whose
 * supplier the catalogue names, or through a person choosing on the review screen. Where the
 * app is not sure — two products with the same name, a name it has never seen, a word in the
 * quantity column — the row is marked for review and stays out of every order until somebody
 * settles it. Ordering the wrong thing from the wrong company is the failure this whole
 * screen exists to prevent, and a question costs a few seconds.
 *
 * ## Reads
 *
 * An import reads the alias list, the supplier list, the price rows and ninety days of
 * orders, once, when the file is chosen — a few hundred documents for a job done once or
 * twice a week. Batches themselves are read on demand by the screens that show them; nothing
 * here is subscribed.
 */

const MAX_ROWS = 300
const MAX_GROUPS = 60
const MAX_HISTORY = 500

/** How far back to look when asking whether a quantity is unusual. */
export const HISTORY_DAYS = 90

function scoped() {
  return backend.forBrand(getBrand())
}

// ---------------------------------------------------------------- units ----

/**
 * The spellings the workbook uses for units the app already has.
 *
 * Only spellings that mean exactly one thing. "ลัง" is not here: a case is a unit in its
 * own right on the owner's list, and it is a different size on every product.
 */
const UNIT_SYNONYMS: Record<string, string> = {
  'กก': 'KG',
  'กก.': 'KG',
  'ก.ก.': 'KG',
  'กิโล': 'KG',
  'กิโลกรัม': 'KG',
  'kgs': 'KG',
  'kg.': 'KG',
  'แพ็ค': 'Pack',
  'แพค': 'Pack',
  'แพ็ก': 'Pack',
  'pk': 'Pack',
  'pcs': 'EA',
  'pc': 'EA',
  'ชิ้น': 'EA',
  'อัน': 'EA',
  'ea.': 'EA',
  'ลิตร': 'L',
  'lt': 'L',
  'ltr': 'L',
  'l.': 'L',
}

/** A workbook unit as the app would spell it, or itself when it has no known spelling. */
export function canonicalUnit(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  return UNIT_SYNONYMS[s.toLowerCase()] ?? s
}

/**
 * The unit a row is ordered in, given what the workbook said and what the product allows.
 *
 * Returns the product's own unit (recorded as no entryUnit) when the workbook agrees with it
 * or says nothing; one of the product's other units when the workbook names it; and null
 * when the workbook names a unit this product has never been keyed in — which is a question
 * for a person, because "5 Pack" of something the app counts by the kilogram is exactly the
 * mistake the manual screen warns about in red.
 */
export function resolveUnit(
  rawUnit: string,
  product: Product,
  plainUnits: readonly string[] | undefined,
): { entryUnit?: string } | null {
  const wanted = canonicalUnit(rawUnit)
  if (!wanted || sameUnit(wanted, product.unitType)) return {}
  const allowed = entryUnitsFor(product.unitType, plainUnits, product.unitConversions)
  const hit = allowed.find((u) => sameUnit(u.label, wanted) || sameUnit(u.records, wanted))
  // A unit that converts (grams into kilograms) would need the quantity multiplied, and
  // this reads quantities as written — so it is a question, not a silent ×0.001.
  if (!hit || hit.factor !== 1) return null
  return sameUnit(hit.records, product.unitType) ? {} : { entryUnit: hit.records }
}

// ---------------------------------------------------------------- building rows ----

export interface AssessContext {
  products: readonly Product[]
  suppliers: readonly Supplier[]
  supplierItems: readonly SupplierItem[]
  /** Orders placed in the last HISTORY_DAYS, for the "is this usual" question. */
  recentOrders: readonly PurchaseOrder[]
  /** The owner's unit list from Settings, when loaded. */
  plainUnits?: readonly string[]
  /** Today, for the same-day duplicate check. */
  now?: number
}

/**
 * The rows of a block as they first land in a batch: matched where that can be done
 * without guessing, and nothing more. Rows the workbook marks as "not this week" (a dash,
 * blank, zero) are not rows at all.
 */
export function buildBatchRows(
  block: OrderBlock,
  products: readonly Product[],
  aliases: readonly ProductAlias[],
): BatchRow[] {
  const index = buildMatchIndex(products, aliases)
  const out: BatchRow[] = []
  for (const r of block.rows) {
    if (r.qtyState === 'none') continue
    out.push(
      settleRow(
        {
          idx: out.length,
          excelRow: r.excelRow,
          rawName: r.name,
          rawUnit: r.unit,
          rawQty: r.rawQty,
          ...(r.note ? { note: r.note } : {}),
          ...(r.qty !== null ? { qty: r.qty } : {}),
          issues: [],
        },
        index,
      ),
    )
    if (out.length >= MAX_ROWS) break
  }
  return out
}

/** Attach the matched product to a fresh row, or the kind of question it raises. */
function settleRow(row: BatchRow, index: MatchIndex): BatchRow {
  const m = matchProduct(row.rawName, index)
  if (m.product) {
    return {
      ...row,
      matchKind: m.kind === 'alias' ? 'alias' : 'exact',
      productId: m.product.id,
      productName: m.product.name,
      unit: m.product.unitType,
      ...(m.product.supplierId ? { supplierId: m.product.supplierId } : {}),
    }
  }
  return { ...row, matchKind: m.kind === 'ambiguous' ? 'ambiguous' : 'none' }
}

// ---------------------------------------------------------------- assessing ----

function issue(code: BatchIssue['code'], severity: BatchIssue['severity'], detail?: string): BatchIssue {
  return { code, severity, ...(detail ? { detail } : {}) }
}

/** The most an order may exceed the largest recent one before the review asks about it. */
const SUSPICIOUS_FACTOR = 3
/** How many past orders it takes before "usual" means anything. */
const SUSPICIOUS_MIN_HISTORY = 3

/**
 * Every issue on every row, recomputed from what the rows say now and what the catalogue
 * says now.
 *
 * Pure. Called when the batch is built, and again every time a person settles a row, so an
 * issue that has been dealt with disappears and one that a change created appears. The
 * person's own decisions — the product they picked, the supplier, the quantity they typed,
 * a row they skipped, a warning they accepted — are read from the row and never rewritten.
 */
export function assessRows(rows: readonly BatchRow[], ctx: AssessContext): BatchRow[] {
  const productById = new Map(ctx.products.map((p) => [p.id, p]))
  const supplierById = new Map(ctx.suppliers.map((s) => [s.id, s]))
  const moq = new Map(
    ctx.supplierItems
      .filter((i) => i.minOrderQty !== undefined)
      .map((i) => [`${i.supplierId}/${i.productId}`, i.minOrderQty!]),
  )
  const today = startOfDay(ctx.now ?? Date.now())

  // Recent quantities per product, in the unit they were ordered in.
  const history = new Map<string, number[]>()
  const orderedToday = new Map<string, PurchaseOrder>()
  for (const o of ctx.recentOrders) {
    for (const l of o.lines) {
      const key = `${l.productId}|${shownUnit(l)}`
      history.set(key, [...(history.get(key) ?? []), l.orderedQty])
      if (o.orderedAt >= today && o.status !== 'draft') orderedToday.set(`${o.supplierId}/${l.productId}`, o)
    }
  }

  const seen = new Map<string, number>()
  return rows.map((row) => {
    const issues: BatchIssue[] = []
    if (row.skipped) return { ...row, issues }

    const product = row.productId ? productById.get(row.productId) : undefined
    if (!product) {
      issues.push(issue(row.matchKind === 'ambiguous' ? 'ambiguousProduct' : 'unknownProduct', 'review'))
      return { ...row, issues }
    }
    if (!product.active) issues.push(issue('productInactive', 'block'))

    const supplier = row.supplierId ? supplierById.get(row.supplierId) : undefined
    if (!supplier) issues.push(issue('noSupplier', 'review'))
    else if (supplier.active === false) issues.push(issue('supplierInactive', 'block', supplier.name))

    if (row.qty === undefined || !(row.qty > 0)) issues.push(issue('qtyUnclear', 'review', row.rawQty))

    const unit = resolveUnit(row.rawUnit, product, ctx.plainUnits)
    let entryUnit = row.entryUnit
    if (unit === null && !row.entryUnit && row.matchKind !== 'manual') {
      issues.push(issue('unitMismatch', 'review', row.rawUnit))
    } else if (unit && !row.entryUnit && row.matchKind !== 'manual') {
      entryUnit = unit.entryUnit
    }

    const dupKey = `${product.id}|${entryUnit ?? ''}`
    const first = seen.get(dupKey)
    if (first !== undefined) issues.push(issue('duplicateProduct', 'review', String(rows[first].excelRow)))
    else seen.set(dupKey, row.idx)

    if (supplier && row.qty !== undefined) {
      const min = moq.get(`${supplier.id}/${product.id}`)
      if (min !== undefined && row.qty < min) issues.push(issue('belowMoq', 'warn', String(min)))

      const past = history.get(`${product.id}|${entryUnit ?? product.unitType}`) ?? []
      if (past.length >= SUSPICIOUS_MIN_HISTORY) {
        const max = Math.max(...past)
        if (row.qty > max * SUSPICIOUS_FACTOR) {
          issues.push(issue('suspiciousQty', 'warn', `${Math.min(...past)}–${max}`))
        }
      }

      const dup = orderedToday.get(`${supplier.id}/${product.id}`)
      if (dup) issues.push(issue('possibleDuplicateOrder', 'warn', dup.docNo))
    }

    return {
      ...row,
      productName: product.name,
      unit: product.unitType,
      ...(entryUnit ? { entryUnit } : {}),
      ...(supplier ? { supplierName: supplier.name } : {}),
      issues,
    }
  })
}

export type RowState = 'skipped' | 'blocked' | 'review' | 'ready'

/** What a row needs before it can be ordered, in one word. */
export function rowState(row: BatchRow): RowState {
  if (row.skipped) return 'skipped'
  if (row.issues.some((i) => i.severity === 'block')) return 'blocked'
  if (row.issues.some((i) => i.severity === 'review')) return 'review'
  if (!row.confirmed && row.issues.some((i) => i.severity === 'warn')) return 'review'
  return 'ready'
}

/**
 * The rows with a supplier, gathered by supplier. Rows still waiting on a person are not in
 * any group — they have no supplier to be grouped under, or the group would be built on a
 * guess. Existing groups keep their order id when the supplier still has rows.
 */
export function groupRows(rows: readonly BatchRow[], previous: readonly BatchGroup[] = []): BatchGroup[] {
  const kept = new Map(previous.map((g) => [g.supplierId, g]))
  const out = new Map<string, BatchGroup>()
  for (const r of rows) {
    if (r.skipped || !r.supplierId) continue
    const g = out.get(r.supplierId) ?? {
      supplierId: r.supplierId,
      supplierName: r.supplierName ?? '',
      rowIdx: [],
      ...(kept.get(r.supplierId)?.poId ? { poId: kept.get(r.supplierId)!.poId, docNo: kept.get(r.supplierId)!.docNo } : {}),
    }
    g.rowIdx.push(r.idx)
    out.set(r.supplierId, g)
  }
  return [...out.values()].slice(0, MAX_GROUPS)
}

export type GroupState = 'blocked' | 'review' | 'ready' | 'ordered'

export function groupState(group: BatchGroup, rows: readonly BatchRow[]): GroupState {
  if (group.poId) return 'ordered'
  const states = group.rowIdx.map((i) => rowState(rows[i]))
  if (states.includes('blocked')) return 'blocked'
  if (states.includes('review')) return 'review'
  return 'ready'
}

/** The status the batch's own rows and groups say it has, before anyone approves it. */
export function derivedStatus(batch: Pick<PurchaseBatch, 'rows' | 'groups' | 'status'>): PurchaseBatchStatus {
  if (['approved', 'sending', 'completed', 'cancelled'].includes(batch.status)) return batch.status
  const orphan = batch.rows.some((r) => !r.skipped && !r.supplierId)
  const states = batch.groups.map((g) => groupState(g, batch.rows))
  if (orphan || states.some((s) => s === 'blocked' || s === 'review')) return 'needsReview'
  if (batch.groups.length === 0) return 'draft'
  return 'ready'
}

// ---------------------------------------------------------------- persistence ----

/** SHA-256 of the file, as hex. */
export async function hashFile(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export function batchCounterId(ms: number): string {
  return `purchaseBatch__${dayKey(ms)}`
}

export function makeBatchNo(ms: number, seq: number): string {
  return `PB-${dayKey(ms)}-${String(seq).padStart(3, '0')}`
}

/** A batch already made from this exact file, if there is one. */
export async function findBatchesByHash(fileHash: string): Promise<PurchaseBatch[]> {
  return scoped().getBy<PurchaseBatch>(COL.purchaseBatches, 'fileHash', fileHash)
}

export async function getBatch(id: string): Promise<PurchaseBatch | null> {
  return scoped().getOne<PurchaseBatch>(COL.purchaseBatches, id)
}

/** Batches created in a window, newest first. */
export async function listBatchesInRange(from: number, to: number): Promise<PurchaseBatch[]> {
  const rows = await scoped().getRange<PurchaseBatch>(COL.purchaseBatches, 'createdAt', from, to)
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

function entry(actor: { id: string; name: string }, action: string, detail?: string): BatchHistoryEntry {
  return { at: Date.now(), by: actor.id, byName: actor.name, action, ...(detail ? { detail } : {}) }
}

export async function createBatch(params: {
  locationId: string
  sourceFileName: string
  fileHash: string
  sheetName: string
  blockLabel: string
  blockDate?: number | null
  mapping?: PurchaseBatch['mapping']
  rows: BatchRow[]
  actor: { id: string; name: string }
}): Promise<PurchaseBatch> {
  if (!params.locationId) throw new AppError('กรุณาเลือกคลังปลายทาง')
  if (params.rows.length === 0) throw new AppError('ไม่มีรายการที่จะสั่งในไฟล์นี้')
  if (params.rows.length > MAX_ROWS) {
    throw new AppError('นำเข้าได้สูงสุด {max} รายการต่อครั้ง', { max: MAX_ROWS })
  }
  const db = scoped()
  const now = Date.now()
  const groups = groupRows(params.rows)
  const draft: Omit<PurchaseBatch, 'id' | 'batchNo'> = {
    locationId: params.locationId,
    sourceFileName: params.sourceFileName.slice(0, 200),
    fileHash: params.fileHash,
    sheetName: params.sheetName.slice(0, 200),
    blockLabel: params.blockLabel.slice(0, 200),
    ...(params.blockDate ? { blockDate: params.blockDate } : {}),
    ...(params.mapping ? { mapping: params.mapping } : {}),
    status: 'draft',
    rows: params.rows,
    groups,
    history: [entry(params.actor, 'imported', params.sourceFileName)],
    createdBy: params.actor.id,
    createdByName: params.actor.name,
    createdAt: now,
    updatedAt: now,
  }
  draft.status = derivedStatus(draft)
  return db.transaction(async (tx) => {
    const counter = await tx.get<{ value: number }>(COL.counters, batchCounterId(now))
    const seq = (counter?.value ?? 0) + 1
    tx.set(COL.counters, batchCounterId(now), { value: seq })
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
    const batchNo = makeBatchNo(now, seq)
    tx.set(COL.purchaseBatches, id, { ...draft, batchNo })
    return { ...draft, id, batchNo }
  })
}

/**
 * Write the rows back after a person settled some of them, re-grouped and re-assessed,
 * with a line in the history saying what they did.
 *
 * Read-modify-write inside a transaction so two people resolving different rows of the same
 * batch do not overwrite each other's work with a stale copy.
 */
export async function saveRows(params: {
  batchId: string
  rows: readonly BatchRow[]
  ctx: AssessContext
  actor: { id: string; name: string }
  action: string
  detail?: string
}): Promise<PurchaseBatch> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<PurchaseBatch>(COL.purchaseBatches, params.batchId)
    if (!cur) throw new AppError('ไม่พบชุดนำเข้านี้')
    if (['approved', 'sending', 'completed', 'cancelled'].includes(cur.status)) {
      throw new AppError('ชุดนี้อนุมัติแล้ว แก้ไขรายการไม่ได้')
    }
    const rows = assessRows(params.rows, params.ctx)
    const groups = groupRows(rows, cur.groups)
    const next: PurchaseBatch = {
      ...cur,
      rows,
      groups,
      history: [...cur.history, entry(params.actor, params.action, params.detail)].slice(-MAX_HISTORY),
      updatedAt: Date.now(),
    }
    next.status = derivedStatus(next)
    const { id, ...data } = next
    tx.set(COL.purchaseBatches, id, data)
    return next
  })
}

/** Note something that happened, without touching the rows. */
export async function appendHistory(
  batchId: string,
  actor: { id: string; name: string },
  action: string,
  detail?: string,
  patch: Partial<Pick<PurchaseBatch, 'status' | 'groups'>> = {},
): Promise<PurchaseBatch> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<PurchaseBatch>(COL.purchaseBatches, batchId)
    if (!cur) throw new AppError('ไม่พบชุดนำเข้านี้')
    const next: PurchaseBatch = {
      ...cur,
      ...patch,
      history: [...cur.history, entry(actor, action, detail)].slice(-MAX_HISTORY),
      updatedAt: Date.now(),
    }
    const { id, ...data } = next
    tx.set(COL.purchaseBatches, id, data)
    return next
  })
}

export async function cancelBatch(batchId: string, actor: { id: string; name: string }): Promise<void> {
  const cur = await getBatch(batchId)
  if (!cur) throw new AppError('ไม่พบชุดนำเข้านี้')
  if (cur.status === 'completed') throw new AppError('ชุดนี้ส่งครบแล้ว ยกเลิกไม่ได้')
  await appendHistory(batchId, actor, 'cancelled', undefined, { status: 'cancelled' })
}

// ---------------------------------------------------------------- draft orders ----

/** What a group's rows would put on an order, for telling whether a draft is still right. */
function linesOf(batch: PurchaseBatch, group: BatchGroup) {
  return group.rowIdx
    .map((i) => batch.rows[i])
    .filter((r) => !r.skipped && r.productId && r.qty !== undefined && r.qty > 0)
    .map((r) => ({ productId: r.productId!, qty: r.qty!, ...(r.entryUnit ? { entryUnit: r.entryUnit } : {}) }))
}

function sameLines(a: PurchaseOrder['lines'], b: ReturnType<typeof linesOf>): boolean {
  if (a.length !== b.length) return false
  return a.every((l, i) => {
    const m = b[i]
    return l.productId === m.productId && l.orderedQty === m.qty && (l.entryUnit ?? '') === (m.entryUnit ?? '')
  })
}

/**
 * A draft order for every group that is ready, and none for any that is not.
 *
 * Drafts are proposals, so they follow the rows: a group whose rows changed since its draft
 * was written gets a fresh draft and the stale one is deleted, and a group that no longer
 * exists loses its draft. Only drafts are touched — an approved order is a promise and is
 * never rewritten here. Uses the same `createPurchaseOrder` as the manual screen, so the
 * numbering and the line checks are the ones every order gets.
 */
export async function ensureDraftOrders(params: {
  batchId: string
  products: readonly Product[]
  actor: { id: string; name: string }
}): Promise<PurchaseBatch> {
  const db = scoped()
  const batch = await getBatch(params.batchId)
  if (!batch) throw new AppError('ไม่พบชุดนำเข้านี้')
  if (['completed', 'cancelled'].includes(batch.status)) return batch

  const mine = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'batchId', batch.id)
  const byId = new Map(mine.map((o) => [o.id, o]))
  const groups: BatchGroup[] = []
  const notes: string[] = []
  for (const g of batch.groups) {
    const state = groupState({ ...g, poId: undefined }, batch.rows)
    const existing = g.poId ? byId.get(g.poId) : undefined
    const wanted = linesOf(batch, g)
    if (existing && existing.status !== 'draft') {
      groups.push(g) // placed; leave it alone whatever the rows now say
      continue
    }
    if (existing && state === 'ready' && sameLines(existing.lines, wanted)) {
      groups.push(g)
      continue
    }
    if (existing) {
      await deletePurchaseOrder(existing.id)
      byId.delete(existing.id)
      notes.push(`${existing.docNo} ✕`)
    }
    if (state !== 'ready' || wanted.length === 0) {
      groups.push({ supplierId: g.supplierId, supplierName: g.supplierName, rowIdx: g.rowIdx })
      continue
    }
    const poId = await createPurchaseOrder({
      supplier: { id: g.supplierId, name: g.supplierName },
      locationId: batch.locationId,
      lines: wanted,
      products: params.products,
      actor: params.actor,
      batchId: batch.id,
    })
    const created = await db.getOne<PurchaseOrder>(COL.purchaseOrders, poId)
    groups.push({ ...g, poId, docNo: created?.docNo })
    notes.push(`${g.supplierName}: ${created?.docNo ?? ''}`)
  }
  // Drafts for suppliers that have since left the batch.
  const referenced = new Set(groups.map((g) => g.poId).filter(Boolean))
  for (const o of byId.values()) {
    if (o.status === 'draft' && !referenced.has(o.id)) {
      await deletePurchaseOrder(o.id)
      notes.push(`${o.docNo} ✕`)
    }
  }
  if (notes.length === 0) return { ...batch, groups }
  return appendHistory(batch.id, params.actor, 'poGenerated', notes.join(', '), { groups })
}

/**
 * Approve the drafts of every group that is ready — or of one group — and, once every
 * group in the batch has a placed order and no row is still waiting on a person, mark the
 * batch approved. A batch with a row nobody has settled stays at needsReview, with the
 * groups that were approved approved: one unknown product should not hold up the other
 * seven suppliers.
 */
export async function approveBatch(params: {
  batchId: string
  products: readonly Product[]
  actor: { id: string; name: string }
  /** Only this supplier's group; everything ready when absent. */
  supplierId?: string
}): Promise<PurchaseBatch> {
  const db = scoped()
  const batch = await ensureDraftOrders(params)
  if (['completed', 'cancelled'].includes(batch.status)) return batch
  const approved: string[] = []
  for (const g of batch.groups) {
    if (params.supplierId && g.supplierId !== params.supplierId) continue
    if (!g.poId) continue
    const order = await db.getOne<PurchaseOrder>(COL.purchaseOrders, g.poId)
    if (!order || order.status !== 'draft') continue
    await approvePurchaseOrder(g.poId, params.actor)
    approved.push(g.docNo ?? g.poId)
  }
  const orders = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'batchId', batch.id)
  const placed = new Set(orders.filter((o) => o.status !== 'draft').map((o) => o.id))
  const allPlaced = batch.groups.length > 0 && batch.groups.every((g) => g.poId && placed.has(g.poId))
  const orphan = batch.rows.some((r) => !r.skipped && !r.supplierId)
  const status: PurchaseBatchStatus = allPlaced && !orphan ? 'approved' : batch.status
  if (approved.length === 0 && status === batch.status) return batch
  return appendHistory(batch.id, params.actor, 'approved', approved.join(', '), { status })
}

/**
 * Where the batch stands after a sheet was sent or skipped: `sending` while any placed
 * order is still unsent, `completed` once every one has been sent or deliberately skipped.
 */
export async function settleSendStatus(batchId: string, actor: { id: string; name: string }): Promise<PurchaseBatch> {
  const db = scoped()
  let batch = await getBatch(batchId)
  if (!batch) throw new AppError('ไม่พบชุดนำเข้านี้')
  if (['completed', 'cancelled'].includes(batch.status)) return batch
  const orders = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'batchId', batch.id)
  const placed = new Map(orders.filter((o) => o.status !== 'draft').map((o) => [o.id, o]))
  // A batch whose last question was settled after its orders were approved is approved —
  // nothing is left for a person, and every group has a placed order.
  if (['draft', 'needsReview', 'ready'].includes(batch.status)) {
    const allPlaced = batch.groups.length > 0 && batch.groups.every((g) => g.poId && placed.has(g.poId))
    const orphan = batch.rows.some((r) => !r.skipped && !r.supplierId)
    if (!allPlaced || orphan) return batch
    batch = await appendHistory(batchId, actor, 'approved', undefined, { status: 'approved' })
  }
  const done = [...placed.values()].every((o) => o.shareStatus === 'sent' || o.shareStatus === 'skipped')
  const started = [...placed.values()].some((o) => !!o.shareStatus)
  const status: PurchaseBatchStatus = placed.size > 0 && done ? 'completed' : started ? 'sending' : 'approved'
  if (status === batch.status) return batch
  return appendHistory(batchId, actor, status, undefined, { status })
}
