import { backend } from '../backend'
import type { Backend, TxContext } from '../backend/types'
import { AppError } from '../i18n/AppError'
import {
  COL,
  ADJUST_REASONS,
  type StockMovement,
  type MovementType,
  type Product,
  type AppUser,
  type StockLevel,
  type StockLocation,
} from '../types'
import { genId } from '../lib/id'
import { getBrand } from '../brand/brand'
import {
  QTY_STEP,
  requireQty,
  requireCountQty,
  requireEpochMs,
  requireOneOf,
  requireId,
  roundQty,
} from '../lib/validate'

// ============================================================================
// Stock engine — the ONLY place stock balances change.
// Every operation writes an immutable movement to the ledger AND updates the
// cached balance (stockLevels) inside a single atomic transaction.
//
// Two rules the whole file is built around:
//
//  1. The ledger is the truth. stockLevels is a cache of it, and any operation that would
//     leave the two disagreeing is refused rather than fudged.
//  2. Every operation pins the brand it started in (`backend.forBrand`). The user can tap
//     "switch brand" mid-save and a Firestore transaction can be retried after they do;
//     reading the current brand at each step would split one document across two brands.
// ============================================================================

export interface MovementLine {
  productId: string
  productName: string
  /** The product's own unit. */
  unit: string
  /** What the person picked in the unit box, when it is not the product's own. */
  entryUnit?: string
  qty: number
  note?: string
}

interface Actor {
  id: string
  name: string
}

const PREFIX: Record<MovementType, string> = {
  receive: 'RC',
  issue: 'IS',
  adjust: 'ADJ',
  consume: 'CS',
}

/**
 * Which balance a movement belongs to.
 *
 * A product has one balance per unit anyone has keyed it in. The product's own unit keeps
 * the plain `location__product` key that every balance written before units were selectable
 * already uses, so nothing has to be migrated and no existing number moves; any other unit
 * gets its own row behind a `#`.
 *
 * Balances are never added across units. Ten Pack and two KG of the same prawns are two
 * rows shown side by side, and a person decides what to do about it — summing them would
 * mean inventing a pack size nobody wrote down.
 */
function levelId(locationId: string, productId: string, unit?: string, baseUnit?: string): string {
  const base = `${locationId}__${productId}`
  const u = (unit ?? '').trim()
  return !u || u === (baseUnit ?? '').trim() ? base : `${base}${UNIT_SEP}${u}`
}

/**
 * Separator between the product key and the unit.
 *
 * Deliberately not `__`: the existing key is split on that, and a unit name containing one
 * would silently become part of the product id.
 */
const UNIT_SEP = '#'

/** The unit a line is filed under — what was keyed, falling back to the product's own. */
function filedUnit(l: { unit: string; entryUnit?: string }): string {
  return (l.entryUnit ?? '').trim() || l.unit
}

/**
 * The keyed unit, but only when it differs from the product's own.
 *
 * This is what gets written — to the movement and to the balance row — so a document that
 * was keyed in the product's own unit keeps exactly the shape it has always had.
 */
function extraUnit(x: { unit: string; entryUnit?: string }): string | undefined {
  const filed = filedUnit(x)
  return filed === x.unit ? undefined : filed
}

/**
 * The balance row for one line or one movement, and the unit to stamp on it.
 *
 * Both shapes carry the product's own unit and, optionally, the one that was keyed, which is
 * why voiding a movement can find exactly the row it created without reading the product.
 */
function levelRef(
  locationId: string,
  x: { productId: string; unit: string; entryUnit?: string },
): { id: string; unit?: string } {
  return {
    id: levelId(locationId, x.productId, filedUnit(x), x.unit),
    unit: extraUnit(x),
  }
}

/** Split a balance key back into its parts. The unit is absent for the product's own. */
export function parseLevelId(id: string): {
  locationId: string
  productId: string
  unit?: string
} {
  const hash = id.indexOf(UNIT_SEP)
  const head = hash === -1 ? id : id.slice(0, hash)
  const unit = hash === -1 ? undefined : id.slice(hash + 1)
  const cut = head.indexOf('__')
  return {
    locationId: cut === -1 ? head : head.slice(0, cut),
    productId: cut === -1 ? '' : head.slice(cut + 2),
    ...(unit ? { unit } : {}),
  }
}

