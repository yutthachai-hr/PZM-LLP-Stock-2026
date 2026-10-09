import type { TxContext } from '../backend/tx'
import { AppError } from '../i18n/AppError'
import { COL, ADJUST_REASONS, TRANSIT_LOCATION_ID, type MonthlyCount, type StockMovement, type MovementType, type Product, type StockLevel, type StockLocation } from '../types'
import { monthlyCountId, monthOf } from '../lib/monthlyCount'
import { sameUnit } from '../lib/units'
import { filedUnit, levelId, levelRef } from '../lib/levelKey'
import { requireQty, requireEpochMs, requireOneOf, requireId, roundQty } from '../lib/validate'

/**
 * The stock engine's transaction bodies: read master data, counters and balances inside a
 * transaction, check, and return the writes. No database client here — only the
 * `TxContext` handed in — so the same code files stock from the app (services/stock.ts,
 * over the Firestore SDK) and from the trusted command boundary (functions/, over the
 * service account; ADR-001, plan A3). Moved out of services/stock.ts on 6 Oct 2026; that
 * file re-exports everything here, so callers did not change.
 */

/**
 * Writes one movement inside the transaction. `id` is given only when the caller needs a
 * row it can find again — a receipt filed under its operation id, so pressing confirm
 * twice, or retrying after the network dropped, finds the first one instead of filing a
 * second (plan A1, 6 Oct 2026). Otherwise a fresh id.
 */
export type FileMovement = (mv: Omit<StockMovement, 'id'>, id?: string) => void

export interface MovementLine {
  productId: string
  productName: string
  /** The product's own unit. */
  unit: string
  /** What the person picked in the unit box, when it is not the product's own. */
  entryUnit?: string
  /**
   * As keyed, in `entryUnit`. Required whenever `entryUnit` is given: the caller converted
   * with the product's rate (see lib/uom.ts `entryFor`) and `qty` below is already the
   * product's own unit.
   */
  entryQty?: number
  /** In the product's own unit. */
  qty: number
  note?: string
}

export interface Actor {
  id: string
  name: string
}

const PREFIX: Record<MovementType, string> = {
  receive: 'RC',
  issue: 'IS',
  adjust: 'ADJ',
  consume: 'CS',
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

// "Not enough stock" with the base balance, and what was keyed when that differs.
export function shortMessage(l: MovementLine, avail: number): AppError {
  const keyed = keyedUnit(l)
  if (keyed && l.entryQty !== undefined) {
    return new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit}) — {entryQty} {entryUnit} = {need} {unit}', {
      name: l.productName, qty: avail, unit: l.unit, entryQty: l.entryQty, entryUnit: keyed, need: l.qty,
    })
  }
  return new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: filedUnit(l) })
}

/**
 * The cached balance document.
 *
 * `updatedBy` is not decoration: the security rules require it to equal the caller's uid.
 * Balances are the one thing the rules cannot prove correct — that needs a trusted server
 * comparing every write against the ledger, and the free plan has no room for one — so the
 * next best thing is that every balance in the database names whoever last wrote it.
 */
export function levelDoc(
  locationId: string,
  productId: string,
  qty: number,
  actor: Actor,
  now: number,
  unit?: string,
): Record<string, unknown> {
  return {
    productId,
    locationId,
    // Omitted for the product's own unit, so rows written before units were selectable keep
    // exactly the shape they have.
    ...(unit ? { unit } : {}),
    qty: roundQty(qty),
    updatedAt: now,
    updatedBy: actor.id,
  }
}

