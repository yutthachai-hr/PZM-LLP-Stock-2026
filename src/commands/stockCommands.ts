import type { Role } from '../types'
import { bool, id, list, movementLine, num, obj, only, optNum, optText, photo, text } from './check'
import {
  consumeInTx,
  fileCountInTx,
  planAdjust,
  planIssue,
  planReceive,
  type AdjustLine,
  type ConsumeParams,
  type FileCountParams,
  type PlanAdjustParams,
  type PlanIssueParams,
  type PlanReceiveParams,
} from './ledgerTx'
import { receiptIdFor, receiveOrderInTx, type ReceiptLineInput } from './receivePO'
import { BadInput, defineCommand } from './spec'
import { requireCountQty, roundQty } from '../lib/validate'
import { AppError } from '../i18n/AppError'

/**
 * The stock commands (ADR-001, plan A3): every everyday way stock moves, as one transaction
 * body each. The app runs them through services/commands.ts `execute` — locally, or on the
 * server when VITE_STOCK_COMMANDS names them.
 */

const ANYONE: readonly Role[] = ['staff', 'manager', 'admin']
const isManager = (r: Role) => r === 'manager' || r === 'admin'

export type ReceiveStockParams = Omit<PlanReceiveParams, 'actor'>
export type IssueStockParams = Omit<PlanIssueParams, 'actor' | 'transferId'>
export type ConsumeStockParams = Omit<ConsumeParams, 'actor'>
export type AdjustStockParams = Omit<PlanAdjustParams, 'actor' | 'transferId'>
export type FileCountCommandParams = Omit<FileCountParams, 'actor'> & { targetQty?: number; countedQty?: number; asOfQty?: number }

const LEDGER = { stockMovements: ['set'], stockLevels: ['set'], counters: ['set'] } as const

/** Check a delivery in against its order (plan A1). */
export const receivePOCommand = defineCommand({
  name: 'receivePO',
  roles: ANYONE,
  writes: { ...LEDGER, movementImages: ['set'], purchaseOrders: ['update'] },
  parse(raw) {
    const p = obj(raw)
    only(p, ['orderId', 'invoiceNo', 'lines', 'operationId', 'date', 'docDate', 'note', 'photoDataUrl', 'closeReason'])
    const invoiceNo = text(p.invoiceNo, 'invoiceNo', 100).trim()
    if (!invoiceNo) throw new BadInput('invoiceNo')
    const operationId = text(p.operationId, 'operationId', 64)
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(operationId)) throw new BadInput('operationId')
    const closeReason = optText(p.closeReason, 'closeReason')?.trim()
    if (p.closeReason !== undefined && !closeReason) throw new BadInput('closeReason')
    return {
      orderId: id(p.orderId, 'orderId'),
      invoiceNo,
      operationId,
      lines: list(p.lines, 'lines', (x): ReceiptLineInput => {
        const l = obj(x, 'line')
        only(l, ['productId', 'receivedQty', 'checked', 'note'], 'line')
        const note = optText(l.note, 'line.note')
        return { productId: id(l.productId, 'line.productId'), receivedQty: num(l.receivedQty, 'line.receivedQty'), checked: bool(l.checked, 'line.checked'), ...(note !== undefined ? { note } : {}) }
      }),
      date: num(p.date, 'date'),
      docDate: optNum(p.docDate, 'docDate'),
      note: optText(p.note, 'note')?.trim() || undefined,
      photoDataUrl: photo(p.photoDataUrl),
      closeReason,
    }
  },
  async run(tx, file, p, actor) {
    const out = await receiveOrderInTx(tx, file, {
      orderId: p.orderId,
      invoiceNo: p.invoiceNo,
      lines: p.lines,
      actor,
      receiptId: receiptIdFor(p.orderId, p.operationId),
      date: p.date,
      ...(p.docDate !== undefined ? { docDate: p.docDate } : {}),
      ...(p.note ? { note: p.note } : {}),
      ...(p.photoDataUrl ? { photoDataUrl: p.photoDataUrl } : {}),
      ...(p.closeReason ? { closeReason: p.closeReason } : {}),
    })
    return { ...out.result, seen: out.seen, ...(out.written ? { order: out.written } : {}) }
  },
})

const docOf = (v: unknown) => {
  if (v === undefined) return undefined
  const d = obj(v, 'doc')
  only(d, ['supplierId', 'supplierName', 'invoiceNo', 'docDate', 'poId', 'poDocNo'], 'doc')
  return {
    supplierId: optText(d.supplierId, 'doc.supplierId', 200),
    supplierName: optText(d.supplierName, 'doc.supplierName', 200),
    invoiceNo: optText(d.invoiceNo, 'doc.invoiceNo', 100),
    docDate: optNum(d.docDate, 'doc.docDate'),
    // A manual receipt cannot claim to be against an order: that is receivePO's.
    ...(d.poId !== undefined || d.poDocNo !== undefined ? (() => { throw new BadInput('doc.poId') })() : {}),
  }
}

/** Goods in without an order (Receive page). */
export const receiveStockCommand = defineCommand({
  name: 'receiveStock',
  roles: ANYONE,
  writes: { ...LEDGER, movementImages: ['set'] },
  parse(raw): ReceiveStockParams {
    const p = obj(raw)
    only(p, ['lines', 'toLocationId', 'date', 'note', 'doc', 'photoDataUrl'])
    return {
      lines: list(p.lines, 'lines', movementLine),
      toLocationId: id(p.toLocationId, 'toLocationId'),
      date: num(p.date, 'date'),
      note: optText(p.note, 'note'),
      doc: docOf(p.doc),
      photoDataUrl: photo(p.photoDataUrl),
    }
  },
  async run(tx, file, p, actor) {
    return (await planReceive(tx, { ...p, actor })).commit(file)
  },
})

