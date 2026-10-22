// Browser-free transfer core: the document helpers and the approval that dispatches into
// transit. The browser (services/transfers.ts) and the trusted server command
// (functions/_lib/stockCommand.ts) both approve through planApproveTransfer.
import type { TxContext } from '../backend/tx'
import { AppError } from '../i18n/AppError'
import { liveItems } from '../lib/transferStatus'
import {
  COL,
  TRANSIT_LOCATION_ID,
  type Role,
  type StockLevel,
  type StockLocation,
  type StockMovement,
  type Transfer,
  type TransferHistoryEntry,
  type TransferItem,
} from '../types'
import { planIssue } from './issuePlan'
import type { MovementLine } from './receivePlan'

export interface TransferActor {
  id: string
  name: string
  role: Role
  siteIds?: string[]
}
type Actor = TransferActor

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

export function writeTransfer(tx: TxContext, t: Transfer): void {
  const { id, ...data } = clean({ ...t, history: t.history.slice(-MAX_HISTORY) })
  tx.set(COL.transfers, id, data as Record<string, unknown>)
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

/**
 * A manager's approval: the dispatch quantities leave the source for transit in this commit,
 * and the transfer becomes `inTransit`. Refuses anything but the revision the manager saw.
 */
export async function planApproveTransfer(
  tx: TxContext,
  params: { transferId: string; expectedRevision: number; actor: Actor; note?: string; items?: TransferItem[] },
  file: (mv: Omit<StockMovement, 'id'>) => void,
): Promise<Transfer> {
  const { transferId, expectedRevision, actor, note, items } = params
  // ---- reads ----
  const cur = await tx.get<Transfer>(COL.transfers, transferId)
  if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
  if (cur.status !== 'pendingApproval') throw new AppError('เอกสารไม่ได้อยู่ในสถานะรออนุมัติ')
  if (cur.revision !== expectedRevision) throw new AppError('เอกสารมีการแก้ไข กรุณาโหลดใหม่')
  const transit = await tx.get<StockLocation>(COL.locations, TRANSIT_LOCATION_ID)
  if (!transit) throw new AppError('ยังไม่ได้เปิดใช้ระบบส่งสินค้า (ไม่พบคลังระหว่างขนส่ง)')
  const reviewItems = checkItems(items ?? cur.items)
  const live = liveItems(reviewItems)
  if (live.length === 0) throw new AppError('ไม่มีรายการสินค้าที่อนุมัติ')
  const latest = await Promise.all(live.map((i) => tx.get<StockLevel>(COL.stockLevels, `${cur.fromLocationId}__${i.productId}`)))
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
  const finalItems = reviewItems.map((i) => (i.removed ? i : { ...i, stockAtApprove: stockAt.get(i.idx), inTransitQty: i.dispatchQty }))
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
  writeTransfer(tx, updated)
  return clean(updated)
}