export function makeDocNo(type: MovementType, seq: number): string {
  return `${PREFIX[type]}-${String(seq).padStart(5, '0')}`
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
    // A line keyed in another unit says how many of that unit: the caller converted it
    // (lib/uom.ts) and `qty` is already the product's own unit. A line without that is
    // not a converted line, and the old per-unit filing is not offered to new rows.
    const keyed = keyedUnit(raw)
    if (keyed && !(raw.entryQty !== undefined && raw.entryQty > 0)) {
      throw new AppError('รายการ "{name}" คีย์เป็น {unit} แต่ไม่ได้ระบุจำนวนที่คีย์', { name: raw.productName, unit: keyed })
    }
    const l: MovementLine = keyed ? { ...raw, qty, entryUnit: keyed } : { ...raw, qty, entryUnit: undefined, entryQty: undefined }
    const existing = byProduct.get(l.productId)
    if (!existing) {
      byProduct.set(l.productId, l)
      continue
    }
    const notes = [existing.note, l.note].filter(Boolean)
    existing.qty = requireQty(existing.qty + qty, l.productName)
    // Two lines in the same keyed unit add up in it; in different units the merged line is
    // simply so many of the product's own unit, which is always true.
    if (existing.entryUnit && l.entryUnit && sameUnit(existing.entryUnit, l.entryUnit)) {
      existing.entryQty = roundQty((existing.entryQty ?? 0) + (l.entryQty ?? 0))
    } else {
      delete existing.entryUnit
      delete existing.entryQty
    }
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
export async function requireMasterData(
  tx: TxContext,
  productIds: string[],
  locationIds: string[],
): Promise<void> {
  const products = await Promise.all(
    productIds.map((id) => tx.get<Product>(COL.products, id).then((p) => [id, p] as const)),
  )
  const locations = await Promise.all(
    locationIds.map((id) => tx.get<StockLocation>(COL.locations, id).then((l) => [id, l] as const)),
  )
  for (const [id, p] of products) {
    if (!p) throw new AppError('ไม่พบสินค้าในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
    if (p.active === false) {
      throw new AppError('สินค้า "{name}" ถูกปิดใช้งานแล้ว', { name: p.name || id })
    }
    // A product with no unit of its own cannot hold stock: every balance, conversion and
    // count would be in "nothing". The R&D catalogue arrived that way (main 476fa35, all
    // 228 rows) — refused here, on every stock path, until an admin sets the unit. The unit
    // is never guessed (release hardening, 8 Oct 2026).
    if (!p.unitType || !String(p.unitType).trim()) {
      throw new AppError('สินค้า "{name}" ยังไม่มีหน่วย — ให้ผู้ดูแลกำหนดหน่วยที่หน้าสินค้าก่อนทำรายการสต๊อก', { name: p.name || id })
    }
  }
  for (const [id, l] of locations) {
    if (!l) throw new AppError('ไม่พบคลังในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
    if (l.active === false) {
      throw new AppError('คลัง "{name}" ถูกปิดใช้งานแล้ว', { name: l.name || id })
    }
  }
}

/** Receive goods into a location (usually the main warehouse). Adds stock. */
/**
 * The period lock (plan B1, 6 Oct 2026): once a location's monthly count for a month is
 * posted, that month is closed there — nothing more is filed into it, so the figures the
 * count settled cannot be changed quietly afterwards. Read inside the transaction, so a
 * count posted a moment ago is seen. The transit location has no counts and no lock.
 *
 * Only an admin correcting a row (editMovement / voidMovement) may reach into a closed
 * month, and only with a reason, which is kept on the row.
 */
export async function requireOpenPeriod(tx: TxContext, locationIds: readonly (string | undefined)[], date: number): Promise<void> {
  const month = monthOf(date)
  const ids = [...new Set(locationIds.filter((x): x is string => !!x && x !== TRANSIT_LOCATION_ID))]
  const sheets = await Promise.all(ids.map((id) => tx.get<MonthlyCount>(COL.monthlyCounts, monthlyCountId(id, month))))
  sheets.forEach((sheet, i) => {
    if (sheet?.status === 'posted') {
      throw new AppError(PERIOD_CLOSED, { month, location: ids[i] })
    }
  })
}

/** The month closed at any of these locations, or null — for an admin's correction, which may pass with a reason. */
export async function closedPeriod(tx: TxContext, locationIds: readonly (string | undefined)[], date: number): Promise<string | null> {
  try {
    await requireOpenPeriod(tx, locationIds, date)
    return null
  } catch (e) {
    if (e instanceof AppError && e.key === PERIOD_CLOSED) return monthOf(date)
    throw e
  }
}

/** The words of the period lock's refusal. */
export const PERIOD_CLOSED = 'เดือน {month} ของคลังนี้ปิดยอดนับแล้ว — บันทึกย้อนหลังเข้าเดือนนี้ไม่ได้' // i18n-key

/**
 * A receipt's paperwork, kept as fields (owner, 24 Sep 2026) instead of one free-text note:
 * who it came from, the number printed on their document and its date, and the order it
 * checks in. Every field is optional so a receipt keyed the old way still files.
 */
export interface ReceiptDoc {
  supplierId?: string
  supplierName?: string
  invoiceNo?: string
  docDate?: number
  poId?: string
  poDocNo?: string
}

/** Only the fields that carry something — Firestore stores no empty strings for us. */
export function docFields(doc: ReceiptDoc | undefined): Partial<StockMovement> {
  if (!doc) return {}
  const out: Partial<StockMovement> = {}
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)
  const supplierId = text(doc.supplierId)
  const supplierName = text(doc.supplierName)
  const invoiceNo = text(doc.invoiceNo)
  const poId = text(doc.poId)
  const poDocNo = text(doc.poDocNo)
  if (supplierId) out.supplierId = supplierId
  if (supplierName) out.supplierName = supplierName
  if (invoiceNo) out.invoiceNo = invoiceNo
  if (doc.docDate !== undefined) {
    requireEpochMs(doc.docDate)
    out.docDate = doc.docDate
  }
  if (poId) out.poId = poId
  if (poDocNo) out.poDocNo = poDocNo
  return out
}

export interface PlanReceiveParams {
  lines: MovementLine[]
  toLocationId: string
  date: number
  actor: Actor
  note?: string
  /** The receipt's paperwork, stamped on every row it files. */
  doc?: ReceiptDoc
  /**
   * A photo of the supplier's document, in the same commit as the stock — the rule
   * `consumeStock` learnt the hard way: a photo written afterwards can fail with the
   * stock already moved, and saving again moves it twice.
   */
  photoDataUrl?: string
}

export interface PlannedReceive {
  docNo: string
  lines: MovementLine[]
  /** The writes. `idFor(i)` names the i-th row when the caller needs to find it again. */
  commit: (file: FileMovement, idFor?: (i: number) => string) => string
}

/**
 * Plan a receipt inside a transaction: read master data, the counter and the balances,
 * and return the writes. Split out so a purchase-order receipt can file the stock and
 * update the order in ONE commit (plan A1) — until 6 Oct 2026 they were two, and a failure
 * or a second device between them left stock in with the order still waiting for it.
 */
export async function planReceive(tx: TxContext, params: PlanReceiveParams): Promise<PlannedReceive> {
  const { toLocationId, date, actor, note, photoDataUrl } = params
  const lines = mergeLines(params.lines)
  requireEpochMs(date)
  requireId(toLocationId, 'toLocationId')
  const paperwork = docFields(params.doc)

  // ---- reads ----
  await requireMasterData(
    tx,
    lines.map((l) => l.productId),
    [toLocationId],
  )
  await requireOpenPeriod(tx, [toLocationId], date)
  const counter = await tx.get<{ value: number }>(COL.counters, 'receive')
  const seq = (counter?.value ?? 0) + 1
  const levels = await Promise.all(
    lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelRef(toLocationId, l).id)),
  )
  const docNo = makeDocNo('receive', seq)

  // ---- writes ----
  return {
    docNo,
    lines,
    commit: (file, idFor) => {
      tx.set(COL.counters, 'receive', { value: seq })
      const now = Date.now()
      if (photoDataUrl) {
        tx.set(COL.movementImages, docNo, { dataUrl: photoDataUrl })
      }
      lines.forEach((l, i) => {
        const cur = levels[i]?.qty ?? 0
        tx.set(
          COL.stockLevels,
          levelRef(toLocationId, l).id,
          levelDoc(toLocationId, l.productId, cur + l.qty, actor, now, levelRef(toLocationId, l).unit),
        )
        const mv: Omit<StockMovement, 'id'> = {
          docNo,
          type: 'receive',
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          ...keyedFields(l),
          qty: l.qty,
          toLocationId,
          ...(l.note ?? note ? { note: l.note ?? note } : {}),
          ...paperwork,
          ...(photoDataUrl ? { hasPhoto: true } : {}),
          date,
          byUserId: actor.id,
          byUserName: actor.name,
          createdAt: now,
        }
        file(mv, idFor?.(i))
      })
      return docNo
    },
  }
}