/**
 * The cached balance document.
 *
 * `updatedBy` is not decoration: the security rules require it to equal the caller's uid.
 * Balances are the one thing the rules cannot prove correct — that needs a trusted server
 * comparing every write against the ledger, and the free plan has no room for one — so the
 * next best thing is that every balance in the database names whoever last wrote it.
 */
function levelDoc(
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

function makeDocNo(type: MovementType, seq: number): string {
  return `${PREFIX[type]}-${String(seq).padStart(5, '0')}`
}

/** The backend for the brand this operation belongs to, fixed for its whole lifetime. */
function scoped(): Backend {
  return backend.forBrand(getBrand())
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
function mergeLines(lines: MovementLine[]): MovementLine[] {
  if (lines.length === 0) throw new AppError('ไม่มีรายการสินค้า')
  const byProduct = new Map<string, MovementLine>()
  for (const l of lines) {
    requireId(l.productId, l.productName || 'productId')
    const qty = requireQty(l.qty, l.productName)
    const existing = byProduct.get(l.productId)
    if (!existing) {
      byProduct.set(l.productId, { ...l, qty })
      continue
    }
    const notes = [existing.note, l.note].filter(Boolean)
    existing.qty = requireQty(existing.qty + qty, l.productName)
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
async function requireMasterData(
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
  }
  for (const [id, l] of locations) {
    if (!l) throw new AppError('ไม่พบคลังในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
    if (l.active === false) {
      throw new AppError('คลัง "{name}" ถูกปิดใช้งานแล้ว', { name: l.name || id })
    }
  }
}

/** Receive goods into a location (usually the main warehouse). Adds stock. */
export async function receiveStock(params: {
  lines: MovementLine[]
  toLocationId: string
  date: number
  actor: Actor
  note?: string
}): Promise<string> {
  const { toLocationId, date, actor, note } = params
  const lines = mergeLines(params.lines)
  requireEpochMs(date)
  requireId(toLocationId, 'toLocationId')
  const db = scoped()

  return db.transaction(async (tx) => {
    // ---- reads ----
    await requireMasterData(
      tx,
      lines.map((l) => l.productId),
      [toLocationId],
    )
    const counter = await tx.get<{ value: number }>(COL.counters, 'receive')
    const seq = (counter?.value ?? 0) + 1
    const levels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelRef(toLocationId, l).id)),
    )
    // ---- writes ----
    const docNo = makeDocNo('receive', seq)
    tx.set(COL.counters, 'receive', { value: seq })
    const now = Date.now()
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
        ...(extraUnit(l) ? { entryUnit: filedUnit(l) } : {}),
        qty: l.qty,
        toLocationId,
        note: l.note ?? note,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      tx.set(COL.movements, genId(), mv as Record<string, unknown>)
    })
    return docNo
  })
}

/** Issue / transfer goods from one location to another (main -> branch). Moves stock. */
export async function issueStock(params: {
  lines: MovementLine[]
  fromLocationId: string
  toLocationId: string
  date: number
  actor: Actor
  note?: string
}): Promise<string> {
  const { fromLocationId, toLocationId, date, actor, note } = params
  if (fromLocationId === toLocationId) throw new AppError('ต้นทางและปลายทางต้องต่างกัน')
  const lines = mergeLines(params.lines)
  requireEpochMs(date)
  requireId(fromLocationId, 'fromLocationId')
  requireId(toLocationId, 'toLocationId')
  const db = scoped()

  return db.transaction(async (tx) => {
    // ---- reads ----
    await requireMasterData(
      tx,
      lines.map((l) => l.productId),
      [fromLocationId, toLocationId],
    )
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
      if (l.qty > avail) {
        throw new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: filedUnit(l) })
      }
    })
    // ---- writes ----
    const docNo = makeDocNo('issue', seq)
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
        ...(extraUnit(l) ? { entryUnit: filedUnit(l) } : {}),
        qty: l.qty,
        fromLocationId,
        toLocationId,
        note: l.note ?? note,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      tx.set(COL.movements, genId(), mv as Record<string, unknown>)
    })
    return docNo
  })
}

