import { backend } from '../backend'
import { noteWritten } from '../data/recentWrites'
import { DELETE_FIELD, type Backend, type TxContext } from '../backend/types'
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
  type MovementEdit,
  type MovementEditField,
} from '../types'
import { genId } from '../lib/id'
import { getBrand } from '../brand/brand'
import { sameUnit } from '../lib/units'
import { describeQty, factorOf, isLegacyUnitRow, resolveFactor, toBase } from '../lib/uom'
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
 * One balance per product per location, in the product's own unit, under the plain
 * `location__product` key (owner's rule of 20 Sep 2026 — see lib/uom.ts). A row keyed in
 * another unit is converted before it gets here, so it lands on that same balance.
 *
 * The `#Unit` rows are the legacy of the earlier rule (13–20 Sep 2026), under which a row
 * keyed as "10 Pack" was filed on its own Pack balance. A movement from that time carries
 * `entryUnit` and no `entryQty`; it keeps filing to its `#Unit` row until the migration
 * tool converts it, so voiding or editing an old row still finds the balance it moved.
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

/**
 * The unit a row's balance is counted in: the product's own, except for a legacy row that
 * was never converted, which stays on the balance of the unit it was keyed in.
 */
function filedUnit(l: { unit: string; entryUnit?: string; entryQty?: number }): string {
  return isLegacyUnitRow(l) ? l.entryUnit!.trim() : l.unit
}

/** The balance unit, but only when it is not the product's own — what a legacy `#Unit` row is stamped with. */
function extraUnit(x: { unit: string; entryUnit?: string; entryQty?: number }): string | undefined {
  const filed = filedUnit(x)
  return filed === x.unit ? undefined : filed
}

/** The unit keyed, when it differs from the product's own — what the movement records. */
function keyedUnit(x: { unit: string; entryUnit?: string }): string | undefined {
  const u = (x.entryUnit ?? '').trim()
  return u && !sameUnit(u, x.unit) ? u : undefined
}

/** The entryUnit/entryQty pair to write on a movement, or nothing for a base-unit row. */
function keyedFields(x: { unit: string; entryUnit?: string; entryQty?: number }): { entryUnit: string; entryQty: number } | Record<string, never> {
  const u = keyedUnit(x)
  return u && x.entryQty !== undefined ? { entryUnit: u, entryQty: x.entryQty } : {}
}

/**
 * The balance row for one line or one movement, and the unit to stamp on it.
 *
 * Both shapes carry the product's own unit and, optionally, the one that was keyed, which is
 * why voiding a movement can find exactly the row it created without reading the product.
 */
function levelRef(
  locationId: string,
  x: { productId: string; unit: string; entryUnit?: string; entryQty?: number },
): { id: string; unit?: string } {
  return {
    id: levelId(locationId, x.productId, filedUnit(x), x.unit),
    unit: extraUnit(x),
  }
}

/** "สต๊อกไม่พอ" with the base balance, and what was keyed when that differs. */
function shortMessage(l: MovementLine, avail: number): AppError {
  const keyed = keyedUnit(l)
  if (keyed && l.entryQty !== undefined) {
    return new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit}) — {entryQty} {entryUnit} = {need} {unit}', {
      name: l.productName, qty: avail, unit: l.unit, entryQty: l.entryQty, entryUnit: keyed, need: l.qty,
    })
  }
  return new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: filedUnit(l) })
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

/** The backend for the brand this operation belongs to, fixed for its whole lifetime. */
function scoped(): Backend {
  return backend.forBrand(getBrand())
}

/**
 * A transaction that files movement rows, and tells the screen about them the moment it
 * commits (data/recentWrites.ts). `file` is the only way rows are written here, so nothing
 * reaches the ledger unnoted. The sink is reset on every attempt: Firestore re-runs the
 * callback on contention, and rows from an attempt that never committed must not show.
 */
export async function filing<R>(
  db: Backend | undefined,
  run: (tx: TxContext, file: (mv: Omit<StockMovement, 'id'>) => void) => Promise<R>,
): Promise<R> {
  const targetDb = db ?? scoped()
  let sink: StockMovement[] = []
  const result = await targetDb.transaction(async (tx) => {
    sink = []
    return run(tx, (mv) => {
      const id = genId()
      tx.set(COL.movements, id, mv as Record<string, unknown>)
      sink.push({ ...mv, id } as StockMovement)
    })
  })
  noteWritten(sink)
  return result
}

