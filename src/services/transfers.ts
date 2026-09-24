import { backend } from '../backend'
import type { Backend, TxContext } from '../backend/types'
import { getBrand, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import {
  canCreateTransfer,
  canEditItems,
  canReceive,
  canSubmit,
  canUserAccessBranch,
  isManager,
  liveItems,
} from '../lib/transferStatus'
import {
  transferArrivingDraft,
  transferIssueDraft,
  transferSubmittedDraft,
} from '../lib/inventoryRules/notifications'
import { deliver } from './notifications'
import { genId } from '../lib/id'
import { roundQty } from '../lib/validate'
import { padSeq, takeSeq } from './sequence'
import { filing, planAdjust, planIssue, type MovementLine } from './stock'
import {
  COL,
  OVER_RESOLUTIONS,
  SHORT_RESOLUTIONS,
  TRANSIT_LOCATION_ID,
  type DiscrepancyKind,
  type DiscrepancyReason,
  type DiscrepancyResolutionCode,
  type Role,
  type StockLevel,
  type StockLocation,
  type StockMovement,
  type Transfer,
  type TransferDiscrepancy,
  type TransferHistoryEntry,
  type TransferItem,
  type TransferLegKind,
  type TransferMisroute,
  type TransferStatus,
} from '../types'

/**
 * Logistics: stock moved between the company's own sites, not bought.
 *
 * ## No new inventory engine
 *
 * "In transit" is one virtual location per brand, `locations/transit`. Approving a transfer
 * is an ordinary issue from the source to it; receiving is an ordinary issue from it to the
 * destination; a loss is an ordinary adjustment out of it. Every one of those goes through
 * services/stock.ts (`planIssue` / `planAdjust` — the same code `issueStock` and
 * `adjustStockLines` run), carries this document's id in `transferId`, and so balances,
 * the ledger, drift checks, backups and reports need nothing new. Stock never leaves the
 * company's books between the two sites: it is in the transit location.
 *
 * ## One transaction per step
 *
 * Each step reads the document, checks its status, moves the stock and writes the new
 * status in the SAME transaction. That is what makes a double approval — two managers
 * pressing at once, or one pressing twice — deduct once: the second attempt re-reads a
 * document that is no longer pending and stops. A resolution is the same: a discrepancy
 * that already has one cannot be resolved again, so its stock cannot move twice.
 *
 * ## The quantities
 *
 * A line keeps every number it was ever given — requested, dispatched, received, and a
 * manager's correction beside the receiver's count — and never overwrites one with another.
 * `inTransitQty` is the line's share of the transit balance; each movement out of transit
 * for the line takes from it, and a resolution may never move more than is there.
 *
 * ## Misroutes and legs
 *
 * Goods found at the wrong branch stay in transit (they are not that branch's stock) until
 * a manager decides: redirect them into that branch's stock, forward them to where they
 * were going, or send them back to the source. Forwarding and returning create a child
 * document — a leg — that starts in transit, is received like any other, and completes its
 * parent when it is done. The source is never deducted a second time: the goods were
 * deducted once, at the parent's approval, and have been in transit since.
 */

export interface Actor {
  id: string
  name: string
  role: Role
  siteIds?: string[]
}

const MAX_ITEMS = 200
const MAX_HISTORY = 500

function scoped(): Backend {
  return backend.forBrand(getBrand())
}

function entry(actor: Actor, action: string, extra: Partial<TransferHistoryEntry> = {}): TransferHistoryEntry {
  const kept = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  return { at: Date.now(), by: actor.id, byName: actor.name, action, ...kept }
}

/** Firestore refuses `undefined` anywhere in a document, however deep. */
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as unknown as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, clean(v)]),
    ) as T
  }
  return value
}

function write(tx: TxContext, t: Transfer): void {
  const { id, ...data } = clean({ ...t, history: t.history.slice(-MAX_HISTORY) })
  tx.set(COL.transfers, id, data as Record<string, unknown>)
}

const docNoOf = (seq: number) => `TR-${padSeq(seq, 5)}`
const sum = (xs: number[]) => roundQty(xs.reduce((a, b) => a + b, 0))
const isOpen = (s: TransferStatus) => s !== 'completed' && s !== 'cancelled' && s !== 'rejected'

/** Everything reported found at another branch on this line, decided or not. */
export function misroutedQty(item: TransferItem): number {
  return sum((item.misroutes ?? []).map((m) => m.qty))
}

function unresolvedMisroutedQty(item: TransferItem): number {
  return sum((item.misroutes ?? []).filter((m) => !m.resolution).map((m) => m.qty))
}

/** What the destination should find: dispatched, less what was reported elsewhere. */
export function expectedQty(item: TransferItem): number {
  return Math.max(0, roundQty(item.dispatchQty - misroutedQty(item)))
}

/** How much of the line may still be reported as found at another branch. */
export function reportableQty(item: TransferItem): number {
  return Math.max(0, roundQty((item.inTransitQty ?? 0) - unresolvedMisroutedQty(item)))
}

/**
 * Where a received document stands, from its lines and its legs.
 *
 * Before the receipt the status is the step it is on (in transit, being received); after
 * it, open problems keep it with the manager, open legs keep it `resolved`, and only a
 * document with nothing left anywhere is `completed`.
 */
export function settledStatus(t: Transfer, legs: readonly Pick<Transfer, 'status'>[]): TransferStatus {
  if (!t.receivedAt) return t.status
  const live = liveItems(t.items)
  if (live.some((i) => i.discrepancy && !i.discrepancy.resolution)) {
    return t.status === 'discrepancy' ? 'discrepancy' : 'pendingDiscrepancyApproval'
  }
  if (live.some((i) => (i.misroutes ?? []).some((m) => !m.resolution))) return 'pendingDiscrepancyApproval'
  if (legs.some((l) => isOpen(l.status))) return 'resolved'
  return 'completed'
}

/** The document, its legs, and (for a leg) its parent and the parent's other legs. */
async function readFamily(
  tx: TxContext,
  id: string,
): Promise<{ cur: Transfer; legs: Transfer[]; parent: Transfer | null; siblings: Transfer[] }> {
  const cur = await tx.get<Transfer>(COL.transfers, id)
  if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
  const legs = (await Promise.all((cur.childIds ?? []).map((c) => tx.get<Transfer>(COL.transfers, c)))).filter(
    (x): x is Transfer => !!x,
  )
  const parent = cur.parentId ? await tx.get<Transfer>(COL.transfers, cur.parentId) : null
  const siblings = parent
    ? (
        await Promise.all(
          (parent.childIds ?? []).filter((c) => c !== cur.id).map((c) => tx.get<Transfer>(COL.transfers, c)),
        )
      ).filter((x): x is Transfer => !!x)
    : []
  return { cur: { ...cur, id }, legs, parent: parent ? { ...parent, id: cur.parentId! } : null, siblings }
}