/**
 * Consume / issue-out stock from a location for use or front-store sale (e.g. the Sukhumvit
 * store co-located with the main warehouse). Reduces the source balance with NO destination —
 * the goods are used up. Optionally attaches a proof photo (stored in movementImages/{docNo}).
 *
 * The photo is written INSIDE the transaction. It used to be a separate write afterwards, so
 * a failed photo left the stock already deducted while the screen reported an error — and
 * pressing save again deducted it a second time. It is an ordinary Firestore document
 * (base64, since Cloud Storage left the free plan), so it belongs in the same commit.
 */
export async function consumeStock(params: {
  lines: MovementLine[]
  fromLocationId: string
  date: number
  actor: Actor
  note?: string
  photoDataUrl?: string
}): Promise<string> {
  const { fromLocationId, date, actor, note, photoDataUrl } = params
  const lines = mergeLines(params.lines)
  requireEpochMs(date)
  requireId(fromLocationId, 'fromLocationId')
  const db = scoped()

  return db.transaction(async (tx) => {
    // ---- reads ----
    await requireMasterData(
      tx,
      lines.map((l) => l.productId),
      [fromLocationId],
    )
    const counter = await tx.get<{ value: number }>(COL.counters, 'consume')
    const seq = (counter?.value ?? 0) + 1
    const levels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelRef(fromLocationId, l).id)),
    )
    lines.forEach((l, i) => {
      const avail = levels[i]?.qty ?? 0
      if (l.qty > avail) {
        throw new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: filedUnit(l) })
      }
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
        ...(extraUnit(l) ? { entryUnit: filedUnit(l) } : {}),
        qty: l.qty,
        fromLocationId,
        note: l.note ?? note,
        hasPhoto: !!photoDataUrl,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      tx.set(COL.movements, genId(), mv as Record<string, unknown>)
    })
    return doc
  })
}

/** Fetch the proof photo attached to a movement document (by docNo). */
export async function getMovementImage(docNo: string): Promise<string | null> {
  const img = await scoped().getOne<{ dataUrl: string }>(COL.movementImages, docNo)
  return img?.dataUrl ?? null
}

/** Adjust stock at a location (loss, breakage, count correction, found). */
export async function adjustStock(params: {
  productId: string
  productName: string
  unit: string
  /** What the person picked in the unit box, when it is not the product's own. */
  entryUnit?: string
  locationId: string
  direction: 'in' | 'out'
  qty: number
  reason: string
  date: number
  actor: Actor
  note?: string
}): Promise<string> {
  const { productId, productName, unit, entryUnit, locationId, actor, note } = params
  const ref = levelRef(locationId, { productId, unit, entryUnit })
  const qty = requireQty(params.qty, productName)
  const direction = requireOneOf(params.direction, ['in', 'out'] as const)
  const reason = requireOneOf(
    params.reason,
    ADJUST_REASONS.map((r) => r.value) as readonly string[],
  )
  const date = requireEpochMs(params.date)
  requireId(productId, 'productId')
  requireId(locationId, 'locationId')
  const db = scoped()

  return db.transaction(async (tx) => {
    await requireMasterData(tx, [productId], [locationId])
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const seq = (counter?.value ?? 0) + 1
    const level = await tx.get<StockLevel>(COL.stockLevels, ref.id)
    const cur = level?.qty ?? 0
    const delta = direction === 'in' ? qty : -qty
    const next = roundQty(cur + delta)
    if (next < 0)
      throw new AppError('สต๊อกไม่พอ (คงเหลือ {qty} {unit})', { qty: cur, unit: ref.unit ?? unit })

    const docNo = makeDocNo('adjust', seq)
    tx.set(COL.counters, 'adjust', { value: seq })
    const now = Date.now()
    tx.set(
      COL.stockLevels,
      ref.id,
      levelDoc(locationId, productId, next, actor, now, ref.unit),
    )
    const mv: Omit<StockMovement, 'id'> = {
      docNo,
      type: 'adjust',
      productId,
      productName,
      unit,
      ...(ref.unit ? { entryUnit: ref.unit } : {}),
      qty,
      ...(direction === 'in' ? { toLocationId: locationId } : { fromLocationId: locationId }),
      reason,
      note,
      date,
      byUserId: actor.id,
      byUserName: actor.name,
      createdAt: now,
    }
    tx.set(COL.movements, genId(), mv as Record<string, unknown>)
    return docNo
  })
}