/**
 * Goods from one site to another in one step. Staff move stock between sites only through a
 * transfer (owner, 24 Sep 2026): a direct issue to another site is a manager's.
 */
export const issueStockCommand = defineCommand({
  name: 'issueStock',
  roles: ANYONE,
  writes: LEDGER,
  parse(raw): IssueStockParams {
    const p = obj(raw)
    only(p, ['lines', 'fromLocationId', 'toLocationId', 'date', 'note'])
    return {
      lines: list(p.lines, 'lines', movementLine),
      fromLocationId: id(p.fromLocationId, 'fromLocationId'),
      toLocationId: id(p.toLocationId, 'toLocationId'),
      date: num(p.date, 'date'),
      note: optText(p.note, 'note'),
    }
  },
  // Staff move goods between sites only through a transfer, whose own commands file it.
  authorize: (_p, role) => isManager(role),
  async run(tx, file, p, actor) {
    return (await planIssue(tx, { ...p, actor }, file)).commit()
  },
})

/** Used up at a site (Issue page, POS import). */
export const consumeStockCommand = defineCommand({
  name: 'consumeStock',
  roles: ANYONE,
  writes: { ...LEDGER, movementImages: ['set'] },
  parse(raw): ConsumeStockParams {
    const p = obj(raw)
    only(p, ['lines', 'fromLocationId', 'date', 'note', 'photoDataUrl'])
    return {
      lines: list(p.lines, 'lines', movementLine),
      fromLocationId: id(p.fromLocationId, 'fromLocationId'),
      date: num(p.date, 'date'),
      note: optText(p.note, 'note'),
      photoDataUrl: photo(p.photoDataUrl),
    }
  },
  async run(tx, file, p, actor) {
    return consumeInTx(tx, file, { ...p, actor })
  },
})

/** One or more adjustments at one site under one number (Adjust page). */
export const adjustStockCommand = defineCommand({
  name: 'adjustStock',
  roles: ANYONE,
  writes: LEDGER,
  parse(raw): AdjustStockParams {
    const p = obj(raw)
    only(p, ['lines', 'locationId', 'date', 'note'])
    return {
      lines: list(p.lines, 'lines', (x): AdjustLine => {
        const l = obj(x, 'line')
        const { direction, reason, ...rest } = l
        if (direction !== 'in' && direction !== 'out') throw new BadInput('line.direction')
        return { ...movementLine(rest), direction, reason: text(reason, 'line.reason', 60) }
      }),
      locationId: id(p.locationId, 'locationId'),
      date: num(p.date, 'date'),
      note: optText(p.note, 'note'),
    }
  },
  async run(tx, file, p, actor) {
    return (await planAdjust(tx, { ...p, actor }, file)).commit()
  },
})

/**
 * A count filed as the difference it found, on the product's own balance: to a target
 * (opening stock, a recount) or against the books as of the day it was taken. Admin tools
 * (product editor, Excel import, unit rebase).
 */
export const fileCountCommand = defineCommand({
  name: 'fileCount',
  roles: ['admin'],
  writes: LEDGER,
  parse(raw): FileCountCommandParams {
    const p = obj(raw)
    only(p, ['productId', 'productName', 'unit', 'locationId', 'note', 'date', 'targetQty', 'countedQty', 'asOfQty'])
    const target = optNum(p.targetQty, 'targetQty')
    const counted = optNum(p.countedQty, 'countedQty')
    const asOf = optNum(p.asOfQty, 'asOfQty')
    if ((target === undefined) === (counted === undefined) || (counted !== undefined) !== (asOf !== undefined)) throw new BadInput('targetQty|countedQty')
    return {
      productId: id(p.productId, 'productId'),
      productName: text(p.productName, 'productName', 300),
      unit: text(p.unit, 'unit', 40),
      locationId: id(p.locationId, 'locationId'),
      note: optText(p.note, 'note'),
      date: optNum(p.date, 'date'),
      targetQty: target,
      countedQty: counted,
      asOfQty: asOf,
    }
  },
  async run(tx, file, p, actor) {
    const { targetQty, countedQty, asOfQty, ...rest } = p
    if (targetQty !== undefined) {
      const target = requireCountQty(targetQty)
      return fileCountInTx(tx, file, { ...rest, actor }, (cur) => roundQty(target - cur))
    }
    const delta = roundQty(requireCountQty(countedQty!) - asOfQty!)
    if (!Number.isFinite(delta)) throw new AppError('ค่าไม่ถูกต้อง: {value}', { value: String(asOfQty) })
    return fileCountInTx(tx, file, { ...rest, actor }, () => delta)
  },
})

/** Every command the server answers, by name. */
export const STOCK_COMMANDS = {
  receivePO: receivePOCommand,
  receiveStock: receiveStockCommand,
  issueStock: issueStockCommand,
  consumeStock: consumeStockCommand,
  adjustStock: adjustStockCommand,
  fileCount: fileCountCommand,
} as const

export type StockCommandName = keyof typeof STOCK_COMMANDS
