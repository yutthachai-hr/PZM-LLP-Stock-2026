import { backend } from '../backend'
import type { TxContext } from '../backend/types'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { canEditItems, canTransition, isManager, liveItems } from '../lib/purchaseRequestStatus'
import { sameUnit } from '../lib/units'
import { requireQty } from '../lib/validate'
import { createPurchaseOrder } from './purchaseOrders'
import {
  COL,
  type Product,
  type PurchaseOrder,
  type PurchaseRequest,
  type PurchaseRequestHistoryEntry,
  type PurchaseRequestItem,
  type PurchaseRequestStatus,
  type Role,
  type StockLocation,
  type Supplier,
  type SupplierChoice,
} from '../types'

/**
 * Purchase requests: what the floor asks for, what the หัวหน้า approves, and the orders
 * that come out of it.
 *
 * ## The two numbers
 *
 * Every line keeps `requestedQty` (the requester's, never touched by a manager) beside
 * `approvedQty` (the manager's). "Asked for 5, got 3" is then a fact in the document, not
 * something reconstructed from a log. A line the manager added has no requested quantity.
 *
 * ## Who may do what
 *
 * Decided by `lib/purchaseRequestStatus.ts` and enforced here on every write, then again by
 * the rules for the things a token holder could otherwise skip: only a manager may move a
 * request to approved/returned/rejected, and only in their own name.
 *
 * ## Reads
 *
 * Read on demand by the screens (`getRange` on createdAt, `getOne` by id); nothing is
 * subscribed. A request is one document, lines inside it, like an order.
 */

const MAX_ITEMS = 200
const MAX_HISTORY = 500
const COUNTER = 'purchaseRequest'

export interface Actor {
  id: string
  name: string
  role: Role
}

function scoped() {
  return backend.forBrand(getBrand())
}

function makeDocNo(seq: number): string {
  return `PR-${String(seq).padStart(5, '0')}`
}

function entry(actor: Actor, action: string, extra: Partial<PurchaseRequestHistoryEntry> = {}): PurchaseRequestHistoryEntry {
  // Only keys with a value are written: Firestore refuses `undefined`, and a rule that
  // pins the shape would rather see a key absent than present and empty.
  const kept = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  return { at: Date.now(), by: actor.id, byName: actor.name, action, ...kept }
}

function describe(item: Pick<PurchaseRequestItem, 'productName' | 'entryUnit' | 'unit'>, qty: number | null | undefined): string {
  return `${item.productName} ${qty ?? '-'} ${item.entryUnit ?? item.unit}`
}

// ---------------------------------------------------------------- reading ----

export async function getRequest(id: string): Promise<PurchaseRequest | null> {
  return scoped().getOne<PurchaseRequest>(COL.purchaseRequests, id)
}

/** Requests created in a window, newest first. */
export async function listRequestsInRange(from: number, to: number): Promise<PurchaseRequest[]> {
  const rows = await scoped().getRange<PurchaseRequest>(COL.purchaseRequests, 'createdAt', from, to)
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

// ---------------------------------------------------------------- lines ----

/**
 * How a supplier choice reads against the product's own list: its usual supplier, one of
 * its alternates, or something else — which the manager sees flagged, because the owner's
 * rule is that a person may choose any supplier but nobody may choose one quietly.
 */
export function supplierChoiceFor(product: Product, supplierId: string): SupplierChoice {
  if (product.supplierId === supplierId) return 'primary'
  if ((product.alternateSupplierIds ?? []).includes(supplierId)) return 'alternate'
  return 'custom'
}

export interface LineInput {
  productId: string
  supplierId: string
  qty: number
  entryUnit?: string
  note?: string
}

/** A line as it is stored, looked up from the catalogue rather than trusted from the form. */
export function buildItem(
  idx: number,
  input: LineInput,
  products: readonly Product[],
  suppliers: readonly Supplier[],
): PurchaseRequestItem {
  const p = products.find((x) => x.id === input.productId)
  if (!p) throw new AppError('ไม่พบสินค้า')
  const s = suppliers.find((x) => x.id === input.supplierId)
  if (!s) throw new AppError('กรุณาเลือกผู้ขาย')
  const qty = requireQty(input.qty, 'จำนวน')
  const entryUnit = (input.entryUnit ?? '').trim()
  return {
    idx,
    productId: p.id,
    productName: p.name,
    sku: p.sku,
    unit: p.unitType,
    ...(entryUnit && !sameUnit(entryUnit, p.unitType) ? { entryUnit } : {}),
    supplierId: s.id,
    supplierName: s.name,
    supplierChoice: supplierChoiceFor(p, s.id),
    requestedQty: qty,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  }
}

// ---------------------------------------------------------------- writing ----

/** Read-modify-write one request inside a transaction. */
async function mutate(
  id: string,
  fn: (pr: PurchaseRequest, tx: TxContext) => PurchaseRequest | Promise<PurchaseRequest>,
): Promise<PurchaseRequest> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<PurchaseRequest>(COL.purchaseRequests, id)
    if (!cur) throw new AppError('ไม่พบรายการขอสั่งซื้อ')
    const next = await fn({ ...cur, id }, tx)
    const trimmed: PurchaseRequest = {
      ...next,
      history: next.history.slice(-MAX_HISTORY),
      updatedAt: Date.now(),
    }
    const { id: docId, ...data } = trimmed
    tx.set(COL.purchaseRequests, docId, data)
    return trimmed
  })
}