/**
 * When a leg reaches the end, its parent may be done too. Written in the leg's own
 * transaction, from reads taken before any write.
 */
function rollUpParent(
  tx: TxContext,
  parent: Transfer | null,
  siblings: Transfer[],
  leg: Transfer,
  actor: Actor,
): Transfer | null {
  if (!parent) return null
  const next = settledStatus(parent, [...siblings, leg])
  if (next === parent.status) return null
  const updated: Transfer = {
    ...parent,
    status: next,
    updatedAt: Date.now(),
    history: [
      ...parent.history,
      entry(actor, 'legClosed', { fromStatus: parent.status, toStatus: next, note: leg.docNo }),
    ],
  }
  write(tx, updated)
  return updated
}

// ---------------------------------------------------------------- setup ----

/**
 * The transit location, created once per brand by an admin (Settings → เปิดใช้ระบบส่งสินค้า)
 * — locations are an admin's to write. Approving a transfer refuses until it exists.
 */
export async function ensureTransitLocation(brand?: BrandId, actor?: Pick<Actor, 'role'>): Promise<StockLocation> {
  if (actor && actor.role !== 'admin') throw new AppError('ต้องเป็นผู้ดูแลระบบ')
  const db = brand ? backend.forBrand(brand) : scoped()
  const existing = await db.getOne<StockLocation>(COL.locations, TRANSIT_LOCATION_ID)
  if (existing) return existing
  const transit: StockLocation = {
    id: TRANSIT_LOCATION_ID,
    name: 'ระหว่างขนส่ง',
    nameEn: 'In Transit',
    type: 'transit',
    active: true,
    createdAt: Date.now(),
  }
  const { id, ...data } = transit
  await db.set(COL.locations, id, data)
  return transit
}

// ---------------------------------------------------------------- reading ----

export async function getTransfer(id: string): Promise<Transfer | null> {
  return scoped().getOne<Transfer>(COL.transfers, id)
}

