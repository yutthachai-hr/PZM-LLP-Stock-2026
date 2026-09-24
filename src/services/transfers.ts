import { backend } from '../backend'
import type { Backend } from '../backend/types'
import { getBrand, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import {
  canCreateTransfer,
  canEditItems,
  canReceive,
  canSubmit,
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
import { padSeq, takeSeq } from './sequence'
import {
  filing,
  planAdjust,
  planIssue,
  type MovementLine,
} from './stock'
import {
  COL,
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
  type TransferLegKind,
  type TransferMisroute,
  type TransferStatus,
} from '../types'

export interface Actor {
  id: string
  name: string
  role: Role
  siteIds?: string[]
}

function scoped(): Backend {
  return backend.forBrand(getBrand())
}

function entry(actor: Actor, action: string, extra: Partial<TransferHistoryEntry> = {}): TransferHistoryEntry {
  const kept = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  return { at: Date.now(), by: actor.id, byName: actor.name, action, ...kept }
}

function toRecord<T extends object>(doc: T): Record<string, unknown> {
  return doc as unknown as Record<string, unknown>
}

/** Ensure the virtual transit location exists for a brand. */
export async function ensureTransitLocation(brand?: BrandId): Promise<StockLocation> {
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
  await db.set(COL.locations, TRANSIT_LOCATION_ID, toRecord(transit))
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

/** Active transfers for branch arrival / today view. */
export async function listActiveTransfers(locationId?: string): Promise<Transfer[]> {
  const all = await scoped().getAll<Transfer>(COL.transfers)
  const activeStatuses: Set<TransferStatus> = new Set(['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval'])
  return all
    .filter((t) => activeStatuses.has(t.status) && (!locationId || t.toLocationId === locationId || t.fromLocationId === locationId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
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
  if (fromLocationId === toLocationId) throw new AppError('ต้นทางและปลายทางต้องต่างกัน')
  if (!canCreateTransfer(actor, fromLocationId)) {
    throw new AppError('ไม่มีสิทธิ์สร้างคำขอโอนจากสาขาต้นทางนี้')
  }

  const db = scoped()
  return db.transaction(async (tx) => {
    const seqResult = await takeSeq(tx, 'transfer')
    seqResult.commit()
    const docNo = `TR-${padSeq(seqResult.seq, 5)}`
    const id = genId()
    const now = Date.now()

    const transfer: Transfer = {
      id,
      docNo,
      status: 'draft',
      revision: 1,
      fromLocationId,
      toLocationId,
      dispatchDate,
      note,
      parentId,
      legKind,
      childIds: [],
      requestedBy: actor.id,
      requestedByName: actor.name,
      items: [],
      history: [entry(actor, 'draftCreated')],
      createdAt: now,
      updatedAt: now,
    }

    if (parentId) {
      const parent = await tx.get<Transfer>(COL.transfers, parentId)
      if (parent) {
        tx.set(COL.transfers, parentId, toRecord({
          ...parent,
          childIds: [...(parent.childIds ?? []), id],
          updatedAt: now,
        }))
      }
    }

    tx.set(COL.transfers, id, toRecord(transfer))
    return transfer
  })
}

export async function saveItems(
  transferId: string,
  items: TransferItem[],
  actor: Actor,
  note?: string,
): Promise<Transfer> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (!canEditItems(cur, actor)) throw new AppError('ไม่มีสิทธิ์แก้ไขรายการในสถานะนี้')

    const now = Date.now()
    const updated: Transfer = {
      ...cur,
      items,
      ...(note !== undefined ? { note } : {}),
      updatedAt: now,
      history: [...cur.history, entry(actor, 'itemsUpdated')],
    }
    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })
}

export async function submitTransfer(
  transferId: string,
  actor: Actor,
  items?: TransferItem[],
): Promise<Transfer> {
  const db = scoped()
  let finalTransfer: Transfer | null = null

  await db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    const candidateItems = items ?? cur.items
    if (!canSubmit({ ...cur, items: candidateItems }, actor)) {
      throw new AppError('ไม่สามารถส่งคำขอโอนได้')
    }

    // Snapshot current warehouse stock for each line
    const fromLevels = await Promise.all(
      candidateItems.map((item) =>
        tx.get<StockLevel>(COL.stockLevels, `${cur.fromLocationId}__${item.productId}`),
      ),
    )

    const now = Date.now()
    const nextRevision = cur.status === 'returned' ? cur.revision + 1 : cur.revision
    const populatedItems = candidateItems.map((item, idx) => ({
      ...item,
      idx,
      stockAtSubmit: fromLevels[idx]?.qty ?? 0,
      dispatchQty: item.dispatchQty ?? item.requestedQty ?? 0,
      dispatchEntryQty: item.dispatchEntryQty ?? item.requestedEntryQty,
      dispatchEntryUnit: item.dispatchEntryUnit ?? item.requestedEntryUnit,
    }))

    const updated: Transfer = {
      ...cur,
      status: 'pendingApproval',
      revision: nextRevision,
      submittedAt: now,
      items: populatedItems,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'submitted', {
          fromStatus: cur.status,
          toStatus: 'pendingApproval',
        }),
      ],
    }

    tx.set(COL.transfers, transferId, toRecord(updated))
    finalTransfer = updated
  })

  if (finalTransfer) {
    const locations = await db.getAll<StockLocation>(COL.locations)
    const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
    await deliver(transferSubmittedDraft(finalTransfer, locName), actor)
    return finalTransfer
  }
  throw new AppError('ไม่สามารถส่งคำขอโอนได้')
}

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

  if (action === 'return' || action === 'reject') {
    return db.transaction(async (tx) => {
      const cur = await tx.get<Transfer>(COL.transfers, transferId)
      if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
      if (cur.status !== 'pendingApproval') throw new AppError('เอกสารไม่ได้อยู่ในสถานะรออนุมัติ')
      if (cur.revision !== expectedRevision) throw new AppError('เอกสารมีการแก้ไข กรุณาโหลดใหม่')

      const toStatus: TransferStatus = action === 'return' ? 'returned' : 'rejected'
      const now = Date.now()
      const updated: Transfer = {
        ...cur,
        status: toStatus,
        updatedAt: now,
        history: [
          ...cur.history,
          entry(actor, action, {
            fromStatus: cur.status,
            toStatus,
            note,
          }),
        ],
      }
      tx.set(COL.transfers, transferId, toRecord(updated))
      return updated
    })
  }

  // Action: 'approve' -> Atomic issue to virtual transit location
  return filing(db, async (tx, file) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'pendingApproval') throw new AppError('เอกสารไม่ได้อยู่ในสถานะรออนุมัติ')
    if (cur.revision !== expectedRevision) throw new AppError('เอกสารมีการแก้ไข กรุณาโหลดใหม่')

    // Ensure transit location exists
    const transit = await tx.get<StockLocation>(COL.locations, TRANSIT_LOCATION_ID)
    if (!transit) {
      throw new AppError('ยังไม่ได้เปิดใช้ระบบส่งสินค้า (ไม่พบคลังระหว่างขนส่ง)')
    }

    const reviewItems = items ?? cur.items
    const live = liveItems(reviewItems)
    if (live.length === 0) throw new AppError('ไม่มีรายการสินค้าที่อนุมัติ')

    const movementLines: MovementLine[] = live.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unit: i.unit,
      qty: i.dispatchQty,
      entryUnit: i.dispatchEntryUnit,
      entryQty: i.dispatchEntryQty,
    }))

    // Plan issue: source warehouse -> transit
    const planned = await planIssue(
      tx,
      {
        lines: movementLines,
        fromLocationId: cur.fromLocationId,
        toLocationId: TRANSIT_LOCATION_ID,
        date: cur.dispatchDate,
        actor,
        note: cur.note,
        transferId: cur.id,
      },
      file,
    )

    const issueDocNo = planned.commit()
    const now = Date.now()

    const updated: Transfer = {
      ...cur,
      status: 'inTransit',
      approvedBy: actor.id,
      approvedByName: actor.name,
      approvedAt: now,
      dispatchMovementDocNo: issueDocNo,
      items: reviewItems,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'approved', {
          fromStatus: cur.status,
          toStatus: 'inTransit',
          note: `อนุมัติและย้ายเข้าคลังระหว่างขนส่ง (${issueDocNo})`,
        }),
      ],
    }

    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  }).then(async (updatedTransfer) => {
    const locations = await db.getAll<StockLocation>(COL.locations)
    const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
    await deliver(transferArrivingDraft(updatedTransfer, locName), actor)
    return updatedTransfer
  })
}