export interface PlanIssueParams {
  lines: MovementLine[]
  fromLocationId: string
  toLocationId: string
  date: number
  actor: Actor
  note?: string
  transferId?: string
}

export interface PlannedIssue {
  docNo: string
  lines: MovementLine[]
  commit: () => string
}

/**
 * Plan an issue (branch transfer) inside a transaction.
 * Reads master data, counters, and stock levels; validates quantities; returns a commit writer.
 * Used by issueStock and orchestrated transfer approval/receipt.
 */
export async function planIssue(
  tx: TxContext,
  params: PlanIssueParams,
  file: (mv: Omit<StockMovement, 'id'>) => void,
): Promise<PlannedIssue> {
  const { fromLocationId, toLocationId, date, actor, note, transferId } = params
  if (fromLocationId === toLocationId) throw new AppError('ต้นทางและปลายทางต้องต่างกัน')
  const lines = mergeLines(params.lines)
  requireEpochMs(date)
  requireId(fromLocationId, 'fromLocationId')
  requireId(toLocationId, 'toLocationId')

  // ---- reads ----
  await requireMasterData(
    tx,
    lines.map((l) => l.productId),
    [fromLocationId, toLocationId],
  )
  await requireOpenPeriod(tx, [fromLocationId, toLocationId], date)
  const counter = await tx.get<{ value: number }>(COL.counters, 'issue')
  const seq = (counter?.value ?? 0) + 1
  const fromLevels = await Promise.all(
    lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelRef(fromLocationId, l).id)),
  )
  const toLevels = await Promise.all(
    lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelRef(toLocationId, l).id)),
  )
  // validate availability — one line per product, so this is the whole demand for it
  lines.forEach((l, i) => {
    const avail = fromLevels[i]?.qty ?? 0
    if (l.qty > avail) throw shortMessage(l, avail)
  })

  // ---- writes ----
  const docNo = makeDocNo('issue', seq)
  return {
    docNo,
    lines,
    commit: () => {
      tx.set(COL.counters, 'issue', { value: seq })
      const now = Date.now()
      lines.forEach((l, i) => {
        const fromCur = fromLevels[i]?.qty ?? 0
        const toCur = toLevels[i]?.qty ?? 0
        tx.set(
          COL.stockLevels,
          levelRef(fromLocationId, l).id,
          levelDoc(fromLocationId, l.productId, fromCur - l.qty, actor, now, levelRef(fromLocationId, l).unit),
        )
        tx.set(
          COL.stockLevels,
          levelRef(toLocationId, l).id,
          levelDoc(toLocationId, l.productId, toCur + l.qty, actor, now, levelRef(toLocationId, l).unit),
        )
        const mv: Omit<StockMovement, 'id'> = {
          docNo,
          type: 'issue',
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          ...keyedFields(l),
          qty: l.qty,
          fromLocationId,
          toLocationId,
          note: l.note ?? note,
          ...(transferId ? { transferId } : {}),
          date,
          byUserId: actor.id,
          byUserName: actor.name,
          createdAt: now,
        }
        file(mv)
      })
      return docNo
    },
  }
}