export async function listTransfersInRange(from: number, to: number): Promise<Transfer[]> {
  const rows = await scoped().getRange<Transfer>(COL.transfers, 'createdAt', from, to)
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

const ACTIVE: TransferStatus[] = ['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval', 'resolved']

/**
 * Documents with goods on the road or a problem open, whatever their age — one equality
 * query per status, so the read is bounded by what is open rather than by history.
 */
export async function listActiveTransfers(locationId?: string): Promise<Transfer[]> {
  const db = scoped()
  const rows = (await Promise.all(ACTIVE.map((s) => db.getBy<Transfer>(COL.transfers, 'status', s)))).flat()
  return rows
    .filter((t) => !locationId || t.toLocationId === locationId || t.fromLocationId === locationId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * A photo of a difference (damaged box, the scale reading), kept where movement proof
 * photos already are — `movementImages`, base64, one per line — so it needs no new storage.
 */
export async function saveDiscrepancyPhoto(docNo: string, itemIdx: number, dataUrl: string): Promise<string> {
  const id = `${docNo}-L${itemIdx}`
  await scoped().set(COL.movementImages, id, { dataUrl })
  return id
}

export async function getDiscrepancyPhoto(photoId: string): Promise<string | null> {
  return (await scoped().getOne<{ dataUrl: string }>(COL.movementImages, photoId))?.dataUrl ?? null
}

/** Everything not finished: submitted requests plus everything on the road. */
export async function listOpenTransfers(): Promise<Transfer[]> {
  const db = scoped()
  const rows = (await Promise.all((['pendingApproval', ...ACTIVE] as TransferStatus[]).map((s) => db.getBy<Transfer>(COL.transfers, 'status', s)))).flat()
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** The ledger rows a document produced — its own and its legs'. */
export async function transferMovements(ids: string[]): Promise<StockMovement[]> {
  const db = scoped()
  const rows = (await Promise.all(ids.map((id) => db.getBy<StockMovement>(COL.movements, 'transferId', id)))).flat()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

// ---------------------------------------------------------------- lines ----

function checkItems(items: TransferItem[]): TransferItem[] {
  if (items.length > MAX_ITEMS) throw new AppError('รายการสินค้าเกิน {n} บรรทัด', { n: MAX_ITEMS })
  const seen = new Set<string>()
  for (const i of liveItems(items)) {
    if (!i.productId) throw new AppError('ไม่พบสินค้า')
    if (seen.has(i.productId)) throw new AppError('สินค้า "{name}" อยู่ในใบนี้มากกว่า 1 บรรทัด', { name: i.productName })
    seen.add(i.productId)
    const qty = i.dispatchQty ?? i.requestedQty
    if (!(typeof qty === 'number' && Number.isFinite(qty) && qty > 0)) {
      throw new AppError('จำนวนของ "{name}" ต้องมากกว่า 0', { name: i.productName })
    }
  }
  return items.map((i, idx) => ({ ...i, idx: i.idx ?? idx }))
}

const qtyText = (qty: number | null | undefined, unit: string, entryQty?: number, entryUnit?: string) =>
  entryUnit && entryQty !== undefined ? `${entryQty} ${entryUnit} (${qty ?? '-'} ${unit})` : `${qty ?? '-'} ${unit}`

/**
 * One history entry per line that changed, with the old and new values — the audit the
 * owner asked for ("qty changed", "unit changed", "item added", "item removed").
 */
function lineChanges(before: TransferItem[], after: TransferItem[], actor: Actor, field: 'requested' | 'dispatch'): TransferHistoryEntry[] {
  const out: TransferHistoryEntry[] = []
  const prev = new Map(before.map((i) => [i.idx, i]))
  const qtyOf = (i: TransferItem) => (field === 'dispatch' ? i.dispatchQty : i.requestedQty)
  const unitOf = (i: TransferItem) => (field === 'dispatch' ? i.dispatchEntryUnit : i.requestedEntryUnit)
  const entryOf = (i: TransferItem) => (field === 'dispatch' ? i.dispatchEntryQty : i.requestedEntryQty)
  for (const i of after) {
    const p = prev.get(i.idx)
    if (!p) {
      out.push(entry(actor, 'itemAdded', { note: `${i.productName} ${qtyText(qtyOf(i), i.unit, entryOf(i), unitOf(i))}`, newQty: qtyOf(i) ?? undefined }))
      continue
    }
    if (i.removed && !p.removed) {
      out.push(entry(actor, 'itemRemoved', { note: i.productName, reason: i.removed.reason, oldQty: qtyOf(p) ?? undefined }))
      continue
    }
    if ((unitOf(p) ?? '') !== (unitOf(i) ?? '')) {
      out.push(entry(actor, 'unitChanged', { note: i.productName, diff: { from: unitOf(p) ?? i.unit, to: unitOf(i) ?? i.unit } }))
    }
    if (qtyOf(p) !== qtyOf(i) || entryOf(p) !== entryOf(i)) {
      out.push(entry(actor, 'qtyChanged', { note: i.productName, oldQty: qtyOf(p) ?? undefined, newQty: qtyOf(i) ?? undefined }))
    }
  }
  for (const p of before) {
    if (!after.some((i) => i.idx === p.idx)) out.push(entry(actor, 'itemRemoved', { note: p.productName, oldQty: qtyOf(p) ?? undefined }))
  }
  return out
}

// ---------------------------------------------------------------- lifecycle ----

export async function createDraft(params: {
  fromLocationId: string
  toLocationId: string
  dispatchDate: number
  actor: Actor
  note?: string
  legKind?: TransferLegKind
  parentId?: string
}): Promise<Transfer> {
  const { fromLocationId, toLocationId, dispatchDate, actor, note, legKind, parentId } = params
  if (!fromLocationId || !toLocationId) throw new AppError('กรุณาเลือกต้นทางและปลายทาง')
  if (fromLocationId === toLocationId) throw new AppError('ต้นทางและปลายทางต้องต่างกัน')
  if (fromLocationId === TRANSIT_LOCATION_ID || toLocationId === TRANSIT_LOCATION_ID) {
    throw new AppError('เลือกคลังระหว่างขนส่งเป็นต้นทางหรือปลายทางไม่ได้')
  }
  if (!canCreateTransfer(actor, fromLocationId)) throw new AppError('ไม่มีสิทธิ์สร้างคำขอโอนจากสาขาต้นทางนี้')

  return scoped().transaction(async (tx) => {
    // ---- reads ----
    const seq = await takeSeq(tx, 'transfer')
    // ---- writes ----
    seq.commit()
    const now = Date.now()
    const transfer: Transfer = {
      id: genId(),
      docNo: docNoOf(seq.seq),
      status: 'draft',
      revision: 1,
      fromLocationId,
      toLocationId,
      dispatchDate,
      note: note?.trim() || undefined,
      parentId,
      legKind,
      requestedBy: actor.id,
      requestedByName: actor.name,
      items: [],
      history: [entry(actor, 'created')],
      createdAt: now,
      updatedAt: now,
    }
    write(tx, transfer)
    return clean(transfer)
  })
}

export async function saveItems(transferId: string, items: TransferItem[], actor: Actor, note?: string): Promise<Transfer> {
  const checked = checkItems(items)
  return scoped().transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (!canEditItems(cur, actor)) throw new AppError('ไม่มีสิทธิ์แก้ไขรายการในสถานะนี้')
    const field = cur.status === 'pendingApproval' ? 'dispatch' : 'requested'
    const updated: Transfer = {
      ...cur,
      id: transferId,
      items: checked,
      ...(note !== undefined ? { note: note.trim() || undefined } : {}),
      updatedAt: Date.now(),
      history: [...cur.history, ...lineChanges(cur.items, checked, actor, field)],
    }
    write(tx, updated)
    return clean(updated)
  })
}

export async function submitTransfer(transferId: string, actor: Actor, items?: TransferItem[]): Promise<Transfer> {
  const db = scoped()
  const submitted = await db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    const candidate = checkItems(items ?? cur.items)
    if (!canSubmit({ ...cur, items: candidate }, actor)) throw new AppError('ไม่สามารถส่งคำขอโอนได้')
    // What the source held when it was asked for — the manager sees it beside the latest.
    const levels = await Promise.all(
      candidate.map((i) => tx.get<StockLevel>(COL.stockLevels, `${cur.fromLocationId}__${i.productId}`)),
    )
    const now = Date.now()
    const populated = candidate.map((i, n) => ({
      ...i,
      stockAtSubmit: levels[n]?.qty ?? 0,
      // Submitting copies the ask into the dispatch column; the manager edits that one.
      dispatchQty: i.requestedQty ?? i.dispatchQty,
      dispatchEntryQty: i.requestedEntryQty ?? i.dispatchEntryQty,
      dispatchEntryUnit: i.requestedEntryUnit ?? i.dispatchEntryUnit,
    }))
    const updated: Transfer = {
      ...cur,
      id: transferId,
      status: 'pendingApproval',
      revision: cur.status === 'returned' ? cur.revision + 1 : cur.revision,
      submittedAt: now,
      items: populated,
      updatedAt: now,
      history: [
        ...cur.history,
        ...(items ? lineChanges(cur.items, candidate, actor, 'requested') : []),
        entry(actor, 'submitted', { fromStatus: cur.status, toStatus: 'pendingApproval' }),
      ],
    }
    write(tx, updated)
    return clean(updated)
  })
  const locations = await db.getAll<StockLocation>(COL.locations)
  const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
  await deliver(transferSubmittedDraft(submitted, locName), actor)
  return submitted
}

/**
 * The manager's decision. Approving reads the source's balance again inside the same
 * transaction as the deduction — what was on the shelf at submit time is advice, not a
 * reservation — and moves the dispatch quantities from the source into transit.
 */
export async function reviewTransfer(params: {
  transferId: string
  expectedRevision: number
  actor: Actor
  action: 'approve' | 'return' | 'reject'
  note?: string
  items?: TransferItem[]
}): Promise<Transfer> {
  const { transferId, expectedRevision, actor, action, note, items } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่อนุมัติหรือตรวจทานได้')
  const db = scoped()
  const guard = (cur: Transfer | null): Transfer => {
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'pendingApproval') throw new AppError('เอกสารไม่ได้อยู่ในสถานะรออนุมัติ')
    if (cur.revision !== expectedRevision) throw new AppError('เอกสารมีการแก้ไข กรุณาโหลดใหม่')
    return cur
  }

  if (action === 'return' || action === 'reject') {
    const why = (note ?? '').trim()
    if (!why) throw new AppError('กรุณาระบุเหตุผล')
    return db.transaction(async (tx) => {
      const cur = guard(await tx.get<Transfer>(COL.transfers, transferId))
      const toStatus: TransferStatus = action === 'return' ? 'returned' : 'rejected'
      const updated: Transfer = {
        ...cur,
        id: transferId,
        status: toStatus,
        ...(action === 'return' ? { returnReason: why } : { rejectReason: why }),
        updatedAt: Date.now(),
        history: [...cur.history, entry(actor, action, { fromStatus: cur.status, toStatus, reason: why })],
      }
      write(tx, updated)
      return clean(updated)
    })
  }

  const approved = await filing(db, async (tx, file) => {
    // ---- reads ----
    const cur = guard(await tx.get<Transfer>(COL.transfers, transferId))
    const transit = await tx.get<StockLocation>(COL.locations, TRANSIT_LOCATION_ID)
    if (!transit) throw new AppError('ยังไม่ได้เปิดใช้ระบบส่งสินค้า (ไม่พบคลังระหว่างขนส่ง)')
    const reviewItems = checkItems(items ?? cur.items)
    const live = liveItems(reviewItems)
    if (live.length === 0) throw new AppError('ไม่มีรายการสินค้าที่อนุมัติ')
    const latest = await Promise.all(
      live.map((i) => tx.get<StockLevel>(COL.stockLevels, `${cur.fromLocationId}__${i.productId}`)),
    )
    const lines: MovementLine[] = live.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unit: i.unit,
      qty: i.dispatchQty,
      ...(i.dispatchEntryUnit && i.dispatchEntryQty ? { entryUnit: i.dispatchEntryUnit, entryQty: i.dispatchEntryQty } : {}),
    }))
    const planned = await planIssue(
      tx,
      { lines, fromLocationId: cur.fromLocationId, toLocationId: TRANSIT_LOCATION_ID, date: cur.dispatchDate, actor, note: cur.note, transferId },
      file,
    )
    // ---- writes ----
    const docNo = planned.commit()
    const now = Date.now()
    const stockAt = new Map(live.map((i, n) => [i.idx, latest[n]?.qty ?? 0]))
    const finalItems = reviewItems.map((i) =>
      i.removed ? i : { ...i, stockAtApprove: stockAt.get(i.idx), inTransitQty: i.dispatchQty },
    )
    const updated: Transfer = {
      ...cur,
      id: transferId,
      status: 'inTransit',
      approvedBy: actor.id,
      approvedByName: actor.name,
      approvedAt: now,
      dispatchMovementDocNo: docNo,
      items: finalItems,
      updatedAt: now,
      history: [
        ...cur.history,
        ...(items ? lineChanges(cur.items, reviewItems, actor, 'dispatch') : []),
        entry(actor, 'approved', { fromStatus: cur.status, toStatus: 'inTransit', note: note?.trim() || undefined }),
        entry(actor, 'movedToTransit', { note: docNo }),
      ],
    }
    write(tx, updated)
    return clean(updated)
  })
  const locations = await db.getAll<StockLocation>(COL.locations)
  const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
  await deliver(transferArrivingDraft(approved, locName), actor)
  return approved
}