/**
 * Set a location's on-hand balance to an exact target value (e.g. entering opening stock or a
 * physical count). Records the difference as an audited adjustment movement so the ledger stays
 * the single source of truth. No-op if the balance already matches.
 *
 * `date` is the business date of the count — when the shelf was actually walked. It defaults
 * to now, which is right for someone counting at the screen, but a closing-stock sheet being
 * loaded records counts that happened weeks ago, and filing those under today would put every
 * month's count on one day in the stock card.
 */
export async function setStockCount(params: {
  productId: string
  productName: string
  unit: string
  locationId: string
  targetQty: number
  actor: Actor
  note?: string
  date?: number
}): Promise<boolean> {
  const { productId, productName, unit, locationId, actor, note } = params
  const targetQty = requireCountQty(params.targetQty)
  requireId(productId, 'productId')
  requireId(locationId, 'locationId')
  const date = params.date === undefined ? Date.now() : requireEpochMs(params.date)
  const db = scoped()

  return db.transaction(async (tx) => {
    await requireMasterData(tx, [productId], [locationId])
    // A count is someone standing in front of the shelf reconciling the product's own
    // balance, so it always lands on that row — there is no unit box on that screen.
    const level = await tx.get<StockLevel>(COL.stockLevels, levelId(locationId, productId))
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const cur = level?.qty ?? 0
    const delta = roundQty(targetQty - cur)
    if (delta === 0) return false

    const seq = (counter?.value ?? 0) + 1
    const now = Date.now()
    tx.set(COL.counters, 'adjust', { value: seq })
    tx.set(
      COL.stockLevels,
      levelId(locationId, productId),
      levelDoc(locationId, productId, targetQty, actor, now),
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
    tx.set(COL.movements, genId(), mv as Record<string, unknown>)
    return true
  })
}

/** Edit the quantity/date/note of an existing movement, re-applying the balance delta atomically. */
export async function editMovementQty(params: {
  movementId: string
  newQty: number
  newDate?: number
  newNote?: string
  actor: Actor
}): Promise<void> {
  const { movementId, newDate, newNote, actor } = params
  const newQty = requireQty(params.newQty)
  if (newDate !== undefined) requireEpochMs(newDate)
  const db = scoped()

  return db.transaction(async (tx) => {
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new AppError('ไม่พบรายการ')
    if (mv.voided) throw new AppError('รายการนี้ถูกยกเลิกแล้ว')
    const delta = roundQty(newQty - mv.qty)

    const fromLevel = mv.fromLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelRef(mv.fromLocationId, mv).id)
      : null
    const toLevel = mv.toLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelRef(mv.toLocationId, mv).id)
      : null

    const now = Date.now()
    if (mv.fromLocationId) {
      const cur = fromLevel?.qty ?? 0
      const next = roundQty(cur - delta) // more qty out => lower balance
      if (next < 0) throw new AppError('แก้ไขไม่ได้: สต๊อกต้นทางจะติดลบ')
      tx.set(
        COL.stockLevels,
        levelRef(mv.fromLocationId, mv).id,
        levelDoc(mv.fromLocationId, mv.productId, next, actor, now, levelRef(mv.fromLocationId, mv).unit),
      )
    }
    if (mv.toLocationId) {
      const cur = toLevel?.qty ?? 0
      const next = roundQty(cur + delta)
      if (next < 0) throw new AppError('แก้ไขไม่ได้: สต๊อกปลายทางจะติดลบ')
      tx.set(
        COL.stockLevels,
        levelRef(mv.toLocationId, mv).id,
        levelDoc(mv.toLocationId, mv.productId, next, actor, now, levelRef(mv.toLocationId, mv).unit),
      )
    }
    tx.update(COL.movements, movementId, {
      qty: newQty,
      ...(newDate ? { date: newDate } : {}),
      ...(newNote !== undefined ? { note: newNote } : {}),
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    })
  })
}