/** One line of a multi-line adjustment: which way, how much (product's own unit), and why. */
export interface AdjustLine extends MovementLine {
  direction: 'in' | 'out'
  reason: string
}

/**
 * Adjust several products at one location under ONE document number (spec §2.5).
 *
 * The owner's mock-up counts a shelf and corrects every product on it in one go. Each line
 * is still an ordinary `adjust` movement with its own direction and reason — the rules, the
 * reports and voiding treat it exactly like one filed by `adjustStock` — they simply share a
 * docNo, the way a receipt's lines do.
 *
 * All or nothing: a line that would take a balance below zero refuses the whole document.
 * The same product twice is refused rather than netted, because "2 out for damage, 1 in
 * found" is two statements about the shelf that a single net line would lose.
 */
export interface PlanAdjustParams {
  lines: AdjustLine[]
  locationId: string
  date: number
  actor: Actor
  note?: string
  transferId?: string
}

export interface PlannedAdjust {
  docNo: string
  commit: () => string
}

export async function planAdjust(
  tx: TxContext,
  params: PlanAdjustParams,
  file: (mv: Omit<StockMovement, 'id'>) => void,
): Promise<PlannedAdjust> {
  const { locationId, actor, note, transferId } = params
  if (params.lines.length === 0) throw new AppError('ไม่มีรายการสินค้า')
  const reasons = ADJUST_REASONS.map((r) => r.value) as readonly string[]
  const seen = new Set<string>()
  const lines = params.lines.map((raw) => {
    if (seen.has(raw.productId)) {
      throw new AppError('สินค้า "{name}" อยู่ในใบนี้มากกว่า 1 บรรทัด', { name: raw.productName })
    }
    seen.add(raw.productId)
    const [line] = mergeLines([raw])
    return {
      line,
      direction: requireOneOf(raw.direction, ['in', 'out'] as const),
      reason: requireOneOf(raw.reason, reasons),
    }
  })
  const date = requireEpochMs(params.date)
  requireId(locationId, 'locationId')

  // ---- reads ----
  await requireMasterData(
    tx,
    lines.map((x) => x.line.productId),
    [locationId],
  )
  await requireOpenPeriod(tx, [locationId], date)
  const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
  const seq = (counter?.value ?? 0) + 1
  const levels = await Promise.all(
    lines.map((x) => tx.get<StockLevel>(COL.stockLevels, levelRef(locationId, x.line).id)),
  )
  const next = lines.map((x, i) => {
    const cur = levels[i]?.qty ?? 0
    const value = roundQty(cur + (x.direction === 'in' ? x.line.qty : -x.line.qty))
    if (value < 0) throw shortMessage(x.line, cur)
    return value
  })

  // ---- writes ----
  const docNo = makeDocNo('adjust', seq)
  return {
    docNo,
    commit: () => {
      tx.set(COL.counters, 'adjust', { value: seq })
      const now = Date.now()
      lines.forEach(({ line, direction, reason }, i) => {
        const ref = levelRef(locationId, line)
        tx.set(COL.stockLevels, ref.id, levelDoc(locationId, line.productId, next[i], actor, now, ref.unit))
        const mv: Omit<StockMovement, 'id'> = {
          docNo,
          type: 'adjust',
          productId: line.productId,
          productName: line.productName,
          unit: line.unit,
          ...keyedFields(line),
          qty: line.qty,
          ...(direction === 'in' ? { toLocationId: locationId } : { fromLocationId: locationId }),
          reason,
          note: line.note ?? note,
          ...(transferId ? { transferId } : {}),
          date,
          byUserId: actor.id,
          byUserName: actor.name,
          createdAt: now,
        }
        file(mv)
      })
      return docNo
    },
  }
}