/** An admin puts a rejected request back in front of the managers. Recorded, never silent. */
export async function reopenTransfer(transferId: string, actor: Actor, reason: string): Promise<Transfer> {
  if (actor.role !== 'admin') throw new AppError('ต้องเป็นผู้ดูแลระบบ')
  const why = reason.trim()
  if (!why) throw new AppError('กรุณาระบุเหตุผล')
  return scoped().transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'rejected') throw new AppError('เปิดใหม่ได้เฉพาะเอกสารที่ไม่อนุมัติ')
    const updated: Transfer = {
      ...cur,
      id: transferId,
      status: 'pendingApproval',
      revision: cur.revision + 1,
      updatedAt: Date.now(),
      history: [...cur.history, entry(actor, 'reopened', { fromStatus: 'rejected', toStatus: 'pendingApproval', reason: why })],
    }
    write(tx, updated)
    return clean(updated)
  })
}

/** The receiver opened the delivery: "branch opened" in the audit, no stock moves. */
export async function openReceiving(transferId: string, actor: Actor): Promise<Transfer> {
  return scoped().transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'inTransit') return { ...cur, id: transferId }
    if (!canReceive(cur, actor)) throw new AppError('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')
    const updated: Transfer = {
      ...cur,
      id: transferId,
      status: 'receiving',
      updatedAt: Date.now(),
      history: [...cur.history, entry(actor, 'receivingOpened', { fromStatus: 'inTransit', toStatus: 'receiving' })],
    }
    write(tx, updated)
    return clean(updated)
  })
}

export interface ReceivedLineInput {
  idx: number
  /** In the product's own unit. */
  receivedQty: number
  receivedEntryQty?: number
  receivedEntryUnit?: string
  /**
   * The receiver's explanation of a difference. The kind and the quantity are worked out
   * here from the counts — only the reason, note and photo are taken from the screen.
   */
  discrepancy?: {
    kind?: DiscrepancyKind
    qty?: number
    reason: DiscrepancyReason
    note?: string
    photoId?: string
  }
}

const REASONS: readonly DiscrepancyReason[] = ['SHORT', 'OVER', 'WEIGHT_VARIANCE', 'DAMAGED', 'WRONG_ITEM', 'WRONG_BRANCH', 'COUNTING_ERROR', 'OTHER']

/**
 * Confirm what arrived.
 *
 * Every line files what arrived, up to what was expected, from transit into the branch.
 * A line that came up short leaves the rest in transit as an open discrepancy — never
 * written off here. A line that came over files only what was expected; the extra is not
 * the branch's stock until a manager says where it came from. A delivery with nothing
 * wrong is completed on the spot, with no second approval.
 */
