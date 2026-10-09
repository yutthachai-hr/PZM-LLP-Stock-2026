import type { DiscrepancyReason, DiscrepancyResolutionCode, Role, TransferItem } from '../types'
import { bool, id, list, num, obj, only, optNum, optText, text } from './check'
import { BadInput, defineCommand, type CommandActor } from './spec'
import {
  approveTransferInTx,
  confirmReceiveInTx,
  resolveDiscrepancyInTx,
  resolveMisrouteInTx,
  type Actor,
  type ApproveParams,
  type ReceivedLineInput,
  type ReceiveTransferParams,
  type ResolveDiscrepancyParams,
  type ResolveMisrouteParams,
} from './transferTx'

/**
 * The transfer steps that move stock, as commands (ADR-001). The bodies check who may act
 * (manager, the receiving site) from the actor, which on the server comes from the caller's
 * `users` document. What reaches a transfer document from the request is rebuilt from the
 * known fields only — the service account writes past the rules, so nothing unlisted is
 * carried through.
 */

const ANYONE: readonly Role[] = ['staff', 'manager', 'admin']
const MANAGERS: readonly Role[] = ['manager', 'admin']
const STOCK = { stockMovements: ['set'], stockLevels: ['set'], counters: ['set'] } as const

const asActor = (a: CommandActor): Actor => ({ id: a.id, name: a.name, role: a.role ?? 'staff', ...(a.siteIds ? { siteIds: a.siteIds } : {}) })

/** A line as a manager may send it at approval: quantities, units, removal — nothing else. */
function reviewItem(v: unknown): TransferItem {
  const i = obj(v, 'item')
  only(i, ['idx', 'productId', 'productName', 'sku', 'unit', 'requestedEntryUnit', 'requestedEntryQty', 'requestedQty', 'dispatchEntryUnit', 'dispatchEntryQty', 'dispatchQty', 'stockAtSubmit', 'removed'], 'item')
  let removed: TransferItem['removed']
  if (i.removed !== undefined) {
    const r = obj(i.removed, 'item.removed')
    only(r, ['by', 'byName', 'at', 'reason'], 'item.removed')
    removed = { by: id(r.by, 'removed.by'), byName: text(r.byName, 'removed.byName', 200), at: num(r.at, 'removed.at'), reason: text(r.reason, 'removed.reason') }
  }
  const requested = i.requestedQty === null ? null : num(i.requestedQty, 'item.requestedQty')
  return {
    idx: num(i.idx, 'item.idx'),
    productId: id(i.productId, 'item.productId'),
    productName: text(i.productName, 'item.productName', 300),
    sku: text(i.sku, 'item.sku', 100),
    unit: text(i.unit, 'item.unit', 40),
    requestedQty: requested,
    dispatchQty: num(i.dispatchQty, 'item.dispatchQty'),
    ...(i.requestedEntryUnit !== undefined ? { requestedEntryUnit: text(i.requestedEntryUnit, 'item.requestedEntryUnit', 20) } : {}),
    ...(i.requestedEntryQty !== undefined ? { requestedEntryQty: num(i.requestedEntryQty, 'item.requestedEntryQty') } : {}),
    ...(i.dispatchEntryUnit !== undefined ? { dispatchEntryUnit: text(i.dispatchEntryUnit, 'item.dispatchEntryUnit', 20) } : {}),
    ...(i.dispatchEntryQty !== undefined ? { dispatchEntryQty: num(i.dispatchEntryQty, 'item.dispatchEntryQty') } : {}),
    ...(i.stockAtSubmit !== undefined ? { stockAtSubmit: num(i.stockAtSubmit, 'item.stockAtSubmit') } : {}),
    ...(removed ? { removed } : {}),
  }
}

export const approveTransferCommand = defineCommand({
  name: 'approveTransfer',
  roles: MANAGERS,
  writes: { ...STOCK, transfers: ['set'] },
  parse(raw): ApproveParams {
    const p = obj(raw)
    only(p, ['transferId', 'expectedRevision', 'note', 'items'])
    return {
      transferId: id(p.transferId, 'transferId'),
      expectedRevision: num(p.expectedRevision, 'expectedRevision'),
      ...(p.note !== undefined ? { note: text(p.note, 'note') } : {}),
      ...(p.items !== undefined ? { items: list(p.items, 'items', reviewItem) } : {}),
    }
  },
  run: (tx, file, p, actor) => approveTransferInTx(tx, file, p, asActor(actor)),
})

const REASONS: readonly DiscrepancyReason[] = ['SHORT', 'OVER', 'WEIGHT_VARIANCE', 'DAMAGED', 'WRONG_ITEM', 'WRONG_BRANCH', 'COUNTING_ERROR', 'OTHER']

