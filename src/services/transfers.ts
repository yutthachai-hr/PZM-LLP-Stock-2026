import { backend } from '../backend'
import type { Backend } from '../backend/types'
import { getBrand, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import {
  canCreateTransfer,
  canEditItems,
  canReceive,
  canSubmit,
  canUserAccessBranch,
  isManager,
} from '../lib/transferStatus'
import {
  transferArrivingDraft,
  transferIssueDraft,
  transferSubmittedDraft,
} from '../lib/inventoryRules/notifications'
import { deliver } from './notifications'
import { genId } from '../lib/id'
import { roundQty } from '../lib/validate'
import { takeSeq } from './sequence'
import { execute } from './stock'
import {
  COL,
  TRANSIT_LOCATION_ID,
  type DiscrepancyReason,
  type DiscrepancyResolutionCode,
  type StockLevel,
  type StockLocation,
  type StockMovement,
  type Transfer,
  type TransferItem,
  type TransferLegKind,
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

import {
  checkItems,
  clean,
  docNoOf,
  entry,
  foundAt,
  lineChanges,
  REASONS,
  write,
  type Actor,
  type ReceivedLineInput,
} from '../commands/transferTx'
import { approveTransferCommand, receiveTransferCommand, resolveDiscrepancyCommand, resolveMisrouteCommand } from '../commands/transferCommands'
export {
  expectedQty,
  misroutedQty,
  reportableQty,
  settledStatus,
  type Actor,
  type ReceivedLineInput,
} from '../commands/transferTx'

function scoped(): Backend {
  return backend.forBrand(getBrand())
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
  // One `in` query, not one per status: an empty query still costs a read, and this ran
  // five times on every dashboard mount (perf/firestore-read-budget).
  const rows = await db.query<Transfer>(COL.transfers, { filters: [{ field: 'status', op: 'in', value: ACTIVE }] }, { label: 'transfers.active' })
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
  const rows = await db.query<Transfer>(COL.transfers, { filters: [{ field: 'status', op: 'in', value: ['pendingApproval', ...ACTIVE] }] }, { label: 'transfers.open' })
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** The ledger rows a document produced — its own and its legs'. */
export async function transferMovements(ids: string[]): Promise<StockMovement[]> {
  const db = scoped()
  const rows = (await Promise.all(ids.map((id) => db.getBy<StockMovement>(COL.movements, 'transferId', id)))).flat()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

// ---------------------------------------------------------------- lines ----

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

  const approved = await execute(approveTransferCommand, { transferId, expectedRevision, ...(note !== undefined ? { note } : {}), ...(items ? { items } : {}) }, actor)
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
  const { transfer: result, problem } = await execute(receiveTransferCommand, { transferId, receivedLines, ...(note !== undefined ? { note } : {}) }, actor)

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

  return execute(resolveDiscrepancyCommand, { transferId, itemIdx, resolution, ...(custodyLocationId ? { custodyLocationId } : {}), ...(relatedTransferId ? { relatedTransferId } : {}) }, actor)
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

  return execute(resolveMisrouteCommand, { transferId, itemIdx, misrouteId, action, ...(note !== undefined ? { note } : {}), ...(createReplacement !== undefined ? { createReplacement } : {}) }, actor)
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