export async function openReceiving(transferId: string, actor: Actor): Promise<Transfer> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'inTransit') return cur // already receiving or later
    if (!canReceive(cur, actor)) throw new AppError('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')

    const now = Date.now()
    const updated: Transfer = {
      ...cur,
      status: 'receiving',
      updatedAt: now,
      history: [...cur.history, entry(actor, 'receivingOpened')],
    }
    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })
}

export interface ReceivedLineInput {
  idx: number
  receivedQty: number
  receivedEntryQty?: number
  receivedEntryUnit?: string
  discrepancy?: {
    kind: DiscrepancyKind
    qty: number
    reason: DiscrepancyReason
    note?: string
    photoId?: string
  }
}

export async function confirmReceive(params: {
  transferId: string
  actor: Actor
  receivedLines: ReceivedLineInput[]
  note?: string
}): Promise<Transfer> {
  const { transferId, actor, receivedLines, note } = params
  const db = scoped()

  let hasDiscrepancy = false

  const updatedTransfer = await filing(db, async (tx, file) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'inTransit' && cur.status !== 'receiving') {
      throw new AppError('เอกสารไม่ได้อยู่ในสถานะพร้อมตรวจรับ')
    }
    if (!canReceive(cur, actor)) throw new AppError('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')

    const byIdx = new Map(receivedLines.map((r) => [r.idx, r]))
    const now = Date.now()

    const updatedItems = cur.items.map((item) => {
      const input = byIdx.get(item.idx)
      if (!input || item.removed) return item

      let disc: TransferDiscrepancy | undefined = undefined
      if (input.discrepancy) {
        hasDiscrepancy = true
        disc = {
          ...input.discrepancy,
          reportedBy: actor.id,
          reportedByName: actor.name,
          reportedAt: now,
        }
      } else if (input.receivedQty !== item.dispatchQty) {
        hasDiscrepancy = true
        disc = {
          kind: input.receivedQty < item.dispatchQty ? 'short' : 'over',
          qty: Math.abs(input.receivedQty - item.dispatchQty),
          reason: input.receivedQty < item.dispatchQty ? 'SHORT' : 'OVER',
          reportedBy: actor.id,
          reportedByName: actor.name,
          reportedAt: now,
        }
      }

      return {
        ...item,
        receivedQty: input.receivedQty,
        receivedEntryQty: input.receivedEntryQty,
        receivedEntryUnit: input.receivedEntryUnit,
        discrepancy: disc,
      }
    })

    // Move goods that arrived from transit -> destination branch
    // (Only move up to dispatchQty; any overage remains pending resolution)
    const goodsToReceive = updatedItems.filter(
      (i) => !i.removed && (i.receivedQty ?? 0) > 0,
    )

    let receiveDocNo: string | undefined = undefined
    if (goodsToReceive.length > 0) {
      const movementLines: MovementLine[] = goodsToReceive.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        unit: i.unit,
        qty: Math.min(i.receivedQty!, i.dispatchQty),
        entryUnit: i.receivedEntryUnit,
        entryQty: i.receivedEntryQty,
      }))

      const planned = await planIssue(
        tx,
        {
          lines: movementLines,
          fromLocationId: TRANSIT_LOCATION_ID,
          toLocationId: cur.toLocationId,
          date: now,
          actor,
          note: note ?? cur.note,
          transferId: cur.id,
        },
        file,
      )
      receiveDocNo = planned.commit()
    }

    const nextStatus: TransferStatus = hasDiscrepancy ? 'discrepancy' : 'completed'
    const updated: Transfer = {
      ...cur,
      status: nextStatus,
      receivedBy: actor.id,
      receivedByName: actor.name,
      receivedAt: now,
      receiveMovementDocNo: receiveDocNo,
      items: updatedItems,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'received', {
          fromStatus: cur.status,
          toStatus: nextStatus,
          note: hasDiscrepancy
            ? 'รับของพบผลต่างหรือปัญหา รอหัวหน้าพิจารณา'
            : `รับสินค้าครบถ้วน (${receiveDocNo ?? '-'})`,
        }),
      ],
    }

    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })

  if (hasDiscrepancy) {
    const locations = await db.getAll<StockLocation>(COL.locations)
    const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
    await deliver(transferIssueDraft(updatedTransfer, locName, actor.name), actor)
  }

  return updatedTransfer
}

