import { backend, BACKEND_MODE } from '../backend'
import { bumpCacheEpoch } from './cacheEpoch'
import { commandOn } from '../lib/stockCommands'
import type { CommandReader, CommandSpec } from '../commands/spec'
import {
  adjustStockCommand,
  consumeStockCommand,
  fileCountCommand,
  issueStockCommand,
  receiveStockCommand,
} from '../commands/stockCommands'
import { noteWritten } from '../data/recentWrites'
import { DELETE_FIELD, type Backend, type TxContext } from '../backend/types'
import { AppError } from '../i18n/AppError'
import {
  COL,
  type StockMovement,
  type Product,
  type AppUser,
  type StockLevel,
  type MovementEdit,
  type MovementEditField,
} from '../types'
import { genId } from '../lib/id'
import { getBrand } from '../brand/brand'
import { sameUnit } from '../lib/units'
import { describeQty, factorOf, isLegacyUnitRow, resolveFactor, toBase } from '../lib/uom'
import { balancesFromLedger, levelRef, parseLevelId } from '../lib/levelKey'
export { balancesFromLedger, parseLevelId } from '../lib/levelKey'
import {
  closedPeriod,
  type ConsumeParams,
  keyedUnit,
  levelDoc,
  requireMasterData,
  type Actor,
  type FileMovement,
  type PlanAdjustParams,
  type PlanIssueParams,
  type PlanReceiveParams,
} from '../commands/ledgerTx'
export * from '../commands/ledgerTx'
import {
  QTY_STEP,
  requireQty,
  requireCountQty,
  requireEpochMs,
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
  run: (tx: TxContext, file: FileMovement) => Promise<R>,
): Promise<R> {
  const targetDb = db ?? scoped()
  let sink: StockMovement[] = []
  const result = await targetDb.transaction(async (tx) => {
    sink = []
    return run(tx, (mv, given) => {
      const id = given ?? genId()
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
 * Run a stock command (ADR-001): on the server when this build sends it there, otherwise
 * here, through `filing`. The same transaction body either way (src/commands).
 */
export async function execute<P, R, C>(spec: CommandSpec<P, R, C>, params: P, actor: Actor): Promise<R> {
  // Pinned before anything is awaited: a brand switched mid-save must not split the work.
  const brand = getBrand()
  const db = scoped()
  const remote = await callCommand<R>(spec.name, params, brand)
  if (remote !== NOT_SENT) return remote
  const read: CommandReader = {
    get: (c, id) => db.getOne(c, id),
    getBy: (c, field, value) => db.getBy(c, field, value),
    getRange: async (c, field, from, to) => (await db.getRange(c, field, from, to)) ?? [],
  }
  const ctx = (spec.prepare ? await spec.prepare(read, params) : undefined) as C
  return filing(db, (tx, file) => spec.run(tx, file, params, actor, ctx))
}

/** What callCommand returns when the command stays on the client path. */
export const NOT_SENT = Symbol('not-sent')

/**
 * POST /api/stock/<name>. The server's refusals come back as the app's own words (key +
 * values) and are thrown as such. NOT_SENT when this build does not send the command, or
 * the server is not set up yet (503) — the client path then files it.
 */
export async function callCommand<R>(name: string, params: unknown, brand = getBrand()): Promise<R | typeof NOT_SENT> {
  if (BACKEND_MODE !== 'cloud' || !commandOn(name)) return NOT_SENT
  const { authHeader } = await import('./poImages')
  const res = await fetch(`/api/stock/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ brand, params }),
  })
  if (res.status === 503) return NOT_SENT
  const out = (await res.json().catch(() => ({}))) as { result?: R; error?: string; key?: string; vars?: Record<string, string | number> }
  if (res.status === 422 && out.key) throw new AppError(out.key, out.vars)
  if (res.status === 409) throw new AppError('ข้อมูลเพิ่งเปลี่ยนระหว่างบันทึก กรุณาลองอีกครั้ง')
  if (res.status === 401) throw new AppError('กรุณาเข้าสู่ระบบใหม่')
  if (res.status === 403) throw new AppError('ไม่มีสิทธิ์ทำรายการนี้')
  if (!res.ok || !('result' in out)) throw new AppError('บันทึกไม่สำเร็จ ลองอีกครั้ง')
  return out.result as R
}

export async function receiveStock(params: PlanReceiveParams): Promise<string> {
  const { actor, ...rest } = params
  return execute(receiveStockCommand, rest, actor)
}

/** Issue / transfer goods from one location to another (main -> branch). Moves stock. */
export async function issueStock(params: PlanIssueParams): Promise<string> {
  const { actor, transferId, ...rest } = params
  if (transferId) throw new AppError('รายการโอนบันทึกผ่านเอกสารโอนเท่านั้น')
  return execute(issueStockCommand, rest, actor)
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
export async function consumeStock(params: ConsumeParams): Promise<string> {
  const { actor, ...rest } = params
  return execute(consumeStockCommand, rest, actor)
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
  // One line of adjustStockLines: the same command, the same checks.
  const { productId, productName, unit, locationId, actor, note } = params
  return adjustStockLines({
    lines: [{
      productId,
      productName,
      unit,
      ...(params.entryUnit !== undefined ? { entryUnit: params.entryUnit } : {}),
      ...(params.entryQty !== undefined ? { entryQty: params.entryQty } : {}),
      qty: params.qty,
      direction: params.direction,
      reason: params.reason,
    }],
    locationId,
    date: params.date,
    actor,
    ...(note !== undefined ? { note } : {}),
  })
}

export async function adjustStockLines(params: PlanAdjustParams): Promise<string> {
  const { actor, transferId, ...rest } = params
  if (transferId) throw new AppError('รายการโอนบันทึกผ่านเอกสารโอนเท่านั้น')
  return execute(adjustStockCommand, rest, actor)
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
  requireCountQty(params.targetQty)
  const { actor, ...rest } = params
  return execute(fileCountCommand, rest, actor)
}

/**
 * File a count keyed after the day it was taken, as the difference it found.
 *
 * `countedQty` is what was on the shelf at the end of `date`; `asOfQty` is what the books
 * said then (lib/ledger `balanceBefore` / `balanceAtDayEnd`). Their difference is posted
 * on that date and everything filed since stays where it is — `setStockCount` would set
 * the balance to the old figure NOW and quietly erase it.
 *
 * Refused, like any adjustment, if taking the difference off today's balance goes below
 * zero: the count and the later issues cannot both be right.
 */
export async function postCountAsOf(params: {
  productId: string
  productName: string
  unit: string
  locationId: string
  countedQty: number
  asOfQty: number
  actor: Actor
  note?: string
  date: number
}): Promise<boolean> {
  const delta = roundQty(requireCountQty(params.countedQty) - params.asOfQty)
  if (!Number.isFinite(delta)) throw new AppError('ค่าไม่ถูกต้อง: {value}', { value: String(params.asOfQty) })
  const { actor, ...rest } = params
  return execute(fileCountCommand, rest, actor)
}

/** Edit the quantity/date/note of an existing movement, re-applying the balance delta atomically. */
/** Why a row received against an order cannot be changed in place (plan A8). */
/** An admin's correction reaching into a closed month (plan B1). */
const PERIOD_CLOSED_EDIT = 'เดือน {month} ปิดยอดนับแล้ว — ระบุเหตุผลการแก้ไขย้อนหลัง' // i18n-key

const ORDER_LOCKED = 'รายการนี้รับเข้าจากใบสั่งซื้อ {docNo} — แก้ได้เฉพาะหมายเหตุ ถ้าจำนวนหรือรายละเอียดผิดให้บันทึกการปรับสต๊อกแทน' // i18n-key

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
  /**
   * Why a row in a month whose count is posted is being changed (plan B1). Required then,
   * and kept on the row's edit history; ignored otherwise.
   */
  overrideReason?: string
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
async function editMovementUnbumped(params: {
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
    // A transfer's rows are explained by the transfer; they are corrected through it.
    if (mv.transferId) throw new AppError('รายการนี้มาจากเอกสารส่งสินค้า — แก้ไขผ่านเอกสารนั้น')
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
    // The period lock (plan B1): a row in a closed month, or moved into one, changes only
    // with a reason, which stays on the row.
    const closed =
      (await closedPeriod(tx, [mv.fromLocationId, mv.toLocationId], mv.date)) ??
      (await closedPeriod(tx, [from, to], patch.date ?? mv.date))
    const overrideReason = patch.overrideReason?.trim()
    if (closed && !overrideReason) throw new AppError(PERIOD_CLOSED_EDIT, { month: closed })

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

    // A row received against a purchase order is half of a pair: the order's lines and
    // receipts say the same thing, and the rules never let a receipt come off an order
    // (plan A8, 6 Oct 2026). Changing the quantity, unit, place or day here would leave
    // the two disagreeing, so only the note may change; a wrong count is put right with
    // an adjustment, which leaves both records true.
    if (mv.poId) {
      const moved =
        qty !== mv.qty ||
        entryQty !== mv.entryQty ||
        unitChanged ||
        from !== mv.fromLocationId ||
        to !== mv.toLocationId ||
        (patch.date !== undefined && patch.date !== mv.date)
      if (moved) throw new AppError(ORDER_LOCKED, { docNo: mv.poDocNo ?? '' })
    }

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
      edits: [...(mv.edits ?? []), { by: actor.id, byName: actor.name, at: now, changed, changes, ...(closed && overrideReason ? { periodOverride: overrideReason } : {}) }],
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
async function changeProductUnitUnbumped(params: {
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
async function rebuildProductLevelsUnbumped(
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
async function voidMovementUnbumped(movementId: string, actor: Actor, reason: string): Promise<void> {
  // An admin's decision, with why (plan A9): the rules refuse a void without one.
  const why = reason.trim()
  if (!why) throw new AppError('กรุณาระบุเหตุผลที่ยกเลิก')
  const db = scoped()
  let noted = () => {}
  await db.transaction(async (tx) => {
    noted = () => {}
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new AppError('ไม่พบรายการ')
    if (mv.voided) return
    if (mv.transferId) throw new AppError('รายการนี้มาจากเอกสารส่งสินค้า — แก้ไขผ่านเอกสารนั้น')
    // The order it was received against still counts it (plan A8): see editMovement.
    if (mv.poId) throw new AppError(ORDER_LOCKED, { docNo: mv.poDocNo ?? '' })

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
    const patchDoc = { voided: true, voidReason: why, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now }
    tx.update(COL.movements, movementId, patchDoc)
    noted = () => noteChanged(mv, patchDoc)
  })
  noted()
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
async function recomputeLevelsUnbumped(actor: Actor): Promise<void> {
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

/** editMovement, then the devices' caches told to read again (release hardening: services/cacheEpoch). */
export async function editMovement(...args: Parameters<typeof editMovementUnbumped>): ReturnType<typeof editMovementUnbumped> {
  const result = await editMovementUnbumped(...args)
  await bumpCacheEpoch(['stockMovements', 'stockLevels'])
  return result
}

/** changeProductUnit, then the devices' caches told to read again (release hardening: services/cacheEpoch). */
export async function changeProductUnit(...args: Parameters<typeof changeProductUnitUnbumped>): ReturnType<typeof changeProductUnitUnbumped> {
  const result = await changeProductUnitUnbumped(...args)
  await bumpCacheEpoch(['stockMovements', 'stockLevels', 'products'])
  return result
}

/** rebuildProductLevels, then the devices' caches told to read again (release hardening: services/cacheEpoch). */
export async function rebuildProductLevels(...args: Parameters<typeof rebuildProductLevelsUnbumped>): ReturnType<typeof rebuildProductLevelsUnbumped> {
  const result = await rebuildProductLevelsUnbumped(...args)
  await bumpCacheEpoch(['stockLevels'])
  return result
}

/** voidMovement, then the devices' caches told to read again (release hardening: services/cacheEpoch). */
export async function voidMovement(...args: Parameters<typeof voidMovementUnbumped>): ReturnType<typeof voidMovementUnbumped> {
  const result = await voidMovementUnbumped(...args)
  await bumpCacheEpoch(['stockMovements', 'stockLevels'])
  return result
}

/** recomputeLevels, then the devices' caches told to read again (release hardening: services/cacheEpoch). */
export async function recomputeLevels(...args: Parameters<typeof recomputeLevelsUnbumped>): ReturnType<typeof recomputeLevelsUnbumped> {
  const result = await recomputeLevelsUnbumped(...args)
  await bumpCacheEpoch(['stockLevels'])
  return result
}