export interface ConsumeParams {
  lines: MovementLine[]
  fromLocationId: string
  date: number
  actor: Actor
  note?: string
  photoDataUrl?: string
}

/** Use up stock at a location (services/stock.ts consumeStock), as a transaction body. */
export async function consumeInTx(tx: TxContext, file: FileMovement, params: ConsumeParams): Promise<string> {
  const { fromLocationId, date, actor, note, photoDataUrl } = params
  const lines = mergeLines(params.lines)
  requireEpochMs(date)
  requireId(fromLocationId, 'fromLocationId')
  {
    // ---- reads ----
    await requireMasterData(
      tx,
      lines.map((l) => l.productId),
      [fromLocationId],
    )
    await requireOpenPeriod(tx, [fromLocationId], date)
    const counter = await tx.get<{ value: number }>(COL.counters, 'consume')
    const seq = (counter?.value ?? 0) + 1
    const levels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelRef(fromLocationId, l).id)),
    )
    lines.forEach((l, i) => {
      const avail = levels[i]?.qty ?? 0
      if (l.qty > avail) throw shortMessage(l, avail)
    })
    // ---- writes ----
    const doc = makeDocNo('consume', seq)
    tx.set(COL.counters, 'consume', { value: seq })
    const now = Date.now()
    if (photoDataUrl) {
      tx.set(COL.movementImages, doc, { dataUrl: photoDataUrl })
    }
    lines.forEach((l, i) => {
      const cur = levels[i]?.qty ?? 0
      tx.set(
        COL.stockLevels,
        levelRef(fromLocationId, l).id,
        levelDoc(fromLocationId, l.productId, cur - l.qty, actor, now, levelRef(fromLocationId, l).unit),
      )
      const mv: Omit<StockMovement, 'id'> = {
        docNo: doc,
        type: 'consume',
        productId: l.productId,
        productName: l.productName,
        unit: l.unit,
        ...keyedFields(l),
        qty: l.qty,
        fromLocationId,
        note: l.note ?? note,
        hasPhoto: !!photoDataUrl,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      file(mv)
    })
    return doc
  }
}