export async function confirmReceive(params: {
  transferId: string
  actor: Actor
  receivedLines: ReceivedLineInput[]
  note?: string
}): Promise<Transfer> {
  const { transferId, actor, receivedLines, note } = params
  const db = scoped()
  let problem = false

  const result = await filing(db, async (tx, file) => {
    // ---- reads ----
    const { cur, legs, parent, siblings } = await readFamily(tx, transferId)
    if (cur.status !== 'inTransit' && cur.status !== 'receiving') throw new AppError('เอกสารไม่ได้อยู่ในสถานะพร้อมตรวจรับ')
    if (!canReceive(cur, actor)) throw new AppError('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')
    const byIdx = new Map(receivedLines.map((r) => [r.idx, r]))
    const now = Date.now()
    const filed: MovementLine[] = []

    const items = cur.items.map((item): TransferItem => {
      if (item.removed) return item
      const input = byIdx.get(item.idx)
      if (!input) throw new AppError('กรุณาระบุจำนวนรับจริงของ "{name}"', { name: item.productName })
      const received = roundQty(input.receivedQty)
      if (!Number.isFinite(received) || received < 0) {
        throw new AppError('จำนวนรับจริงของ "{name}" ไม่ถูกต้อง', { name: item.productName })
      }
      const expected = expectedQty(item)
      const toFile = Math.min(received, expected)
      if (toFile > 0) {
        // The keyed unit travels with the row only when it describes exactly what is filed.
        const keyed = toFile === received && input.receivedEntryUnit && input.receivedEntryQty ? { entryUnit: input.receivedEntryUnit, entryQty: input.receivedEntryQty } : {}
        filed.push({ productId: item.productId, productName: item.productName, unit: item.unit, qty: toFile, ...keyed })
      }
      let discrepancy: TransferDiscrepancy | undefined
      if (received !== expected) {
        problem = true
        const kind: DiscrepancyKind = received < expected ? 'short' : 'over'
        const asked = input.discrepancy?.reason
        discrepancy = {
          kind,
          qty: roundQty(Math.abs(expected - received)),
          reason: asked && REASONS.includes(asked) ? asked : kind === 'short' ? 'SHORT' : 'OVER',
          note: input.discrepancy?.note?.trim() || undefined,
          photoId: input.discrepancy?.photoId,
          reportedBy: actor.id,
          reportedByName: actor.name,
          reportedAt: now,
        }
      }
      return {
        ...item,
        receivedQty: received,
        receivedEntryQty: input.receivedEntryQty,
        receivedEntryUnit: input.receivedEntryUnit,
        inTransitQty: roundQty((item.inTransitQty ?? 0) - toFile),
        discrepancy,
      }
    })

    const planned = filed.length
      ? await planIssue(
          tx,
          { lines: filed, fromLocationId: TRANSIT_LOCATION_ID, toLocationId: cur.toLocationId, date: now, actor, note: note ?? cur.note, transferId },
          file,
        )
      : null
    // ---- writes ----
    const docNo = planned?.commit()
    const received: Transfer = { ...cur, receivedBy: actor.id, receivedByName: actor.name, receivedAt: now, items, status: 'discrepancy' }
    const nextStatus = problem ? 'discrepancy' : settledStatus({ ...received, status: 'receiving' }, legs)
    if ((items.some((i) => (i.misroutes ?? []).some((m) => !m.resolution)))) problem = true
    const updated: Transfer = {
      ...received,
      status: nextStatus,
      receiveMovementDocNo: docNo,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'received', { fromStatus: cur.status, toStatus: nextStatus, note: docNo }),
        ...items
          .filter((i) => i.discrepancy)
          .map((i) => entry(actor, 'discrepancyCreated', { note: i.productName, oldQty: expectedQty(i), newQty: i.receivedQty, reason: i.discrepancy!.reason })),
      ],
    }
    write(tx, updated)
    rollUpParent(tx, parent, siblings, updated, actor)
    return clean(updated)
  })

  if (problem) {
    const locations = await db.getAll<StockLocation>(COL.locations)
    const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
    await deliver(transferIssueDraft(result, locName, actor.name), actor)
  }
  return result
}

/** The receiver has said what they know about the differences; over to the manager. */
export async function submitDiscrepancyForApproval(transferId: string, actor: Actor): Promise<Transfer> {
  return scoped().transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'discrepancy') throw new AppError('เอกสารไม่ได้อยู่ในสถานะมีผลต่าง')
    if (!canUserAccessBranch(actor, cur.toLocationId)) throw new AppError('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')
    const updated: Transfer = {
      ...cur,
      id: transferId,
      status: 'pendingDiscrepancyApproval',
      updatedAt: Date.now(),
      history: [...cur.history, entry(actor, 'discrepancySubmitted', { fromStatus: 'discrepancy', toStatus: 'pendingDiscrepancyApproval' })],
    }
    write(tx, updated)
    return clean(updated)
  })
}

/**
 * The receiver adds or changes the reason, note or photo of a line's difference before it
 * goes to the manager. Counts are not edited here — they were confirmed.
 */
export async function explainDiscrepancy(params: {
  transferId: string
  itemIdx: number
  reason: DiscrepancyReason
  note?: string
  photoId?: string
  actor: Actor
}): Promise<Transfer> {
  const { transferId, itemIdx, reason, note, photoId, actor } = params
  if (!REASONS.includes(reason)) throw new AppError('กรุณาเลือกเหตุผล')
  return scoped().transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'discrepancy' && cur.status !== 'pendingDiscrepancyApproval') throw new AppError('เอกสารไม่ได้อยู่ในสถานะมีผลต่าง')
    if (!canUserAccessBranch(actor, cur.toLocationId)) throw new AppError('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')
    const item = cur.items.find((i) => i.idx === itemIdx)
    if (!item?.discrepancy || item.discrepancy.resolution) throw new AppError('ไม่พบรายการผลต่างที่ระบุ')
    const items = cur.items.map((i) =>
      i.idx === itemIdx ? { ...i, discrepancy: { ...i.discrepancy!, reason, note: note?.trim() || undefined, ...(photoId ? { photoId } : {}) } } : i,
    )
    const updated: Transfer = {
      ...cur,
      id: transferId,
      items,
      updatedAt: Date.now(),
      history: [...cur.history, entry(actor, 'discrepancyExplained', { note: item.productName, reason })],
    }
    write(tx, updated)
    return clean(updated)
  })
}

/**
 * A manager settles one line's difference. Each resolution moves exactly the open
 * quantity, once, and only the way that resolution means:
 *
 *   short  NOT_ACTUALLY_LOADED  transit → source
 *          TRANSIT_LOSS         adjust out of transit (lost)
 *          DAMAGED              adjust out of transit (damage)
 *          WEIGHING_ERROR       transit → destination; the manager's corrected count kept
 *                               beside the receiver's
 *          WRONG_BRANCH         nothing moves yet: becomes a misroute at `custodyLocationId`
 *   over   DISPATCH_WRONG       source → destination (the warehouse really sent more)
 *          COUNT_ERROR          nothing moves; corrected count kept beside the receiver's
 *          APPROVED_ADJUSTMENT  adjust in at the destination (found)
 *          BELONGS_TO_OTHER_TRANSFER  nothing moves here: recorded as found goods on
 *                               `relatedTransferId`, whose own resolution moves them
 */