/**
 * Void a movement: reverse its balance effect and mark it voided (keeps the audit trail).
 *
 * Refused if the reversal would drive a balance below zero, which is what happens when the
 * goods have already been passed on: receive 10, consume 8, then void the receipt. That used
 * to clamp the balance to 0 while the ledger went on totalling -8, so the two disagreed
 * permanently and "recalculate balances" could not fix it either. A movement whose effect has
 * already been consumed downstream needs a correcting adjustment, not a quiet deletion of the
 * history that explains the stock.
 */
export async function voidMovement(movementId: string, actor: Actor): Promise<void> {
  const db = scoped()
  return db.transaction(async (tx) => {
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new AppError('ไม่พบรายการ')
    if (mv.voided) return

    const fromLevel = mv.fromLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelRef(mv.fromLocationId, mv).id)
      : null
    const toLevel = mv.toLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelRef(mv.toLocationId, mv).id)
      : null

    const now = Date.now()
    // reverse: add back to 'from', remove from 'to'
    if (mv.fromLocationId) {
      const cur = fromLevel?.qty ?? 0
      tx.set(
        COL.stockLevels,
        levelRef(mv.fromLocationId, mv).id,
        levelDoc(mv.fromLocationId, mv.productId, cur + mv.qty, actor, now, levelRef(mv.fromLocationId, mv).unit),
      )
    }
    if (mv.toLocationId) {
      const cur = toLevel?.qty ?? 0
      const next = roundQty(cur - mv.qty)
      if (next < 0) {
        throw new AppError(
          'ยกเลิกไม่ได้: ของจากรายการนี้ถูกใช้ต่อไปแล้ว (คงเหลือ {qty} จาก {need}) — ให้บันทึกรายการปรับสต๊อกแทน',
          { qty: cur, need: mv.qty },
        )
      }
      tx.set(
        COL.stockLevels,
        levelRef(mv.toLocationId, mv).id,
        levelDoc(mv.toLocationId, mv.productId, next, actor, now, levelRef(mv.toLocationId, mv).unit),
      )
    }
    tx.update(COL.movements, movementId, {
      voided: true,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    })
  })
}

/** Balances rebuilt from the ledger, keyed `${locationId}__${productId}`. */
function balancesFromLedger(movements: StockMovement[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of movements) {
    if (m.voided) continue
    if (m.fromLocationId) {
      const k = levelRef(m.fromLocationId, m).id
      map.set(k, roundQty((map.get(k) ?? 0) - m.qty))
    }
    if (m.toLocationId) {
      const k = levelRef(m.toLocationId, m).id
      map.set(k, roundQty((map.get(k) ?? 0) + m.qty))
    }
  }
  return map
}

export interface LevelDrift {
  id: string
  locationId: string
  productId: string
  /** Which unit's balance drifted, when it is not the product's own. */
  unit?: string
  /** what stockLevels currently says */
  cached: number
  /** what the ledger adds up to */
  fromLedger: number
  /** who last wrote the cached balance, when the document records it */
  updatedBy?: string
  updatedAt?: number
}

/**
 * Every place the cached balance disagrees with the ledger.
 *
 * This is the honest answer to "can a staff member just write themselves a balance". On the
 * free plan, yes — stopping that needs a trusted server checking each write against the
 * ledger, and Cloud Functions are not on the Spark plan. So the design is: the ledger is
 * the source of truth, every balance write is signed (the rules require `updatedBy`), and
 * this finds the disagreements and names who made them. Detection and repair, not
 * prevention — worth saying plainly rather than implying the hole is closed.
 */