export interface FileCountParams {
  productId: string
  productName: string
  unit: string
  locationId: string
  actor: Actor
  note?: string
  date?: number
}

/** The write both counts share: one `opening` adjustment on the product's own row. */
export async function fileCountInTx(tx: TxContext, file: FileMovement, params: FileCountParams, deltaFrom: (current: number) => number): Promise<boolean> {
  const { productId, productName, unit, locationId, actor, note } = params
  requireId(productId, 'productId')
  requireId(locationId, 'locationId')
  const date = params.date === undefined ? Date.now() : requireEpochMs(params.date)
  {
    await requireMasterData(tx, [productId], [locationId])
    await requireOpenPeriod(tx, [locationId], date)
    // A count is someone standing in front of the shelf reconciling the product's own
    // balance, so it always lands on that row — there is no unit box on that screen.
    const level = await tx.get<StockLevel>(COL.stockLevels, levelId(locationId, productId))
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const cur = level?.qty ?? 0
    const delta = deltaFrom(cur)
    if (delta === 0) return false
    const next = roundQty(cur + delta)
    if (next < 0) throw shortMessage({ productId, productName, unit, qty: Math.abs(delta) }, cur)

    const seq = (counter?.value ?? 0) + 1
    const now = Date.now()
    tx.set(COL.counters, 'adjust', { value: seq })
    tx.set(
      COL.stockLevels,
      levelId(locationId, productId),
      levelDoc(locationId, productId, next, actor, now),
    )
    const mv: Omit<StockMovement, 'id'> = {
      docNo: makeDocNo('adjust', seq),
      type: 'adjust',
      productId,
      productName,
      unit,
      qty: Math.abs(delta),
      ...(delta > 0 ? { toLocationId: locationId } : { fromLocationId: locationId }),
      reason: 'opening',
      note: note ?? 'ตั้งยอดคงเหลือ',
      date,
      byUserId: actor.id,
      byUserName: actor.name,
      createdAt: now,
    }
    file(mv)
    return true
  }
}