function requireEditable(pr: PurchaseRequest, actor: Actor): void {
  if (!canEditItems(pr, actor)) throw new AppError('แก้ไขรายการนี้ไม่ได้ในสถานะปัจจุบัน')
}

function requireManager(actor: Actor): void {
  if (!isManager(actor.role)) throw new AppError('ต้องเป็นหัวหน้าหรือผู้ดูแลระบบ')
}

export async function createRequest(params: {
  locationId: string
  note?: string
  actor: Actor
}): Promise<PurchaseRequest> {
  if (!params.locationId) throw new AppError('กรุณาเลือกคลังปลายทาง')
  const db = scoped()
  const now = Date.now()
  return db.transaction(async (tx) => {
    const counter = await tx.get<{ value: number }>(COL.counters, COUNTER)
    const seq = (counter?.value ?? 0) + 1
    tx.set(COL.counters, COUNTER, { value: seq })
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
    const pr: PurchaseRequest = {
      id,
      docNo: makeDocNo(seq),
      status: 'draft',
      revision: 1,
      locationId: params.locationId,
      ...(params.note?.trim() ? { note: params.note.trim() } : {}),
      items: [],
      requestedBy: params.actor.id,
      requestedByName: params.actor.name,
      history: [entry(params.actor, 'created')],
      createdBy: params.actor.id,
      createdByName: params.actor.name,
      createdAt: now,
      updatedAt: now,
    }
    const { id: docId, ...data } = pr
    tx.set(COL.purchaseRequests, docId, data)
    return pr
  })
}

/** Add a line. A manager adding one during review marks it so; its requested quantity is none. */
export async function addItem(params: {
  id: string
  line: LineInput
  products: readonly Product[]
  suppliers: readonly Supplier[]
  actor: Actor
}): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    requireEditable(pr, params.actor)
    if (liveItems(pr.items).length >= MAX_ITEMS) {
      throw new AppError('ขอได้สูงสุด {max} รายการต่อใบ', { max: MAX_ITEMS })
    }
    // One past the highest idx, not the length: a draft line that was removed leaves a
    // gap, and reusing its number would make old history entries point at the new line.
    const idx = pr.items.reduce((m, i) => Math.max(m, i.idx + 1), 0)
    const item = buildItem(idx, params.line, params.products, params.suppliers)
    const byManager = pr.status === 'pendingApproval'
    const stored: PurchaseRequestItem = byManager
      ? { ...item, requestedQty: null, approvedQty: item.requestedQty!, managerAdded: true }
      : item
    return {
      ...pr,
      items: [...pr.items, stored],
      history: [
        ...pr.history,
        entry(params.actor, byManager ? 'managerAddedItem' : 'itemAdded', {
          itemIdx: stored.idx,
          detail: describe(stored, byManager ? stored.approvedQty : stored.requestedQty),
        }),
      ],
    }
  })
}