export async function resolveDiscrepancy(params: {
  transferId: string
  itemIdx: number
  resolution: { code: DiscrepancyResolutionCode; qty?: number; note?: string }
  actor: Actor
  custodyLocationId?: string
  relatedTransferId?: string
}): Promise<Transfer> {
  const { transferId, itemIdx, resolution, actor, custodyLocationId, relatedTransferId } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่อนุมัติผลต่างได้')
  const db = scoped()

  return filing(db, async (tx, file) => {
    // ---- reads ----
    const { cur, legs, parent, siblings } = await readFamily(tx, transferId)
    if (cur.status !== 'discrepancy' && cur.status !== 'pendingDiscrepancyApproval') {
      throw new AppError('เอกสารไม่ได้อยู่ในสถานะรอพิจารณาผลต่าง')
    }
    const item = cur.items.find((i) => i.idx === itemIdx && !i.removed)
    const disc = item?.discrepancy
    if (!item || !disc) throw new AppError('ไม่พบรายการผลต่างที่ระบุ')
    if (disc.resolution) throw new AppError('ผลต่างรายการนี้ได้รับการแก้ไขไปแล้ว')
    const allowed = disc.kind === 'short' ? SHORT_RESOLUTIONS : OVER_RESOLUTIONS
    if (!allowed.includes(resolution.code)) throw new AppError('วิธีจัดการนี้ใช้กับผลต่างประเภทนี้ไม่ได้')
    const qty = disc.qty
    if (resolution.qty !== undefined && roundQty(resolution.qty) !== qty) {
      throw new AppError('จำนวนที่จัดการต้องเท่ากับผลต่าง ({qty} {unit})', { qty, unit: item.unit })
    }
    if (disc.kind === 'short' && qty > (item.inTransitQty ?? 0)) {
      throw new AppError('ยอดระหว่างขนส่งของรายการนี้ไม่พอ')
    }
    const now = Date.now()
    const line = { productId: item.productId, productName: item.productName, unit: item.unit, qty }
    const why = resolution.note?.trim()
    const base = { date: now, actor, transferId: cur.id }

    let plan: { commit: () => string } | null = null
    let other: Transfer | null = null
    let misroute: TransferMisroute | null = null
    const patch: Partial<TransferItem> = {}

    switch (resolution.code) {
      case 'NOT_ACTUALLY_LOADED':
        plan = await planIssue(tx, { ...base, lines: [line], fromLocationId: TRANSIT_LOCATION_ID, toLocationId: cur.fromLocationId, note: why ?? 'ผลต่าง: ไม่ได้ขึ้นของจริง คืนต้นทาง' }, file)
        patch.inTransitQty = roundQty((item.inTransitQty ?? 0) - qty)
        break
      case 'TRANSIT_LOSS':
      case 'DAMAGED':
        plan = await planAdjust(
          tx,
          {
            ...base,
            lines: [{ ...line, direction: 'out', reason: resolution.code === 'DAMAGED' ? 'damage' : 'lost' }],
            locationId: TRANSIT_LOCATION_ID,
            note: why ?? (resolution.code === 'DAMAGED' ? 'ผลต่าง: เสียหายระหว่างขนส่ง' : 'ผลต่าง: สูญหายระหว่างขนส่ง'),
          },
          file,
        )
        patch.inTransitQty = roundQty((item.inTransitQty ?? 0) - qty)
        break
      case 'WEIGHING_ERROR':
        plan = await planIssue(tx, { ...base, lines: [line], fromLocationId: TRANSIT_LOCATION_ID, toLocationId: cur.toLocationId, note: why ?? 'ผลต่าง: ชั่ง/นับผิด รับเข้าครบตามที่ส่ง' }, file)
        patch.inTransitQty = roundQty((item.inTransitQty ?? 0) - qty)
        patch.correctedReceivedQty = roundQty((item.receivedQty ?? 0) + qty)
        break
      case 'WRONG_BRANCH': {
        if (!custodyLocationId || custodyLocationId === cur.toLocationId || custodyLocationId === TRANSIT_LOCATION_ID) {
          throw new AppError('กรุณาเลือกสาขาที่ได้รับสินค้าไปจริง')
        }
        const loc = await tx.get<StockLocation>(COL.locations, custodyLocationId)
        if (!loc || loc.active === false) throw new AppError('ไม่พบคลังในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
        misroute = {
          id: genId(),
          actualCustodyLocationId: custodyLocationId,
          originalDestinationId: cur.toLocationId,
          qty,
          reportedBy: actor.id,
          reportedByName: actor.name,
          reportedAt: now,
          note: why,
        }
        break
      }
      case 'DISPATCH_WRONG':
        plan = await planIssue(tx, { ...base, lines: [line], fromLocationId: cur.fromLocationId, toLocationId: cur.toLocationId, note: why ?? 'ผลต่าง: ต้นทางส่งเกินจากที่บันทึก' }, file)
        patch.correctedDispatchQty = roundQty(item.dispatchQty + qty)
        break
      case 'COUNT_ERROR':
        patch.correctedReceivedQty = roundQty((item.receivedQty ?? 0) - qty)
        break
      case 'APPROVED_ADJUSTMENT':
        plan = await planAdjust(tx, { ...base, lines: [{ ...line, direction: 'in', reason: 'found' }], locationId: cur.toLocationId, note: why ?? 'ผลต่าง: อนุมัติรับของเกินเข้าสต๊อก' }, file)
        break
      case 'BELONGS_TO_OTHER_TRANSFER': {
        if (!relatedTransferId || relatedTransferId === cur.id) throw new AppError('กรุณาเลือกเอกสารที่ของชุดนี้เป็นของจริง')
        const found = await tx.get<Transfer>(COL.transfers, relatedTransferId)
        if (!found) throw new AppError('ไม่พบเอกสารโอนสินค้า')
        other = { ...found, id: relatedTransferId }
        break
      }
    }

    // ---- writes ----
    const movementDocNo = plan?.commit()
    if (other) {
      other = foundAt(other, item.productId, cur.toLocationId, qty, actor, `${cur.docNo}${why ? ` — ${why}` : ''}`)
      write(tx, other)
    }
    const items = cur.items.map((i) =>
      i.idx !== itemIdx
        ? i
        : {
            ...i,
            ...patch,
            ...(misroute ? { misroutes: [...(i.misroutes ?? []), misroute] } : {}),
            discrepancy: {
              ...disc,
              resolution: {
                code: resolution.code,
                qty,
                by: actor.id,
                byName: actor.name,
                at: now,
                note: why,
                movementDocNo,
                misrouteId: misroute?.id,
                relatedTransferId: other?.id,
              },
            },
          },
    )
    const next = settledStatus({ ...cur, items, status: 'pendingDiscrepancyApproval' }, legs)
    const updated: Transfer = {
      ...cur,
      status: next,
      items,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'discrepancyResolved', {
          fromStatus: cur.status,
          toStatus: next,
          note: `${item.productName}: ${resolution.code}${movementDocNo ? ` (${movementDocNo})` : ''}${other ? ` → ${other.docNo}` : ''}`,
          oldQty: disc.kind === 'short' ? item.receivedQty : expectedQty(item),
          newQty: patch.correctedReceivedQty ?? patch.correctedDispatchQty,
          reason: why,
        }),
      ],
    }
    write(tx, updated)
    rollUpParent(tx, parent, siblings, updated, actor)
    return clean(updated)
  })
}