export async function submitDiscrepancyForApproval(
  transferId: string,
  actor: Actor,
): Promise<Transfer> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'discrepancy') throw new AppError('เอกสารไม่ได้อยู่ในสถานะมีผลต่าง')

    const now = Date.now()
    const updated: Transfer = {
      ...cur,
      status: 'pendingDiscrepancyApproval',
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'discrepancySubmitted', {
          fromStatus: cur.status,
          toStatus: 'pendingDiscrepancyApproval',
        }),
      ],
    }
    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })
}

export async function resolveDiscrepancy(params: {
  transferId: string
  itemIdx: number
  resolution: {
    code: DiscrepancyResolutionCode
    qty: number
    note?: string
  }
  actor: Actor
}): Promise<Transfer> {
  const { transferId, itemIdx, resolution, actor } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่อนุมัติผลต่างได้')

  const db = scoped()

  return filing(db, async (tx, file) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'discrepancy' && cur.status !== 'pendingDiscrepancyApproval') {
      throw new AppError('เอกสารไม่ได้อยู่ในสถานะรอพิจารณาผลต่าง')
    }

    const item = cur.items.find((i) => i.idx === itemIdx)
    if (!item || !item.discrepancy) throw new AppError('ไม่พบรายการผลต่างที่ระบุ')

    const now = Date.now()
    let movementDocNo: string | undefined = undefined

    switch (resolution.code) {
      case 'NOT_ACTUALLY_LOADED': {
        // Short: never loaded, return from transit -> source warehouse
        const planned = await planIssue(
          tx,
          {
            lines: [{ productId: item.productId, productName: item.productName, unit: item.unit, qty: resolution.qty }],
            fromLocationId: TRANSIT_LOCATION_ID,
            toLocationId: cur.fromLocationId,
            date: now,
            actor,
            note: resolution.note ?? 'ผลต่าง: ไม่ได้ขึ้นของจริง คืนสต๊อกต้นทาง',
            transferId: cur.id,
          },
          file,
        )
        movementDocNo = planned.commit()
        break
      }
      case 'TRANSIT_LOSS': {
        // Short: lost in transit, adjust out from transit
        const planned = await planAdjust(
          tx,
          {
            lines: [
              {
                productId: item.productId,
                productName: item.productName,
                unit: item.unit,
                qty: resolution.qty,
                direction: 'out',
                reason: 'lost',
              },
            ],
            locationId: TRANSIT_LOCATION_ID,
            date: now,
            actor,
            note: resolution.note ?? 'ผลต่าง: สูญหายระหว่างขนส่ง',
            transferId: cur.id,
          },
          file,
        )
        movementDocNo = planned.commit()
        break
      }
      case 'DAMAGED': {
        // Short: damaged in transit, adjust out from transit
        const planned = await planAdjust(
          tx,
          {
            lines: [
              {
                productId: item.productId,
                productName: item.productName,
                unit: item.unit,
                qty: resolution.qty,
                direction: 'out',
                reason: 'damage',
              },
            ],
            locationId: TRANSIT_LOCATION_ID,
            date: now,
            actor,
            note: resolution.note ?? 'ผลต่าง: ชำรุดเสียหายระหว่างขนส่ง',
            transferId: cur.id,
          },
          file,
        )
        movementDocNo = planned.commit()
        break
      }
      case 'WEIGHING_ERROR': {
        // Short: weighing variance; issue the remaining quantity transit -> destination
        const planned = await planIssue(
          tx,
          {
            lines: [{ productId: item.productId, productName: item.productName, unit: item.unit, qty: resolution.qty }],
            fromLocationId: TRANSIT_LOCATION_ID,
            toLocationId: cur.toLocationId,
            date: now,
            actor,
            note: resolution.note ?? 'ผลต่าง: แก้ไขยอดรับจริงจากการชั่งน้ำหนัก',
            transferId: cur.id,
          },
          file,
        )
        movementDocNo = planned.commit()
        break
      }
      case 'DISPATCH_WRONG': {
        // Over: warehouse dispatched extra. Source -> transit -> destination
        const planned = await planIssue(
          tx,
          {
            lines: [{ productId: item.productId, productName: item.productName, unit: item.unit, qty: resolution.qty }],
            fromLocationId: cur.fromLocationId,
            toLocationId: cur.toLocationId,
            date: now,
            actor,
            note: resolution.note ?? 'ผลต่าง: คลังส่งเกินจริง ย้ายเข้าสาขา',
            transferId: cur.id,
          },
          file,
        )
        movementDocNo = planned.commit()
        break
      }
      case 'APPROVED_ADJUSTMENT': {
        // Over: adjust in at destination
        const planned = await planAdjust(
          tx,
          {
            lines: [
              {
                productId: item.productId,
                productName: item.productName,
                unit: item.unit,
                qty: resolution.qty,
                direction: 'in',
                reason: 'found',
              },
            ],
            locationId: cur.toLocationId,
            date: now,
            actor,
            note: resolution.note ?? 'ผลต่าง: อนุมัติรับเข้าสต๊อกสาขา',
            transferId: cur.id,
          },
          file,
        )
        movementDocNo = planned.commit()
        break
      }
      case 'COUNT_ERROR':
      case 'WRONG_BRANCH':
      case 'BELONGS_TO_OTHER_TRANSFER': {
        // Counting error or misroute reference: no stock adjustment on transit
        break
      }
    }

    const updatedItems = cur.items.map((i) => {
      if (i.idx !== itemIdx || !i.discrepancy) return i
      return {
        ...i,
        discrepancy: {
          ...i.discrepancy,
          resolution: {
            code: resolution.code,
            qty: resolution.qty,
            by: actor.id,
            byName: actor.name,
            at: now,
            note: resolution.note,
            movementDocNo,
          },
        },
      }
    })

    const allResolved = updatedItems.every(
      (i) => !i.discrepancy || !!i.discrepancy.resolution,
    )

    const nextStatus: TransferStatus = allResolved ? 'completed' : 'resolved'
    const updated: Transfer = {
      ...cur,
      status: nextStatus,
      items: updatedItems,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'discrepancyResolved', {
          fromStatus: cur.status,
          toStatus: nextStatus,
          note: `แก้ไขผลต่าง: ${resolution.code} (${resolution.qty} ${item.unit})`,
        }),
      ],
    }

    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })
}