/** The requester's quantity, before submission. Managers use setApprovedQty. */
export async function setRequestedQty(params: {
  id: string
  idx: number
  qty: number
  entryUnit?: string
  actor: Actor
}): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    requireEditable(pr, params.actor)
    if (pr.status === 'pendingApproval') throw new AppError('จำนวนที่ขอแก้ไม่ได้หลังส่งแล้ว — แก้จำนวนที่อนุมัติแทน')
    const item = pr.items.find((x) => x.idx === params.idx)
    if (!item || item.removed) throw new AppError('ไม่พบรายการ')
    const qty = requireQty(params.qty, 'จำนวน')
    const entryUnit = (params.entryUnit ?? item.entryUnit ?? '').trim()
    const { entryUnit: _drop, ...rest } = item
    void _drop
    const next: PurchaseRequestItem = {
      ...rest,
      ...(entryUnit && !sameUnit(entryUnit, item.unit) ? { entryUnit } : {}),
      requestedQty: qty,
    }
    const items = pr.items.map((x) => (x.idx === params.idx ? next : x))
    return {
      ...pr,
      items,
      history: [
        ...pr.history,
        entry(params.actor, 'qtyChanged', {
          itemIdx: params.idx,
          detail: item.productName,
          oldValue: describe(item, item.requestedQty),
          newValue: describe(next, qty),
        }),
      ],
    }
  })
}

/** The manager's quantity. The requested one is left exactly as it was. */
export async function setApprovedQty(params: {
  id: string
  idx: number
  qty: number
  actor: Actor
}): Promise<PurchaseRequest> {
  requireManager(params.actor)
  return mutate(params.id, (pr) => {
    if (pr.status !== 'pendingApproval') throw new AppError('แก้จำนวนที่อนุมัติได้เฉพาะรายการที่รออนุมัติ')
    const item = pr.items.find((x) => x.idx === params.idx)
    if (!item || item.removed) throw new AppError('ไม่พบรายการ')
    const qty = requireQty(params.qty, 'จำนวน')
    const items = pr.items.map((x) => (x.idx === params.idx ? { ...x, approvedQty: qty } : x))
    return {
      ...pr,
      items,
      history: [
        ...pr.history,
        entry(params.actor, 'managerQtyChanged', {
          itemIdx: params.idx,
          detail: item.productName,
          oldValue: String(item.approvedQty ?? item.requestedQty ?? '-'),
          newValue: String(qty),
        }),
      ],
    }
  })
}

/**
 * Take a line out. Before submission the requester's line simply goes; during review the
 * manager's removal is kept on the line with who, when and why, so the requester sees it.
 */
export async function removeItem(params: {
  id: string
  idx: number
  reason?: string
  actor: Actor
}): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    requireEditable(pr, params.actor)
    const item = pr.items.find((x) => x.idx === params.idx)
    if (!item || item.removed) throw new AppError('ไม่พบรายการ')
    if (pr.status === 'pendingApproval') {
      const reason = (params.reason ?? '').trim()
      if (!reason) throw new AppError('กรุณาระบุเหตุผลที่นำรายการออก')
      const removed = { by: params.actor.id, byName: params.actor.name, at: Date.now(), reason }
      return {
        ...pr,
        items: pr.items.map((x) => (x.idx === params.idx ? { ...x, removed } : x)),
        history: [
          ...pr.history,
          entry(params.actor, 'managerRemovedItem', { itemIdx: params.idx, detail: describe(item, item.approvedQty ?? item.requestedQty), newValue: reason }),
        ],
      }
    }
    // A draft line goes for good; the rest keep their positions (idx is a stable id).
    const items = pr.items.filter((x) => x.idx !== params.idx)
    return {
      ...pr,
      items,
      history: [...pr.history, entry(params.actor, 'itemRemoved', { itemIdx: params.idx, detail: describe(item, item.requestedQty) })],
    }
  })
}

export async function changeSupplier(params: {
  id: string
  idx: number
  supplierId: string
  products: readonly Product[]
  suppliers: readonly Supplier[]
  actor: Actor
}): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    requireEditable(pr, params.actor)
    const item = pr.items.find((x) => x.idx === params.idx)
    if (!item || item.removed) throw new AppError('ไม่พบรายการ')
    const s = params.suppliers.find((x) => x.id === params.supplierId)
    if (!s) throw new AppError('กรุณาเลือกผู้ขาย')
    const p = params.products.find((x) => x.id === item.productId)
    const choice: SupplierChoice = p ? supplierChoiceFor(p, s.id) : 'custom'
    const items = pr.items.map((x) =>
      x.idx === params.idx ? { ...x, supplierId: s.id, supplierName: s.name, supplierChoice: choice } : x,
    )
    return {
      ...pr,
      items,
      history: [
        ...pr.history,
        entry(params.actor, 'supplierChanged', { itemIdx: params.idx, detail: item.productName, oldValue: item.supplierName, newValue: s.name }),
      ],
    }
  })
}