/**
 * Record `qty` of a product found at `custodyId` against document `t`, the way reportMisroute
 * does — shared with BELONGS_TO_OTHER_TRANSFER, where the overage at one branch is the
 * missing goods of another document.
 */
function foundAt(t: Transfer, productId: string, custodyId: string, qty: number, actor: Actor, note?: string): Transfer {
  if (!['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval'].includes(t.status)) {
    throw new AppError('เอกสาร {docNo} ไม่มีของค้างระหว่างขนส่งแล้ว', { docNo: t.docNo })
  }
  if (custodyId === t.toLocationId) throw new AppError('สาขานี้คือปลายทางของเอกสารอยู่แล้ว — ใช้การตรวจรับตามปกติ')
  const item = t.items.find((i) => i.productId === productId && !i.removed)
  if (!item) throw new AppError('เอกสาร {docNo} ไม่มีสินค้านี้', { docNo: t.docNo })
  if (!(qty > 0)) throw new AppError('จำนวนต้องมากกว่า 0')
  const room = reportableQty(item)
  if (qty > room) throw new AppError('ยอดที่ยังค้างระหว่างขนส่งของ "{name}" เหลือ {qty} {unit}', { name: item.productName, qty: room, unit: item.unit })
  const now = Date.now()
  const m: TransferMisroute = {
    id: genId(),
    actualCustodyLocationId: custodyId,
    originalDestinationId: t.toLocationId,
    qty: roundQty(qty),
    reportedBy: actor.id,
    reportedByName: actor.name,
    reportedAt: now,
    note: note?.trim() || undefined,
  }
  const items = t.items.map((i) => {
    if (i.idx !== item.idx) return i
    // Already received short: the shortage IS these goods. Move that much of it into the
    // misroute so the same cans are not open twice.
    const d = i.discrepancy
    if (d && d.kind === 'short' && !d.resolution) {
      const left = roundQty(d.qty - qty)
      const discrepancy: TransferDiscrepancy =
        left > 0
          ? { ...d, qty: left }
          : { ...d, resolution: { code: 'WRONG_BRANCH', qty: d.qty, by: actor.id, byName: actor.name, at: now, misrouteId: m.id } }
      return { ...i, misroutes: [...(i.misroutes ?? []), m], discrepancy }
    }
    return { ...i, misroutes: [...(i.misroutes ?? []), m] }
  })
  const withMisroute: Transfer = { ...t, items }
  const status = t.receivedAt ? settledStatus({ ...withMisroute, status: t.status }, []) : t.status
  return {
    ...withMisroute,
    status,
    updatedAt: now,
    history: [
      ...t.history,
      entry(actor, 'misrouteReported', { fromStatus: t.status, toStatus: status, note: `${item.productName} ${qty} ${item.unit}`, reason: note, diff: { at: custodyId } }),
    ],
  }
}

/**
 * "พบสินค้าส่งผิดสาขา" — reported by the branch that has the goods. They stay in transit:
 * not this branch's stock until a manager decides.
 */
export async function reportMisroute(params: {
  transferId: string
  itemIdx: number
  actualCustodyLocationId: string
  qty: number
  actor: Actor
  note?: string
}): Promise<Transfer> {
  const { transferId, itemIdx, actualCustodyLocationId, qty, actor, note } = params
  if (!canUserAccessBranch(actor, actualCustodyLocationId)) throw new AppError('ไม่มีสิทธิ์รายงานในนามสาขานี้')
  if (actualCustodyLocationId === TRANSIT_LOCATION_ID) throw new AppError('กรุณาเลือกสาขาที่ได้รับสินค้าไปจริง')
  const db = scoped()
  const updated = await db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    const loc = await tx.get<StockLocation>(COL.locations, actualCustodyLocationId)
    if (!loc || loc.active === false) throw new AppError('ไม่พบคลังในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
    const item = cur.items.find((i) => i.idx === itemIdx && !i.removed)
    if (!item) throw new AppError('ไม่พบรายการสินค้า')
    const next = foundAt({ ...cur, id: transferId }, item.productId, actualCustodyLocationId, roundQty(qty), actor, note)
    write(tx, next)
    return clean(next)
  })
  const locations = await db.getAll<StockLocation>(COL.locations)
  const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
  await deliver(transferIssueDraft(updated, locName, actor.name), actor)
  return updated
}

/**
 * A manager decides what happens to goods found at the wrong branch:
 *
 *   redirect  transit → the branch that has them; with `createReplacement`, a new draft
 *             from the source to the original destination for the shortfall there
 *   forward   a leg from the branch that has them to the original destination
 *   return    a leg from the branch that has them back to the source
 *
 * A leg starts in transit — the goods already are — and no stock moves until it is
 * received. The source is not deducted again.
 */