export async function reportMisroute(params: {
  transferId: string
  itemIdx: number
  actualCustodyLocationId: string
  qty: number
  actor: Actor
  note?: string
}): Promise<Transfer> {
  const { transferId, itemIdx, actualCustodyLocationId, qty, actor, note } = params
  const db = scoped()

  const updatedTransfer = await db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'inTransit' && cur.status !== 'receiving' && cur.status !== 'discrepancy') {
      throw new AppError('ไม่สามารถรายงานสินค้าส่งผิดสาขาบนเอกสารนี้ได้')
    }

    const item = cur.items.find((i) => i.idx === itemIdx)
    if (!item) throw new AppError('ไม่พบรายการสินค้า')

    const now = Date.now()
    const misrouteEntry: TransferMisroute = {
      id: genId(),
      actualCustodyLocationId,
      originalDestinationId: cur.toLocationId,
      qty,
      reportedBy: actor.id,
      reportedByName: actor.name,
      reportedAt: now,
      note,
    }

    const updatedItems = cur.items.map((i) => {
      if (i.idx !== itemIdx) return i
      return {
        ...i,
        misroutes: [...(i.misroutes ?? []), misrouteEntry],
      }
    })

    const updated: Transfer = {
      ...cur,
      status: 'discrepancy',
      items: updatedItems,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'misrouteReported', {
          note: `พบสินค้าส่งผิดสาขา ${qty} ${item.unit}`,
        }),
      ],
    }

    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })

  const locations = await db.getAll<StockLocation>(COL.locations)
  const locName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''
  await deliver(transferIssueDraft(updatedTransfer, locName, actor.name), actor)

  return updatedTransfer
}

