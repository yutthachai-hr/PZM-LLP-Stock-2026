import type { TxContext } from '../backend/tx'
import { AppError } from '../i18n/AppError'
import { canReceive, isManager, liveItems } from '../lib/transferStatus'
import { genId } from '../lib/id'
import { roundQty } from '../lib/validate'
import { padSeq, takeSeq } from '../services/sequence'
import { planAdjust, planIssue, type FileMovement, type MovementLine } from './ledgerTx'
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
  type Transfer,
  type TransferDiscrepancy,
  type TransferHistoryEntry,
  type TransferItem,
  type TransferMisroute,
  type TransferStatus,
} from '../types'

/**
 * The transfer steps that move stock (ADR-001): approving (source → transit), receiving
 * (transit → destination), settling a difference, and deciding a misroute — each a
 * transaction body over a given TxContext, so the app (services/transfers.ts) and the
 * trusted command boundary run the same code. Moved out of services/transfers.ts on
 * 6 Oct 2026, with the helpers they share; that file re-exports what screens use.
 */

export interface Actor {
  id: string
  name: string
  role: Role
  siteIds?: string[]
}

export const MAX_ITEMS = 200
export const MAX_HISTORY = 500


export function entry(actor: Actor, action: string, extra: Partial<TransferHistoryEntry> = {}): TransferHistoryEntry {
  const kept = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  return { at: Date.now(), by: actor.id, byName: actor.name, action, ...kept }
}

/** Firestore refuses `undefined` anywhere in a document, however deep. */
export function clean<T>(value: T): T {
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

export function write(tx: TxContext, t: Transfer): void {
  const { id, ...data } = clean({ ...t, history: t.history.slice(-MAX_HISTORY) })
  tx.set(COL.transfers, id, data as Record<string, unknown>)
}

export const docNoOf = (seq: number) => `TR-${padSeq(seq, 5)}`
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
export async function readFamily(
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
export function rollUpParent(
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

export function checkItems(items: TransferItem[]): TransferItem[] {
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
export function lineChanges(before: TransferItem[], after: TransferItem[], actor: Actor, field: 'requested' | 'dispatch'): TransferHistoryEntry[] {
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

export const REASONS: readonly DiscrepancyReason[] = ['SHORT', 'OVER', 'WEIGHT_VARIANCE', 'DAMAGED', 'WRONG_ITEM', 'WRONG_BRANCH', 'COUNTING_ERROR', 'OTHER']

/**
 * Record `qty` of a product found at `custodyId` against document `t`, the way reportMisroute
 * does — shared with BELONGS_TO_OTHER_TRANSFER, where the overage at one branch is the
 * missing goods of another document.
 */
export function foundAt(t: Transfer, productId: string, custodyId: string, qty: number, actor: Actor, note?: string): Transfer {
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


// ---------------------------------------------------------------- stock-moving steps ----

export interface ApproveParams {
  transferId: string
  expectedRevision: number
  note?: string
  items?: TransferItem[]
}

/** A manager approves: the dispatch quantities move from the source into transit. */
export async function approveTransferInTx(tx: TxContext, file: FileMovement, params: ApproveParams, actor: Actor): Promise<Transfer> {
  const { transferId, expectedRevision, note, items } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่อนุมัติหรือตรวจทานได้')
  const guard = (cur: Transfer | null): Transfer => {
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'pendingApproval') throw new AppError('เอกสารไม่ได้อยู่ในสถานะรออนุมัติ')
    if (cur.revision !== expectedRevision) throw new AppError('เอกสารมีการแก้ไข กรุณาโหลดใหม่')
    return cur
  }

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
}

export interface ReceiveTransferParams {
  transferId: string
  receivedLines: ReceivedLineInput[]
  note?: string
}

/** Confirm what arrived: transit → destination, differences left open (see confirmReceive). */
export async function confirmReceiveInTx(tx: TxContext, file: FileMovement, params: ReceiveTransferParams, actor: Actor): Promise<{ transfer: Transfer; problem: boolean }> {
  const { transferId, receivedLines, note } = params
  let problem = false

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
  return { transfer: clean(updated), problem }
}

export interface ResolveDiscrepancyParams {
  transferId: string
  itemIdx: number
  resolution: { code: DiscrepancyResolutionCode; qty?: number; note?: string }
  custodyLocationId?: string
  relatedTransferId?: string
}

/** A manager settles one line's difference (see resolveDiscrepancy). */
export async function resolveDiscrepancyInTx(tx: TxContext, file: FileMovement, params: ResolveDiscrepancyParams, actor: Actor): Promise<Transfer> {
  const { transferId, itemIdx, resolution, custodyLocationId, relatedTransferId } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่อนุมัติผลต่างได้')

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
}

export interface ResolveMisrouteParams {
  transferId: string
  itemIdx: number
  misrouteId: string
  action: 'redirect' | 'forward' | 'return'
  note?: string
  createReplacement?: boolean
}

/** A manager decides goods found at the wrong branch (see resolveMisroute). */
export async function resolveMisrouteInTx(
  tx: TxContext,
  file: FileMovement,
  params: ResolveMisrouteParams,
  actor: Actor,
): Promise<{ transfer: Transfer; childTransfer?: Transfer; replacement?: Transfer }> {
  const { transferId, itemIdx, misrouteId, action, note, createReplacement } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่จัดการการส่งผิดสาขาได้')

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
}