export async function setItemNote(params: { id: string; idx: number; note: string; actor: Actor }): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    requireEditable(pr, params.actor)
    const item = pr.items.find((x) => x.idx === params.idx)
    if (!item || item.removed) throw new AppError('ไม่พบรายการ')
    const note = params.note.trim().slice(0, 500)
    const { note: _old, ...rest } = item
    void _old
    const items = pr.items.map((x) => (x.idx === params.idx ? { ...rest, ...(note ? { note } : {}) } : x))
    return {
      ...pr,
      items,
      history: [...pr.history, entry(params.actor, 'itemNoteChanged', { itemIdx: params.idx, detail: item.productName, oldValue: item.note ?? '', newValue: note })],
    }
  })
}

/** The destination warehouse and the request's own note, while it is still editable. */
export async function setRequestHeader(params: {
  id: string
  locationId?: string
  note?: string
  actor: Actor
}): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    requireEditable(pr, params.actor)
    const next: PurchaseRequest = { ...pr }
    const history = [...pr.history]
    if (params.locationId !== undefined && params.locationId !== pr.locationId) {
      if (!params.locationId) throw new AppError('กรุณาเลือกคลังปลายทาง')
      next.locationId = params.locationId
      history.push(entry(params.actor, 'warehouseChanged', { oldValue: pr.locationId, newValue: params.locationId }))
    }
    if (params.note !== undefined) {
      const note = params.note.trim().slice(0, 2000)
      if ((pr.note ?? '') !== note) {
        if (note) next.note = note
        else delete next.note
        history.push(entry(params.actor, 'noteChanged', { oldValue: pr.note ?? '', newValue: note }))
      }
    }
    return { ...next, history }
  })
}

// ---------------------------------------------------------------- lifecycle ----

/**
 * What stops a request being submitted or approved. Empty means nothing does.
 *
 * Checked against the catalogue as it stands now, so a product hidden since the line was
 * added is caught here rather than on the order.
 */
export function blockingIssues(
  pr: PurchaseRequest,
  ctx: { products: readonly Product[]; suppliers: readonly Supplier[]; locations: readonly StockLocation[] },
  qtyOf: (i: PurchaseRequestItem) => number | null | undefined,
): string[] {
  const out: string[] = []
  const live = liveItems(pr.items)
  if (live.length === 0) out.push('ยังไม่มีรายการสินค้า')
  const loc = ctx.locations.find((l) => l.id === pr.locationId)
  if (!loc || loc.active === false) out.push('คลังปลายทางไม่ถูกต้อง')
  for (const i of live) {
    const p = ctx.products.find((x) => x.id === i.productId)
    const s = ctx.suppliers.find((x) => x.id === i.supplierId)
    const q = qtyOf(i)
    if (!p || p.active === false) out.push(`${i.productName}: สินค้าไม่พร้อมใช้งาน`)
    if (!s || s.active === false) out.push(`${i.productName}: ผู้ขายไม่พร้อมใช้งาน`)
    if (!(typeof q === 'number' && q > 0)) out.push(`${i.productName}: จำนวนต้องมากกว่า 0`)
  }
  return out
}