export async function resolveMisroute(params: {
  transferId: string
  itemIdx: number
  misrouteId: string
  action: 'redirect' | 'forward' | 'return'
  actor: Actor
  note?: string
}): Promise<{ transfer: Transfer; childTransfer?: Transfer }> {
  const { transferId, itemIdx, misrouteId, action, actor, note } = params
  if (!isManager(actor.role)) throw new AppError('เฉพาะหัวหน้าเท่านั้นที่จัดการการส่งผิดสาขาได้')

  const db = scoped()

  return filing(db, async (tx, file) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')

    const item = cur.items.find((i) => i.idx === itemIdx)
    const misroute = item?.misroutes?.find((m) => m.id === misrouteId)
    if (!item || !misroute) throw new AppError('ไม่พบรายการส่งผิดสาขา')

    const now = Date.now()
    let childTransfer: Transfer | undefined = undefined

    if (action === 'redirect') {
      // Stock moves transit -> actual custody location
      const planned = await planIssue(
        tx,
        {
          lines: [{ productId: item.productId, productName: item.productName, unit: item.unit, qty: misroute.qty }],
          fromLocationId: TRANSIT_LOCATION_ID,
          toLocationId: misroute.actualCustodyLocationId,
          date: now,
          actor,
          note: note ?? `เปลี่ยนปลายทางให้สาขาที่ได้รับจริง (${cur.docNo})`,
          transferId: cur.id,
        },
        file,
      )
      planned.commit()
    } else if (action === 'forward' || action === 'return') {
      // Create child leg transfer directly starting in inTransit (stock is already in transit)
      const seqResult = await takeSeq(tx, 'transfer')
      seqResult.commit()
      const childDocNo = `TR-${padSeq(seqResult.seq, 5)}`
      const childId = genId()
      const destination = action === 'forward' ? misroute.originalDestinationId : cur.fromLocationId

      childTransfer = {
        id: childId,
        docNo: childDocNo,
        status: 'inTransit',
        revision: 1,
        fromLocationId: misroute.actualCustodyLocationId,
        toLocationId: destination,
        dispatchDate: now,
        note: `สายส่งต่อ (${action}) จาก ${cur.docNo}`,
        parentId: cur.id,
        legKind: action,
        childIds: [],
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
          },
        ],
        history: [entry(actor, 'childLegCreated', { note: `สร้างสายส่งต่อ ${action}` })],
        createdAt: now,
        updatedAt: now,
      }
      tx.set(COL.transfers, childId, toRecord(childTransfer))
    }

    const updatedItems = cur.items.map((i) => {
      if (i.idx !== itemIdx || !i.misroutes) return i
      return {
        ...i,
        misroutes: i.misroutes.map((m) =>
          m.id === misrouteId
            ? {
                ...m,
                resolution: {
                  action,
                  by: actor.id,
                  byName: actor.name,
                  at: now,
                  note,
                  childTransferId: childTransfer?.id,
                },
              }
            : m,
        ),
      }
    })

    const hasUnresolvedMisroute = updatedItems.some(
      (i) => i.misroutes?.some((m) => !m.resolution),
    )
    const nextStatus: TransferStatus = hasUnresolvedMisroute
      ? cur.status
      : cur.receivedAt
        ? (updatedItems.every((i) => !i.discrepancy || i.discrepancy.resolution) ? 'completed' : 'resolved')
        : 'inTransit'

    const updated: Transfer = {
      ...cur,
      status: nextStatus,
      childIds: childTransfer ? [...(cur.childIds ?? []), childTransfer.id] : cur.childIds,
      items: updatedItems,
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'misrouteResolved', {
          fromStatus: cur.status,
          toStatus: nextStatus,
          note: `จัดการส่งผิดสาขา: ${action}`,
        }),
      ],
    }

    tx.set(COL.transfers, transferId, toRecord(updated))
    return { transfer: updated, childTransfer }
  })
}

