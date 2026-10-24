// Browser-free receipt engine. Both normal receiveStock and the trusted R&D command
// use this planner; planning performs reads only, commit performs writes only.
import type { TxContext } from '../backend/tx'
import { AppError } from '../i18n/AppError'
import { COL, type Product, type StockLocation, type StockLevel, type StockMovement } from '../types'
import { sameUnit } from '../lib/units'
import { levelRef } from '../lib/levelKey'
import { requireEpochMs, requireId, requireQty, roundQty } from '../lib/validate'

export interface MovementLine {
  productId: string
  productName: string
  unit: string
  entryUnit?: string
  entryQty?: number
  qty: number
  note?: string
}
export interface ReceiptDoc { supplierId?: string; supplierName?: string; invoiceNo?: string; docDate?: number; poId?: string; poDocNo?: string }
export interface ReceiveParams {
  lines: MovementLine[]; toLocationId: string; date: number; actor: { id: string; name: string }; note?: string; doc?: ReceiptDoc; photoDataUrl?: string
  alongside?: { read: (tx: TxContext) => Promise<void>; write: (tx: TxContext, docNo: string) => void }
}

/** The unit keyed, when it differs from the product's own — what the movement records. */
export function keyedUnit(x: { unit: string; entryUnit?: string }): string | undefined {
  const u = (x.entryUnit ?? '').trim()
  return u && !sameUnit(u, x.unit) ? u : undefined
}
/** The entryUnit/entryQty pair to write on a movement, or nothing for a base-unit row. */
export function keyedFields(x: { unit: string; entryUnit?: string; entryQty?: number }): { entryUnit: string; entryQty: number } | Record<string, never> {
  const u = keyedUnit(x)
  return u && x.entryQty !== undefined ? { entryUnit: u, entryQty: x.entryQty } : {}
}
/**
 * Collapse a document's lines to one entry per product, validating as it goes.
 *
 * Two lines for the same product used to be two independent reads of the same balance and
 * two writes of it, so the second overwrote the first: receiving 2 and 3 of one product
 * left a balance of 3, and issuing 7 and 7 against a balance of 10 passed the availability
 * check twice. The UI's line builder happens to prevent duplicates; that is not where this
 * belongs.
 */
export function mergeLines(lines: MovementLine[]): MovementLine[] {
  if (lines.length === 0) throw new AppError('ไม่มีรายการสินค้า')
  const byProduct = new Map<string, MovementLine>()
  for (const raw of lines) {
    requireId(raw.productId, raw.productName || 'productId')
    const qty = requireQty(raw.qty, raw.productName)
    const keyed = keyedUnit(raw)
    if (keyed && !(raw.entryQty !== undefined && raw.entryQty > 0)) throw new AppError('รายการ "{name}" คีย์เป็น {unit} แต่ไม่ได้ระบุจำนวนที่คีย์', { name: raw.productName, unit: keyed })
    const l: MovementLine = keyed ? { ...raw, qty, entryUnit: keyed } : { ...raw, qty, entryUnit: undefined, entryQty: undefined }
    const existing = byProduct.get(l.productId)
    if (!existing) { byProduct.set(l.productId, l); continue }
    const notes = [existing.note, l.note].filter(Boolean)
    existing.qty = requireQty(existing.qty + qty, l.productName)
    if (existing.entryUnit && l.entryUnit && sameUnit(existing.entryUnit, l.entryUnit)) existing.entryQty = roundQty((existing.entryQty ?? 0) + (l.entryQty ?? 0))
    else { delete existing.entryUnit; delete existing.entryQty }
    existing.note = notes.length > 0 ? [...new Set(notes)].join('; ') : undefined
  }
  return [...byProduct.values()]
}
/**
 * Read the master data a document refers to, inside the transaction, and refuse anything
 * pointing at a product or location that is gone or retired.
 *
 * A form held open while someone else deletes a location keeps the old id in its state, so
 * without this the movement and the balance are written against master data that no longer
 * exists — they show up in reports with a blank name and cannot be corrected from the UI.
 *
 * It costs one read per product plus one per location. That is the price of the movement
 * being about something real.
 */
export async function requireMasterData(tx: TxContext, productIds: string[], locationIds: string[], planned?: ReadonlyMap<string, Product>): Promise<void> {
  const products = await Promise.all(productIds.map(async id => [id, planned?.get(id) ?? await tx.get<Product>(COL.products, id)] as const))
  const locations = await Promise.all(locationIds.map(async id => [id, await tx.get<StockLocation>(COL.locations, id)] as const))
  for (const [id, p] of products) {
    if (!p) throw new AppError('ไม่พบสินค้าในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
    if (p.active === false) throw new AppError('สินค้า "{name}" ถูกปิดใช้งานแล้ว', { name: p.name || id })
  }
  for (const [id, l] of locations) {
    if (!l) throw new AppError('ไม่พบคลังในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
    if (l.active === false) throw new AppError('คลัง "{name}" ถูกปิดใช้งานแล้ว', { name: l.name || id })
  }
}
function paperwork(doc?: ReceiptDoc): Partial<StockMovement> {
  if (!doc) return {}
  const out: Partial<StockMovement> = {}
  for (const k of ['supplierId', 'supplierName', 'invoiceNo', 'poId', 'poDocNo'] as const) if (doc[k]?.trim()) out[k] = doc[k]!.trim()
  if (doc.docDate !== undefined) { requireEpochMs(doc.docDate); out.docDate = doc.docDate }
  return out
}
export async function planReceive(tx: TxContext, params: ReceiveParams, file: (mv: Omit<StockMovement, 'id'>) => void, planned?: ReadonlyMap<string, Product>) {
  const { toLocationId, date, actor, note, photoDataUrl, alongside } = params
  const lines = mergeLines(params.lines)
  requireEpochMs(date); requireId(toLocationId, 'toLocationId')
  const doc = paperwork(params.doc)
  await requireMasterData(tx, lines.map(l => l.productId), [toLocationId], planned)
  const counter = await tx.get<{ value: number }>(COL.counters, 'receive')
  const seq = (counter?.value ?? 0) + 1
  const levels = await Promise.all(lines.map(l => tx.get<StockLevel>(COL.stockLevels, levelRef(toLocationId, l).id)))
  await alongside?.read(tx)
  const docNo = `RC-${String(seq).padStart(5, '0')}`
  return { docNo, lines, commit: () => {
    tx.set(COL.counters, 'receive', { value: seq })
    alongside?.write(tx, docNo)
    const now = Date.now()
    if (photoDataUrl) tx.set(COL.movementImages, docNo, { dataUrl: photoDataUrl })
    lines.forEach((l, i) => {
      const ref = levelRef(toLocationId, l)
      tx.set(COL.stockLevels, ref.id, { productId: l.productId, locationId: toLocationId, ...(ref.unit ? { unit: ref.unit } : {}), qty: roundQty((levels[i]?.qty ?? 0) + l.qty), updatedAt: now, updatedBy: actor.id })
      file({ docNo, type: 'receive', productId: l.productId, productName: l.productName, unit: l.unit, ...keyedFields(l), qty: l.qty, toLocationId, ...(l.note ?? note ? { note: l.note ?? note } : {}), ...doc, ...(photoDataUrl ? { hasPhoto: true } : {}), date, byUserId: actor.id, byUserName: actor.name, createdAt: now })
    })
    return docNo
  } }
}