/** draft | returned → pendingApproval. Sets every line's approved quantity to the requested one. */
export async function submitRequest(params: {
  id: string
  ctx: {
    products: readonly Product[]
    suppliers: readonly Supplier[]
    locations: readonly StockLocation[]
    /** Base-unit balance at a location, for the snapshot the manager reviews against. */
    qtyAt?: (locationId: string, productId: string) => number
  }
  actor: Actor
}): Promise<PurchaseRequest> {
  return mutate(params.id, (pr) => {
    if (!(pr.requestedBy === params.actor.id || isManager(params.actor.role))) {
      throw new AppError('ส่งได้เฉพาะผู้ขอหรือหัวหน้า')
    }
    if (!canTransition(pr.status, 'pendingApproval') || pr.status === 'approved' || pr.status === 'rejected') {
      throw new AppError('รายการนี้ส่งตรวจไม่ได้ในสถานะปัจจุบัน')
    }
    const issues = blockingIssues(pr, params.ctx, (i) => i.requestedQty)
    if (issues.length) throw new AppError('ส่งไม่ได้: {what}', { what: issues[0] })
    const resubmit = pr.status === 'returned'
    const qtyAt = params.ctx.qtyAt
    const activeLocations = params.ctx.locations.filter((l) => l.active !== false)
    const snapshot = (productId: string) =>
      qtyAt
        ? {
            stockAtSubmit: qtyAt(pr.locationId, productId),
            stockTotalAtSubmit: activeLocations.reduce((n, l) => n + qtyAt(l.id, productId), 0),
            stockByLocationAtSubmit: Object.fromEntries(activeLocations.map((l) => [l.id, qtyAt(l.id, productId)])),
          }
        : {}
    const items = pr.items.map((i) =>
      i.removed ? i : { ...i, approvedQty: i.requestedQty ?? i.approvedQty ?? 0, ...snapshot(i.productId) },
    )
    const { returnReason: _r, ...rest } = pr
    void _r
    return {
      ...rest,
      status: 'pendingApproval',
      revision: resubmit ? pr.revision + 1 : pr.revision,
      items,
      submittedAt: Date.now(),
      history: [...pr.history, entry(params.actor, resubmit ? 'resubmitted' : 'submitted', resubmit ? { newValue: String(pr.revision + 1) } : {})],
    }
  })
}

export async function returnRequest(params: { id: string; reason: string; actor: Actor }): Promise<PurchaseRequest> {
  requireManager(params.actor)
  const reason = params.reason.trim()
  if (!reason) throw new AppError('กรุณาระบุเหตุผลที่ส่งกลับ')
  return mutate(params.id, (pr) => {
    if (!canTransition(pr.status, 'returned')) throw new AppError('ส่งกลับได้เฉพาะรายการที่รออนุมัติ')
    return {
      ...pr,
      status: 'returned',
      returnReason: reason,
      history: [...pr.history, entry(params.actor, 'returned', { newValue: reason })],
    }
  })
}

export async function rejectRequest(params: { id: string; reason: string; actor: Actor }): Promise<PurchaseRequest> {
  requireManager(params.actor)
  const reason = params.reason.trim()
  if (!reason) throw new AppError('กรุณาระบุเหตุผลที่ไม่อนุมัติ')
  return mutate(params.id, (pr) => {
    if (!canTransition(pr.status, 'rejected')) throw new AppError('ไม่อนุมัติได้เฉพาะรายการที่รออนุมัติ')
    return {
      ...pr,
      status: 'rejected',
      rejectReason: reason,
      rejectedBy: params.actor.id,
      rejectedByName: params.actor.name,
      rejectedAt: Date.now(),
      history: [...pr.history, entry(params.actor, 'rejected', { newValue: reason })],
    }
  })
}

export async function approveRequest(params: {
  id: string
  note?: string
  ctx: { products: readonly Product[]; suppliers: readonly Supplier[]; locations: readonly StockLocation[] }
  actor: Actor
}): Promise<PurchaseRequest> {
  requireManager(params.actor)
  return mutate(params.id, (pr) => {
    if (!canTransition(pr.status, 'approved')) throw new AppError('อนุมัติได้เฉพาะรายการที่รออนุมัติ')
    const issues = blockingIssues(pr, params.ctx, (i) => i.approvedQty)
    if (issues.length) throw new AppError('อนุมัติไม่ได้: {what}', { what: issues[0] })
    const note = (params.note ?? '').trim()
    return {
      ...pr,
      status: 'approved',
      ...(note ? { approvalNote: note } : {}),
      approvedBy: params.actor.id,
      approvedByName: params.actor.name,
      approvedAt: Date.now(),
      history: [...pr.history, entry(params.actor, 'approved', note ? { newValue: note } : {})],
    }
  })
}