function receivedLine(v: unknown): ReceivedLineInput {
  const l = obj(v, 'line')
  only(l, ['idx', 'receivedQty', 'receivedEntryQty', 'receivedEntryUnit', 'discrepancy'], 'line')
  let discrepancy: ReceivedLineInput['discrepancy']
  if (l.discrepancy !== undefined) {
    const d = obj(l.discrepancy, 'discrepancy')
    only(d, ['kind', 'qty', 'reason', 'note', 'photoId'], 'discrepancy')
    if (!REASONS.includes(d.reason as DiscrepancyReason)) throw new BadInput('discrepancy.reason')
    discrepancy = {
      reason: d.reason as DiscrepancyReason,
      ...(d.note !== undefined ? { note: text(d.note, 'discrepancy.note') } : {}),
      ...(d.photoId !== undefined ? { photoId: id(d.photoId, 'discrepancy.photoId') } : {}),
    }
  }
  return {
    idx: num(l.idx, 'line.idx'),
    receivedQty: num(l.receivedQty, 'line.receivedQty'),
    ...(l.receivedEntryQty !== undefined ? { receivedEntryQty: num(l.receivedEntryQty, 'line.receivedEntryQty') } : {}),
    ...(l.receivedEntryUnit !== undefined ? { receivedEntryUnit: text(l.receivedEntryUnit, 'line.receivedEntryUnit', 20) } : {}),
    ...(discrepancy ? { discrepancy } : {}),
  }
}

export const receiveTransferCommand = defineCommand({
  name: 'receiveTransfer',
  roles: ANYONE,
  writes: { ...STOCK, transfers: ['set'] },
  parse(raw): ReceiveTransferParams {
    const p = obj(raw)
    only(p, ['transferId', 'receivedLines', 'note'])
    return {
      transferId: id(p.transferId, 'transferId'),
      receivedLines: list(p.receivedLines, 'receivedLines', receivedLine),
      ...(p.note !== undefined ? { note: text(p.note, 'note') } : {}),
    }
  },
  run: (tx, file, p, actor) => confirmReceiveInTx(tx, file, p, asActor(actor)),
})

export const resolveDiscrepancyCommand = defineCommand({
  name: 'resolveDiscrepancy',
  roles: MANAGERS,
  writes: { ...STOCK, transfers: ['set'] },
  parse(raw): ResolveDiscrepancyParams {
    const p = obj(raw)
    only(p, ['transferId', 'itemIdx', 'resolution', 'custodyLocationId', 'relatedTransferId'])
    const r = obj(p.resolution, 'resolution')
    only(r, ['code', 'qty', 'note'], 'resolution')
    return {
      transferId: id(p.transferId, 'transferId'),
      itemIdx: num(p.itemIdx, 'itemIdx'),
      resolution: {
        code: text(r.code, 'resolution.code', 40) as DiscrepancyResolutionCode,
        ...(r.qty !== undefined ? { qty: optNum(r.qty, 'resolution.qty') } : {}),
        ...(r.note !== undefined ? { note: optText(r.note, 'resolution.note') } : {}),
      },
      ...(p.custodyLocationId !== undefined ? { custodyLocationId: id(p.custodyLocationId, 'custodyLocationId') } : {}),
      ...(p.relatedTransferId !== undefined ? { relatedTransferId: id(p.relatedTransferId, 'relatedTransferId') } : {}),
    }
  },
  run: (tx, file, p, actor) => resolveDiscrepancyInTx(tx, file, p, asActor(actor)),
})

export const resolveMisrouteCommand = defineCommand({
  name: 'resolveMisroute',
  roles: MANAGERS,
  writes: { ...STOCK, transfers: ['set'] },
  parse(raw): ResolveMisrouteParams {
    const p = obj(raw)
    only(p, ['transferId', 'itemIdx', 'misrouteId', 'action', 'note', 'createReplacement'])
    if (p.action !== 'redirect' && p.action !== 'forward' && p.action !== 'return') throw new BadInput('action')
    return {
      transferId: id(p.transferId, 'transferId'),
      itemIdx: num(p.itemIdx, 'itemIdx'),
      misrouteId: id(p.misrouteId, 'misrouteId'),
      action: p.action,
      ...(p.note !== undefined ? { note: text(p.note, 'note') } : {}),
      ...(p.createReplacement !== undefined ? { createReplacement: bool(p.createReplacement, 'createReplacement') } : {}),
    }
  },
  run: (tx, file, p, actor) => resolveMisrouteInTx(tx, file, p, asActor(actor)),
})