/** A changed row, as the screen should show it until the listener confirms it. */
function noteChanged(mv: StockMovement, patch: Record<string, unknown>): void {
  const next: Record<string, unknown> = { ...mv }
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE_FIELD) delete next[k]
    else next[k] = v
  }
  noteWritten([next as unknown as StockMovement])
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

  return filing(db, async (tx, file) => {
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
        ...keyedFields(l),
        qty: l.qty,
        toLocationId,
        note: l.note ?? note,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      file(mv)
    })
    return docNo
  })
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

/** Issue / transfer goods from one location to another (main -> branch). Moves stock. */
export async function issueStock(params: PlanIssueParams): Promise<string> {
  const db = scoped()
  return filing(db, async (tx, file) => {
    const planned = await planIssue(tx, params, file)
    return planned.commit()
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

  return filing(db, async (tx, file) => {
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
  })
}

/**
 * Every movement of one product — the Stock Card page's ledger (spec §2.7).
 *
 * One equality query on `productId`, the same read `rebuildProductLevels` makes: it costs
 * that product's rows, never the whole collection. Kept for the session per brand, so
 * going back and forth between products does not read the same rows twice; the screen
 * lays the live listener's rows over it, so anything filed or edited since is current.
 */
const ledgerCache = new Map<string, StockMovement[]>()

export async function readProductLedger(productId: string, opts: { force?: boolean } = {}): Promise<StockMovement[]> {
  requireId(productId, 'productId')
  const key = `${getBrand()}::${productId}`
  const hit = ledgerCache.get(key)
  if (hit && !opts.force) return hit
  const rows = (await scoped().getBy<StockMovement>(COL.movements, 'productId', productId)) ?? []
  ledgerCache.set(key, rows)
  return rows
}

/** Fetch movements in a date range on demand; nothing is subscribed. */
export async function listMovementsInRange(from: number, to: number): Promise<StockMovement[]> {
  return (await scoped().getRange<StockMovement>(COL.movements, 'date', from, to)) ?? []
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
  /** As keyed in `entryUnit`; `qty` is already the product's own unit. */
  entryQty?: number
  locationId: string
  direction: 'in' | 'out'
  /** In the product's own unit. */
  qty: number
  reason: string
  date: number
  actor: Actor
  note?: string
}): Promise<string> {
  const { productId, productName, unit, locationId, actor, note } = params
  const [line] = mergeLines([{ productId, productName, unit, entryUnit: params.entryUnit, entryQty: params.entryQty, qty: params.qty }])
  const ref = levelRef(locationId, line)
  const qty = line.qty
  const direction = requireOneOf(params.direction, ['in', 'out'] as const)
  const reason = requireOneOf(
    params.reason,
    ADJUST_REASONS.map((r) => r.value) as readonly string[],
  )
  const date = requireEpochMs(params.date)
  requireId(productId, 'productId')
  requireId(locationId, 'locationId')
  const db = scoped()

  return filing(db, async (tx, file) => {
    await requireMasterData(tx, [productId], [locationId])
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const seq = (counter?.value ?? 0) + 1
    const level = await tx.get<StockLevel>(COL.stockLevels, ref.id)
    const cur = level?.qty ?? 0
    const delta = direction === 'in' ? qty : -qty
    const next = roundQty(cur + delta)
    if (next < 0) throw shortMessage(line, cur)

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
      ...keyedFields(line),
      qty,
      ...(direction === 'in' ? { toLocationId: locationId } : { fromLocationId: locationId }),
      reason,
      note,
      date,
      byUserId: actor.id,
      byUserName: actor.name,
      createdAt: now,
    }
    file(mv)
    return docNo
  })
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

export async function adjustStockLines(params: PlanAdjustParams): Promise<string> {
  const db = scoped()
  return filing(db, async (tx, file) => {
    const planned = await planAdjust(tx, params, file)
    return planned.commit()
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

  return filing(db, async (tx, file) => {
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
    file(mv)
    return true
  })
}

/** Edit the quantity/date/note of an existing movement, re-applying the balance delta atomically. */
/** How many edits one row will carry before the history itself becomes the problem. */
const MAX_EDITS = 200

export interface MovementPatch {
  /** In the product's own unit. Only for a row keyed in that unit — otherwise give `entryQty`. */
  qty?: number
  /** As keyed, for a row keyed in another unit; `qty` follows at the row's own rate. */
  entryQty?: number
  date?: number
  note?: string
  /** The unit this row is keyed in. Empty string puts it back on the product's own. */
  entryUnit?: string
  fromLocationId?: string
  toLocationId?: string
}

/**
 * Correct a movement in place — quantity, date, note, unit, or which location it belongs to.
 *
 * The alternative was voiding the row and keying it again, which is what people were doing
 * to fix a unit. That leaves a cancelled row and a new one for what was always a single
 * delivery, and it means the correction is only findable by reading both.
 *
 * The balance work is "take the old effect back off the books, then put the new one on".
 * That is the only way a change of unit or of location can be right: those do not adjust a
 * number, they move it to a different row entirely. Both sides are checked for going
 * negative before anything is written.
 *
 * Every edit appends to `edits` — never replaces it. `updatedBy` names only the last person,
 * which is precisely what a second edit would hide.
 */
export async function editMovement(params: {
  movementId: string
  patch: MovementPatch
  actor: Actor
}): Promise<void> {
  const { movementId, patch, actor } = params
  if (patch.qty !== undefined) requireQty(patch.qty)
  if (patch.date !== undefined) requireEpochMs(patch.date)
  const db = scoped()

  let noted = () => {}
  await db.transaction(async (tx) => {
    noted = () => {}
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new AppError('ไม่พบรายการ')
    if (mv.voided) throw new AppError('รายการนี้ถูกยกเลิกแล้ว')
    if ((mv.edits?.length ?? 0) >= MAX_EDITS) {
      throw new AppError('รายการนี้ถูกแก้ไขหลายครั้งเกินไป — กรุณายกเลิกแล้วบันทึกใหม่')
    }

    const from = patch.fromLocationId ?? mv.fromLocationId
    const to = patch.toLocationId ?? mv.toLocationId
    // A receipt has a destination and no source; an issue has both. Gaining or losing a side
    // would turn it into a different kind of movement while keeping its document number.
    if (!!from !== !!mv.fromLocationId || !!to !== !!mv.toLocationId) {
      throw new AppError('แก้ไขไม่ได้: เปลี่ยนรูปแบบรายการไม่ได้')
    }
    if (from && to && from === to) throw new AppError('คลังต้นทางและปลายทางต้องต่างกัน')
    await requireMasterData(tx, [], [from, to].filter((x): x is string => !!x))

    // What the row is keyed in after the edit, and how many of that.
    //
    // A row keyed in the product's own unit is edited by `qty`. A row keyed in another unit
    // is edited by `entryQty`, and its base quantity follows at the rate the row itself was
    // converted at — the product's rate may have changed since, and this row's history must
    // not. Changing the unit re-converts at the product's current rate, which is the one
    // case that needs the product read; a legacy row (never converted) is converted the
    // first time it is touched, and moves from its `#Unit` balance to the base balance.
    const nextUnit = patch.entryUnit === undefined ? (mv.entryUnit ?? '') : patch.entryUnit.trim()
    const keyedNext = nextUnit && !sameUnit(nextUnit, mv.unit) ? nextUnit : ''
    const unitChanged = !sameUnit(keyedNext, keyedUnit(mv) ?? '')
    const legacy = isLegacyUnitRow(mv)
    let qty: number
    let entryQty: number | undefined
    if (!keyedNext) {
      if (patch.entryQty !== undefined && !unitChanged) throw new AppError('รายการนี้คีย์เป็น {unit} อยู่แล้ว', { unit: mv.unit })
      qty = patch.qty ?? (unitChanged ? (patch.entryQty ?? mv.entryQty ?? mv.qty) : mv.qty)
      entryQty = undefined
    } else {
      if (patch.qty !== undefined) throw new AppError('รายการที่คีย์เป็น {unit} แก้จำนวนที่ช่อง {unit}', { unit: keyedNext })
      entryQty = patch.entryQty ?? (legacy ? mv.qty : (mv.entryQty ?? mv.qty))
      requireQty(entryQty)
      let factor: number | null
      if (unitChanged || legacy) {
        const product = await tx.get<Product>(COL.products, mv.productId)
        if (!product) throw new AppError('ไม่พบสินค้าในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่')
        factor = resolveFactor(product, keyedNext)
        // A legacy row whose unit still has no rate may keep its note or date corrected
        // without being converted; its quantity or unit cannot move until the rate is stated.
        if (factor === null && !(legacy && !unitChanged && patch.entryQty === undefined)) {
          throw new AppError('ยังไม่ได้กำหนดอัตราแปลง "{unit}" ของ "{name}" — กำหนดที่หน้าสินค้าก่อน', { unit: keyedNext, name: product.name })
        }
      } else {
        factor = factorOf(mv)
      }
      if (factor === null) {
        qty = mv.qty
        entryQty = undefined
      } else {
        qty = toBase(entryQty, factor)
      }
    }
    requireQty(qty, mv.productName)
    const stillLegacy = legacy && entryQty === undefined && !!keyedNext

    const before = { productId: mv.productId, unit: mv.unit, entryUnit: mv.entryUnit, entryQty: mv.entryQty }
    const after = { productId: mv.productId, unit: mv.unit, entryUnit: keyedNext || undefined, entryQty }

    // Net change per balance row. A unit or location that did not move cancels itself out
    // here and is never written, so an edit of the note alone touches no balance at all.
    const touched = new Map<string, { locationId: string; unit?: string; delta: number }>()
    function touch(
      locationId: string | undefined,
      x: { productId: string; unit: string; entryUnit?: string; entryQty?: number },
      delta: number,
    ) {
      if (!locationId) return
      const ref = levelRef(locationId, x)
      const cur = touched.get(ref.id)
      if (cur) cur.delta = roundQty(cur.delta + delta)
      else touched.set(ref.id, { locationId, unit: ref.unit, delta })
    }
    touch(mv.fromLocationId, before, mv.qty) // goods come back to where they left
    touch(mv.toLocationId, before, -mv.qty)
    touch(from, after, -qty)
    touch(to, after, qty)

    const ids = [...touched.keys()]
    const current = await Promise.all(ids.map((id) => tx.get<StockLevel>(COL.stockLevels, id)))

    const now = Date.now()
    ids.forEach((id, i) => {
      const t = touched.get(id)!
      if (t.delta === 0) return
      const next = roundQty((current[i]?.qty ?? 0) + t.delta)
      if (next < 0) throw new AppError('แก้ไขไม่ได้: ยอดคงเหลือจะติดลบ')
      tx.set(
        COL.stockLevels,
        id,
        levelDoc(t.locationId, mv.productId, next, actor, now, t.unit),
      )
    })

    const changed: string[] = []
    const changes: NonNullable<MovementEdit['changes']> = []
    const write: Record<string, unknown> = {}
    // `changed` keeps the Thai label the reports have always printed; `changes` carries the
    // field by key with the old and new value, for the activity log.
    const note = (label: string, field: MovementEditField, before: unknown, after: unknown) => {
      changed.push(label)
      changes.push({ field, from: String(before ?? ''), to: String(after ?? '') })
    }
    const said = (x: { qty: number; entryQty?: number; entryUnit?: string }) => describeQty({ ...x, unit: mv.unit })
    if (qty !== mv.qty || entryQty !== mv.entryQty) {
      write.qty = qty
      write.entryQty = entryQty === undefined ? DELETE_FIELD : entryQty
      note('จำนวน', entryQty === undefined && mv.entryQty === undefined ? 'qty' : 'entryQty', said(mv), said({ qty, entryQty, entryUnit: keyedNext || undefined })) // i18n-key
    }
    if (patch.date !== undefined && patch.date !== mv.date) {
      write.date = patch.date
      note('วันที่', 'date', mv.date, patch.date) // i18n-key
    }
    if (patch.note !== undefined && patch.note !== (mv.note ?? '')) {
      write.note = patch.note
      note('หมายเหตุ', 'note', mv.note, patch.note) // i18n-key
    }
    if (unitChanged || (legacy && keyedNext && !stillLegacy)) {
      write.entryUnit = keyedNext || DELETE_FIELD
      if (unitChanged) note('หน่วย', 'unit', mv.entryUnit || mv.unit, keyedNext || mv.unit) // i18n-key
    }
    if (from !== mv.fromLocationId) {
      write.fromLocationId = from
      note('คลังต้นทาง', 'from', mv.fromLocationId, from) // i18n-key
    }
    if (to !== mv.toLocationId) {
      write.toLocationId = to
      note('คลังปลายทาง', 'to', mv.toLocationId, to) // i18n-key
    }
    if (changed.length === 0) return

    const patchDoc = {
      ...write,
      // Appended, never replaced. The rules check it grew by exactly one and that the new
      // entry names the caller, so an edit cannot be filed under somebody else. The old and
      // new values ride along so the activity log can say what the row used to say.
      edits: [...(mv.edits ?? []), { by: actor.id, byName: actor.name, at: now, changed, changes }],
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    }
    tx.update(COL.movements, movementId, patchDoc)
    noted = () => noteChanged(mv, patchDoc)
  })
  noted()
}

/** Above this, relabelling would eat a noticeable share of the day's write allowance. */
const MAX_RELABEL = 1000

/**
 * Correct a product's own unit, and every row already filed under the old one.
 *
 * This used to be refused outright once a product had any stock or any history, on the
 * grounds that old numbers would read wrong afterwards. The quantities are not the problem —
 * a balance is keyed by the unit each movement recorded, not by the product's current one,
 * so renaming KG to EA leaves one balance with the same number in it and no drift. The
 * problem was only ever the labels, and the owner's answer is to correct those too: a unit
 * that was wrong was wrong on every row it was ever printed on.
 *
 * So every movement for this product is restamped, and each one carries an entry in its own
 * edit history naming who did it. Nothing is deleted and no quantity moves.
 */
export async function changeProductUnit(params: {
  productId: string
  unitType: string
  unit: string
  actor: Actor
}): Promise<number> {
  const { productId, actor } = params
  const unitType = params.unitType.trim()
  const unit = params.unit.trim()
  if (!unitType) throw new AppError('กรุณากรอกหน่วยนับ')
  requireId(productId, 'productId')
  const db = scoped()

  const product = await db.getOne<Product>(COL.products, productId)
  if (!product) throw new AppError('ไม่พบสินค้า')
  // Loose comparison for the same reason the form uses one: "Kilogram" and "kilogram" are
  // the same unit, and restamping a ledger over a capital letter would be indefensible.
  if (sameUnit(product.unitType, unitType) && sameUnit(product.unit, unit)) return 0

  // The rates on the product are stated in its current unit ("1 Carton = 500 EA"), and so
  // is every converted row; relabelling underneath them would make all of them lies.
  if (!sameUnit(product.unitType, unitType) && (product.unitConversions?.length ?? 0) > 0) {
    throw new AppError('สินค้านี้มีอัตราแปลงหน่วยอยู่ — เปลี่ยนหน่วยนับได้ที่ ตั้งค่า → เปลี่ยนหน่วยหลักพร้อมคำนวณ')
  }

  // One equality read for this product's rows, not the whole ledger.
  const mine = await db.getBy<StockMovement>(COL.movements, 'productId', productId)
  if (mine.length > MAX_RELABEL) {
    throw new AppError(
      'สินค้านี้มีประวัติ {count} รายการ มากเกินกว่าจะเปลี่ยนหน่วยทั้งหมดได้ — กรุณาสร้างสินค้าใหม่ด้วยหน่วยที่ถูกต้อง',
      { count: mine.length },
    )
  }
  if (!sameUnit(product.unitType, unitType) && mine.some((m) => m.entryQty !== undefined)) {
    throw new AppError('สินค้านี้มีประวัติที่แปลงหน่วยไว้แล้ว — เปลี่ยนหน่วยนับได้ที่ ตั้งค่า → เปลี่ยนหน่วยหลักพร้อมคำนวณ')
  }

  const now = Date.now()
  const stamp = { by: actor.id, byName: actor.name, at: now, changed: ['หน่วย'] } // i18n-key

  // Restamp first. Each write is idempotent, so a run that stops halfway can simply be run
  // again; and a movement already carrying the new unit files to the same balance it did
  // before, so a partial pass cannot leave the books disagreeing.
  for (const mv of mine) {
    const dropEntry = sameUnit(mv.entryUnit, unitType) && !!mv.entryUnit
    if (mv.unit === unitType && !dropEntry) continue
    await db.update(COL.movements, mv.id, {
      unit: unitType,
      // "10 EA of a product measured in EA" is just 10 — the separate unit was only ever
      // meaningful while it differed from the product's own.
      ...(dropEntry ? { entryUnit: DELETE_FIELD } : {}),
      edits: [...(mv.edits ?? []), stamp],
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    })
  }

  // Then rebuild this product's balances from its own restamped ledger. Only rows whose unit
  // collapsed into the product's own actually move, but rebuilding is cheaper to reason about
  // than working out which did.
  const relabelled = mine.map((mv) => ({
    ...mv,
    unit: unitType,
    entryUnit: sameUnit(mv.entryUnit, unitType) && mv.entryUnit ? undefined : mv.entryUnit,
  }))
  await rebuildProductLevels(db, productId, relabelled, actor, now)

  await db.update(COL.products, productId, { unitType, unit, updatedAt: now })
  return mine.length
}

/**
 * Write this one product's balances from its own ledger rows: every balance the ledger
 * calls for is set, and every existing row it no longer calls for is zeroed (a balance
 * cannot be deleted — the rules keep them). Shared by the unit change and the unit
 * migration. Refuses a ledger that sums below zero anywhere, like recomputeLevels.
 */
export async function rebuildProductLevels(
  db: Backend,
  productId: string,
  movements: readonly StockMovement[],
  actor: Actor,
  now: number,
): Promise<void> {
  const wanted = balancesFromLedger([...movements])
  for (const [id, qty] of wanted) {
    if (qty < 0) {
      const parsed = parseLevelId(id)
      throw new AppError('ยอดคงเหลือจะติดลบที่ {location} ({qty} {unit}) — แก้ประวัติก่อน', { location: parsed.locationId, qty, unit: parsed.unit ?? '' })
    }
  }
  const existing = (await db.getBy<StockLevel>(COL.stockLevels, 'productId', productId)) ?? []
  for (const [id, qty] of wanted) {
    const parsed = parseLevelId(id)
    await db.set(COL.stockLevels, id, levelDoc(parsed.locationId, productId, qty, actor, now, parsed.unit))
  }
  for (const lv of existing) {
    if (wanted.has(lv.id)) continue
    await db.set(COL.stockLevels, lv.id, levelDoc(lv.locationId, productId, 0, actor, now, lv.unit ?? parseLevelId(lv.id).unit))
  }
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
  let noted = () => {}
  await db.transaction(async (tx) => {
    noted = () => {}
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
    const patchDoc = { voided: true, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now }
    tx.update(COL.movements, movementId, patchDoc)
    noted = () => noteChanged(mv, patchDoc)
  })
  noted()
}

/** Balances rebuilt from the ledger, keyed `${locationId}__${productId}`. */
/**
 * Every balance the ledger adds up to, keyed the way stockLevels is — one per product per
 * location per keyed unit. Exported for the restore, which used to keep its own copy that
 * only knew the product's own unit: a 10 Pack balance was zeroed by the restore meant to
 * save it, because the copy never produced a `#Pack` key for it to survive under.
 */
export function balancesFromLedger(movements: StockMovement[]): Map<string, number> {
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

/**
 * Whether any movement was filed or edited at or after `since` — a cheap stand-in for
 * re-reading the whole ledger just to ask "did anything change". Two range queries, each
 * ordinarily empty, cost a handful of reads; re-reading the collection to answer the same
 * question once cost as many reads as the ledger has rows, twice over on a brand with two
 * months of history (22 Sep 2026 — a maintenance tool run repeatedly during an audit used
 * a full day's read quota by lunchtime).
 *
 * `since` is the moment the caller started reading, and is itself excluded: a row stamped
 * that same millisecond is the one the caller's own read already saw, not a new one — with
 * `Date.now()`'s millisecond resolution, a fast in-memory write can land on the exact same
 * tick as the read that is about to check for it.
 */
export async function movementsChangedSince(db: Backend, since: number): Promise<boolean> {
  const from = since + 1
  const now = Math.max(from, Date.now())
  const [created, updated] = await Promise.all([
    db.getRange<StockMovement>(COL.movements, 'createdAt', from, now),
    db.getRange<StockMovement>(COL.movements, 'updatedAt', from, now),
  ])
  return created.length > 0 || updated.length > 0
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
  const readAt = Date.now()
  const movements = await db.getAll<StockMovement>(COL.movements)
  const levels = await db.getAll<StockLevel>(COL.stockLevels)
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
  // being worked out, those totals are already stale and writing them would erase it. A
  // ranged check for "anything new since we started reading" answers this for a few reads
  // instead of the whole collection again.
  if (await movementsChangedSince(db, readAt)) {
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