/** Admin only: an approved or rejected request goes back under review, on the record. */
export async function reopenRequest(params: { id: string; reason: string; actor: Actor }): Promise<PurchaseRequest> {
  if (params.actor.role !== 'admin') throw new AppError('เปิดใหม่ได้เฉพาะผู้ดูแลระบบ')
  const reason = params.reason.trim()
  if (!reason) throw new AppError('กรุณาระบุเหตุผลที่เปิดใหม่')
  return mutate(params.id, (pr) => {
    if (pr.status === 'poCreated') throw new AppError('สร้างใบสั่งซื้อไปแล้ว เปิดใหม่ไม่ได้')
    if (!canTransition(pr.status, 'pendingApproval') || pr.status === 'draft' || pr.status === 'returned') {
      throw new AppError('เปิดใหม่ได้เฉพาะรายการที่อนุมัติหรือไม่อนุมัติแล้ว')
    }
    const { approvedBy: _a, approvedByName: _b, approvedAt: _c, rejectedBy: _d, rejectedByName: _e, rejectedAt: _f, rejectReason: _g, ...rest } = pr
    void [_a, _b, _c, _d, _e, _f, _g]
    return {
      ...rest,
      status: 'pendingApproval',
      history: [...pr.history, entry(params.actor, 'reopened', { oldValue: pr.status, newValue: reason })],
    }
  })
}

// ---------------------------------------------------------------- conversion ----

/** The lines an approved request would turn into orders, grouped by supplier. */
export function orderGroups(pr: PurchaseRequest): { supplierId: string; supplierName: string; items: PurchaseRequestItem[] }[] {
  const by = new Map<string, { supplierId: string; supplierName: string; items: PurchaseRequestItem[] }>()
  for (const i of liveItems(pr.items)) {
    if (!((i.approvedQty ?? 0) > 0)) continue
    const g = by.get(i.supplierId) ?? { supplierId: i.supplierId, supplierName: i.supplierName, items: [] }
    g.items.push(i)
    by.set(i.supplierId, g)
  }
  return [...by.values()]
}

/**
 * Turn an approved request into placed orders, one per supplier, through the same
 * `createPurchaseOrder` the manual screen uses. A request converts once: the first thing
 * checked, and re-checked inside the final transaction, is that it has no orders yet, so
 * two people pressing the button together cannot make two sets.
 */
export async function convertToOrders(params: {
  id: string
  products: readonly Product[]
  actor: Actor
}): Promise<PurchaseRequest> {
  const db = scoped()
  const pr = await getRequest(params.id)
  if (!pr) throw new AppError('ไม่พบรายการขอสั่งซื้อ')
  if (pr.status !== 'approved' || (pr.orders && pr.orders.length > 0)) {
    throw new AppError('สร้างใบสั่งซื้อได้เฉพาะรายการที่อนุมัติแล้วและยังไม่เคยสร้าง')
  }
  const groups = orderGroups(pr)
  if (groups.length === 0) throw new AppError('ไม่มีรายการที่อนุมัติจำนวนมากกว่า 0')

  // Refuse if any order already points at this request — a half-finished earlier attempt.
  const already = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'requestId', pr.id)
  if (already.length > 0) {
    throw new AppError('มีใบสั่งซื้อจากรายการนี้อยู่แล้ว: {list}', { list: already.map((o) => o.docNo).join(', ') })
  }

  const orders: NonNullable<PurchaseRequest['orders']> = []
  for (const g of groups) {
    const poId = await createPurchaseOrder({
      supplier: { id: g.supplierId, name: g.supplierName },
      locationId: pr.locationId,
      lines: g.items.map((i) => ({ productId: i.productId, qty: i.approvedQty!, ...(i.entryUnit ? { entryUnit: i.entryUnit } : {}) })),
      products: params.products,
      actor: { id: params.actor.id, name: params.actor.name },
      requestId: pr.id,
    })
    const created = await db.getOne<PurchaseOrder>(COL.purchaseOrders, poId)
    orders.push({ supplierId: g.supplierId, supplierName: g.supplierName, poId, docNo: created?.docNo ?? '' })
  }

  return mutate(pr.id, (cur) => {
    if (cur.orders && cur.orders.length > 0) throw new AppError('มีใบสั่งซื้อจากรายการนี้อยู่แล้ว: {list}', { list: cur.orders.map((o) => o.docNo).join(', ') })
    const status: PurchaseRequestStatus = 'poCreated'
    return {
      ...cur,
      status,
      orders,
      history: [...cur.history, entry(params.actor, 'convertedToPo', { detail: orders.map((o) => `${o.supplierName}: ${o.docNo}`).join(', ') })],
    }
  })
}

/** Note an export, so the history shows who took the list out and when. */
export async function noteExport(id: string, kind: 'pdf' | 'excel', actor: Actor): Promise<PurchaseRequest> {
  return mutate(id, (pr) => ({ ...pr, history: [...pr.history, entry(actor, 'exported', { detail: kind })] }))
}