export async function findLevelDrift(): Promise<LevelDrift[]> {
  const db = scoped()
  const [movements, levels] = await Promise.all([
    db.getAll<StockMovement>(COL.movements),
    db.getAll<StockLevel>(COL.stockLevels),
  ])
  const ledger = balancesFromLedger(movements)
  const cached = new Map(levels.map((l) => [l.id, l]))
  const out: LevelDrift[] = []

  for (const id of new Set([...ledger.keys(), ...cached.keys()])) {
    const expected = ledger.get(id) ?? 0
    const actual = cached.get(id)?.qty ?? 0
    // Both sides are rounded to the same precision; anything smaller is float noise.
    if (Math.abs(expected - actual) < QTY_STEP / 2) continue
    const parsed = parseLevelId(id)
    const lv = cached.get(id) as (StockLevel & { updatedBy?: string }) | undefined
    out.push({
      id,
      locationId: lv?.locationId ?? parsed.locationId,
      productId: lv?.productId ?? parsed.productId,
      unit: lv?.unit ?? parsed.unit,
      cached: actual,
      fromLedger: expected,
      updatedBy: lv?.updatedBy,
      updatedAt: lv?.updatedAt,
    })
  }
  return out.sort((a, b) => Math.abs(b.fromLedger - b.cached) - Math.abs(a.fromLedger - a.cached))
}

/** A cheap fingerprint of the ledger, for noticing that it moved under us. */
function ledgerStamp(movements: StockMovement[]): string {
  let latest = 0
  for (const m of movements) {
    const t = Math.max(m.createdAt ?? 0, m.updatedAt ?? 0)
    if (t > latest) latest = t
  }
  return `${movements.length}:${latest}`
}

/**
 * Rebuild ALL stockLevels from the movement ledger. The ledger is the source of truth;
 * this repairs the cached balances if they ever drift (admin maintenance tool).
 *
 * The ledger is read outside a transaction — it is the whole collection, far past what one
 * transaction can hold — so someone recording stock on another device while this runs would
 * have their receipt overwritten by a total computed before it existed. That cannot be made
 * impossible from a client on the free plan; what it can do is notice. The ledger is
 * fingerprinted before and after, and the rebuild is abandoned rather than applied if it
 * moved. Run it when nobody else is recording.
 */
export async function recomputeLevels(actor: Actor): Promise<void> {
  const db = scoped()
  const movements = await db.getAll<StockMovement>(COL.movements)
  const levels = await db.getAll<StockLevel>(COL.stockLevels)
  const before = ledgerStamp(movements)
  const map = balancesFromLedger(movements)

  // A ledger that adds up to less than nothing means the history itself is wrong, not the
  // cache. Say so instead of writing a negative balance the rules would refuse anyway, one
  // document in, leaving half the warehouse rebuilt.
  const negative = [...map].filter(([, qty]) => qty < 0)
  if (negative.length > 0) {
    throw new AppError(
      'คำนวณใหม่ไม่ได้: ประวัติทำให้ยอดติดลบ {count} รายการ (เช่น {example}) — ตรวจรายการที่ถูกยกเลิกก่อน',
      { count: negative.length, example: negative[0][0] },
    )
  }

  // Last look before touching anything. If a movement was recorded while the totals were
  // being worked out, those totals are already stale and writing them would erase it.
  if (ledgerStamp(await db.getAll<StockMovement>(COL.movements)) !== before) {
    throw new AppError('มีการบันทึกรายการใหม่ระหว่างคำนวณ — ยังไม่ได้แก้ไขข้อมูลใด ๆ กรุณาลองใหม่')
  }

  const now = Date.now()
  // write recomputed
  for (const [id, qty] of map) {
    const { locationId, productId, unit } = parseLevelId(id)
    await db.set(COL.stockLevels, id, levelDoc(locationId, productId, qty, actor, now, unit))
  }
  // zero-out any existing level not present in the ledger
  for (const lv of levels) {
    if (!map.has(lv.id)) {
      await db.set(
        COL.stockLevels,
        lv.id,
        levelDoc(lv.locationId, lv.productId, 0, actor, now, lv.unit ?? parseLevelId(lv.id).unit),
      )
    }
  }
}

// re-export for convenience
export type { Product, AppUser }