export async function cancelTransfer(
  transferId: string,
  actor: Actor,
  reason: string,
): Promise<Transfer> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const cur = await tx.get<Transfer>(COL.transfers, transferId)
    if (!cur) throw new AppError('ไม่พบเอกสารโอนสินค้า')
    if (cur.status !== 'draft' && cur.status !== 'returned' && cur.status !== 'pendingApproval') {
      throw new AppError('ไม่สามารถยกเลิกเอกสารที่ตัดสต๊อกไปแล้วได้')
    }
    const own = cur.requestedBy === actor.id
    if (!own && !isManager(actor.role)) throw new AppError('ไม่มีสิทธิ์ยกเลิกเอกสารนี้')

    const now = Date.now()
    const updated: Transfer = {
      ...cur,
      status: 'cancelled',
      updatedAt: now,
      history: [
        ...cur.history,
        entry(actor, 'cancelled', {
          fromStatus: cur.status,
          toStatus: 'cancelled',
          reason,
        }),
      ],
    }
    tx.set(COL.transfers, transferId, toRecord(updated))
    return updated
  })
}

export function transferCounterFloors(transfers: Transfer[]): [string, number][] {
  let max = 0
  for (const t of transfers) {
    const m = /^TR-(\d+)$/.exec(t.docNo)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max > 0 ? [['transfer', max]] : []
}