export async function resolveMisroute(params: {
  transferId: string
  itemIdx: number
  misrouteId: string
  action: 'redirect' | 'forward' | 'return'
  actor: Actor
  note?: string
  createReplacement?: boolean
}): Promise<{ transfer: Transfer; childTransfer?: Transfer; replacement?: Transfer }> {
  const { transferId, itemIdx, misrouteId, action, actor, note, createReplacement } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่จัดการการส่งผิดสาขาได้')
  const db = scoped()

  return filing(db, async (tx, file) => {
    // ---- reads ----
    const { cur, legs, parent, siblings } = await readFamily(tx, transferId)
    const item = cur.items.find((i) => i.idx === itemIdx && !i.removed)
    const misroute = item?.misroutes?.find((m) => m.id === misrouteId)
    if (!item || !misroute) throw new AppError('ไม่พบรายการส่งผิดสาขา')
    if (misroute.resolution) throw new AppError('รายการส่งผิดสาขานี้ได้รับการจัดการไปแล้ว')
    if (misroute.qty > (item.inTransitQty ?? 0)) throw new AppError('ยอดระหว่างขนส่งของรายการนี้ไม่พอ')
    const now = Date.now()
    const why = note?.trim() || undefined

    let plan: { commit: () => string } | null = null
    let legSeq: Awaited<ReturnType<typeof takeSeq>> | null = null
    let replacementSeq: Awaited<ReturnType<typeof takeSeq>> | null = null
    if (action === 'redirect') {
      plan = await planIssue(
        tx,
        {
          lines: [{ productId: item.productId, productName: item.productName, unit: item.unit, qty: misroute.qty }],
          fromLocationId: TRANSIT_LOCATION_ID,
          toLocationId: misroute.actualCustodyLocationId,
          date: now,
          actor,
          note: why ?? `เปลี่ยนปลายทาง: รับเข้าสาขาที่ได้รับของจริง (${cur.docNo})`,
          transferId: cur.id,
        },
        file,
      )
      // One counter read covers the replacement's number; a second takeSeq would read the
      // same value and hand out the same number twice.
      if (createReplacement) replacementSeq = await takeSeq(tx, 'transfer')
    } else {
      legSeq = await takeSeq(tx, 'transfer')
    }

    // ---- writes ----
    const movementDocNo = plan?.commit()
    let childTransfer: Transfer | undefined
    let replacement: Transfer | undefined
    if (legSeq) {
      legSeq.commit()
      childTransfer = {
        id: genId(),
        docNo: docNoOf(legSeq.seq),
        status: 'inTransit',
        revision: 1,
        fromLocationId: misroute.actualCustodyLocationId,
        toLocationId: action === 'forward' ? misroute.originalDestinationId : cur.fromLocationId,
        dispatchDate: now,
        note: why,
        parentId: cur.id,
        legKind: action === 'forward' ? 'forward' : 'return',
        requestedBy: actor.id,
        requestedByName: actor.name,
        approvedBy: actor.id,
        approvedByName: actor.name,
        approvedAt: now,
        items: [
          {
            idx: 0,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            unit: item.unit,
            requestedQty: misroute.qty,
            dispatchQty: misroute.qty,
            inTransitQty: misroute.qty,
          },
        ],
        history: [entry(actor, 'legCreated', { toStatus: 'inTransit', note: `${action} ← ${cur.docNo}` })],
        createdAt: now,
        updatedAt: now,
      }
      write(tx, childTransfer!)
    }
    if (replacementSeq) {
      replacementSeq.commit()
      replacement = {
        id: genId(),
        docNo: docNoOf(replacementSeq.seq),
        status: 'draft',
        revision: 1,
        fromLocationId: cur.fromLocationId,
        toLocationId: misroute.originalDestinationId,
        dispatchDate: now,
        note: `ส่งทดแทน ${cur.docNo}`,
        parentId: cur.id,
        legKind: 'replacement',
        requestedBy: actor.id,
        requestedByName: actor.name,
        items: [
          { idx: 0, productId: item.productId, productName: item.productName, sku: item.sku, unit: item.unit, requestedQty: misroute.qty, dispatchQty: misroute.qty },
        ],
        history: [entry(actor, 'created', { note: `ส่งทดแทน ${cur.docNo}` })],
        createdAt: now,
        updatedAt: now,
      }
      write(tx, replacement)
    }

    const items = cur.items.map((i) =>
      i.idx !== itemIdx
        ? i
        : {
            ...i,
            // Redirected goods left transit; forwarded/returned ones are now the leg's.
            inTransitQty: roundQty((i.inTransitQty ?? 0) - misroute.qty),
            misroutes: (i.misroutes ?? []).map((m) =>
              m.id !== misrouteId
                ? m
                : {
                    ...m,
                    resolution: {
                      action,
                      by: actor.id,
                      byName: actor.name,
                      at: now,
                      note: why,
                      childTransferId: childTransfer?.id,
                      replacementTransferId: replacement?.id,
                      movementDocNo,
                    },
                  },
            ),
          },
    )
    const childIds = childTransfer ? [...(cur.childIds ?? []), childTransfer.id] : cur.childIds
    const allLegs = childTransfer ? [...legs, childTransfer] : legs
    const next = settledStatus({ ...cur, items }, allLegs)
    const updated: Transfer = {
      ...cur,
      status: next,
      childIds,
      items,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, action === 'redirect' ? 'redirected' : action === 'forward' ? 'forwarded' : 'returnedToSource', {
          fromStatus: cur.status,
          toStatus: next,
          note: [item.productName, `${misroute.qty} ${item.unit}`, movementDocNo, childTransfer?.docNo, replacement?.docNo].filter(Boolean).join(' · '),
          reason: why,
        }),
      ],
    }
    write(tx, updated)
    rollUpParent(tx, parent, siblings, updated, actor)
    return { transfer: clean(updated), childTransfer: childTransfer && clean(childTransfer), replacement: replacement && clean(replacement) }
  })
}

export async function cancelTransfer(transferId: string, actor: Actor, reason: string): Promise<Transfer> {
  const why = reason.trim()
  if (!why) throw new AppError('กรุณาระบุเหตุผล')
  return scoped().transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'draft' && cur.status !== 'returned' && cur.status !== 'pendingApproval') {
      throw new AppError('ไม่สามารถยกเลิกเอกสารที่ตัดสต๊อกไปแล้วได้')
    }
    if (cur.requestedBy !== actor.id && !isManager(actor.role)) throw new AppError('ไม่มีสิทธิ์ยกเลิกเอกสารนี้')
    const now = Date.now()
    const updated: Transfer = {
      ...cur,
      id: transferId,
      status: 'cancelled',
      cancelReason: why,
      cancelledBy: actor.id,
      cancelledAt: now,
      updatedAt: now,
      history: [...cur.history, entry(actor, 'cancelled', { fromStatus: cur.status, toStatus: 'cancelled', reason: why })],
    }
    write(tx, updated)
    return clean(updated)
  })
}

export function transferCounterFloors(transfers: Pick<Transfer, 'docNo'>[]): [string, number][] {
  let max = 0
  for (const t of transfers) {
    const m = /^TR-(\d+)$/.exec(t.docNo ?? '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max > 0 ? [['transfer', max]] : []
}
