import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import {
  COL,
  type StockMovement,
  type MovementType,
  type Product,
  type AppUser,
  type StockLevel,
} from '../types'
import { genId } from '../lib/id'

// ============================================================================
// Stock engine — the ONLY place stock balances change.
// Every operation writes an immutable movement to the ledger AND updates the
// cached balance (stockLevels) inside a single atomic transaction.
// ============================================================================

export interface MovementLine {
  productId: string
  productName: string
  unit: string
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

function levelId(locationId: string, productId: string): string {
  return `${locationId}__${productId}`
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
): Record<string, unknown> {
  return {
    productId,
    locationId,
    qty: round(qty),
    updatedAt: now,
    updatedBy: actor.id,
  }
}

function makeDocNo(type: MovementType, seq: number): string {
  return `${PREFIX[type]}-${String(seq).padStart(5, '0')}`
}

/** Receive goods into a location (usually the main warehouse). Adds stock. */
export async function receiveStock(params: {
  lines: MovementLine[]
  toLocationId: string
  date: number
  actor: Actor
  note?: string
}): Promise<string> {
  const { lines, toLocationId, date, actor, note } = params
  if (lines.length === 0) throw new AppError('ไม่มีรายการสินค้า')
  for (const l of lines) if (!(l.qty > 0)) throw new AppError('จำนวนต้องมากกว่า 0')

  return backend.transaction(async (tx) => {
    // ---- reads ----
    const counter = await tx.get<{ value: number }>(COL.counters, 'receive')
    const seq = (counter?.value ?? 0) + 1
    const levels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelId(toLocationId, l.productId))),
    )
    // ---- writes ----
    const docNo = makeDocNo('receive', seq)
    tx.set(COL.counters, 'receive', { value: seq })
    const now = Date.now()
    lines.forEach((l, i) => {
      const cur = levels[i]?.qty ?? 0
      tx.set(
        COL.stockLevels,
        levelId(toLocationId, l.productId),
        levelDoc(toLocationId, l.productId, cur + l.qty, actor, now),
      )
      const mvId = genId()
      const mv: Omit<StockMovement, 'id'> = {
        docNo,
        type: 'receive',
        productId: l.productId,
        productName: l.productName,
        unit: l.unit,
        qty: l.qty,
        toLocationId,
        note: l.note ?? note,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      tx.set(COL.movements, mvId, mv as Record<string, unknown>)
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
  const { lines, fromLocationId, toLocationId, date, actor, note } = params
  if (lines.length === 0) throw new AppError('ไม่มีรายการสินค้า')
  if (fromLocationId === toLocationId) throw new AppError('ต้นทางและปลายทางต้องต่างกัน')
  for (const l of lines) if (!(l.qty > 0)) throw new AppError('จำนวนต้องมากกว่า 0')

  return backend.transaction(async (tx) => {
    // ---- reads ----
    const counter = await tx.get<{ value: number }>(COL.counters, 'issue')
    const seq = (counter?.value ?? 0) + 1
    const fromLevels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelId(fromLocationId, l.productId))),
    )
    const toLevels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelId(toLocationId, l.productId))),
    )
    // validate availability
    lines.forEach((l, i) => {
      const avail = fromLevels[i]?.qty ?? 0
      if (l.qty > avail) {
        throw new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: l.unit })
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
        levelId(fromLocationId, l.productId),
        levelDoc(fromLocationId, l.productId, fromCur - l.qty, actor, now),
      )
      tx.set(
        COL.stockLevels,
        levelId(toLocationId, l.productId),
        levelDoc(toLocationId, l.productId, toCur + l.qty, actor, now),
      )
      const mvId = genId()
      const mv: Omit<StockMovement, 'id'> = {
        docNo,
        type: 'issue',
        productId: l.productId,
        productName: l.productName,
        unit: l.unit,
        qty: l.qty,
        fromLocationId,
        toLocationId,
        note: l.note ?? note,
        date,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      tx.set(COL.movements, mvId, mv as Record<string, unknown>)
    })
    return docNo
  })
}

/**
 * Consume / issue-out stock from a location for use or front-store sale (e.g. the Sukhumvit
 * store co-located with the main warehouse). Reduces the source balance with NO destination —
 * the goods are used up. Optionally attaches a proof photo (stored in movementImages/{docNo}).
 */
export async function consumeStock(params: {
  lines: MovementLine[]
  fromLocationId: string
  date: number
  actor: Actor
  note?: string
  photoDataUrl?: string
}): Promise<string> {
  const { lines, fromLocationId, date, actor, note, photoDataUrl } = params
  if (lines.length === 0) throw new AppError('ไม่มีรายการสินค้า')
  for (const l of lines) if (!(l.qty > 0)) throw new AppError('จำนวนต้องมากกว่า 0')

  const docNo = await backend.transaction(async (tx) => {
    // ---- reads ----
    const counter = await tx.get<{ value: number }>(COL.counters, 'consume')
    const seq = (counter?.value ?? 0) + 1
    const levels = await Promise.all(
      lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelId(fromLocationId, l.productId))),
    )
    lines.forEach((l, i) => {
      const avail = levels[i]?.qty ?? 0
      if (l.qty > avail) {
        throw new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: l.unit })
      }
    })
    // ---- writes ----
    const doc = makeDocNo('consume', seq)
    tx.set(COL.counters, 'consume', { value: seq })
    const now = Date.now()
    lines.forEach((l, i) => {
      const cur = levels[i]?.qty ?? 0
      tx.set(
        COL.stockLevels,
        levelId(fromLocationId, l.productId),
        levelDoc(fromLocationId, l.productId, cur - l.qty, actor, now),
      )
      const mv: Omit<StockMovement, 'id'> = {
        docNo: doc,
        type: 'consume',
        productId: l.productId,
        productName: l.productName,
        unit: l.unit,
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

  if (photoDataUrl) {
    await backend.set(COL.movementImages, docNo, { dataUrl: photoDataUrl })
  }
  return docNo
}

/** Fetch the proof photo attached to a movement document (by docNo). */
export async function getMovementImage(docNo: string): Promise<string | null> {
  const img = await backend.getOne<{ dataUrl: string }>(COL.movementImages, docNo)
  return img?.dataUrl ?? null
}

/** Adjust stock at a location (loss, breakage, count correction, found). */
export async function adjustStock(params: {
  productId: string
  productName: string
  unit: string
  locationId: string
  direction: 'in' | 'out'
  qty: number
  reason: string
  date: number
  actor: Actor
  note?: string
}): Promise<string> {
  const { productId, productName, unit, locationId, direction, qty, reason, date, actor, note } =
    params
  if (!(qty > 0)) throw new AppError('จำนวนต้องมากกว่า 0')

  return backend.transaction(async (tx) => {
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const seq = (counter?.value ?? 0) + 1
    const level = await tx.get<StockLevel>(COL.stockLevels, levelId(locationId, productId))
    const cur = level?.qty ?? 0
    const delta = direction === 'in' ? qty : -qty
    const next = cur + delta
    if (next < 0) throw new AppError('สต๊อกไม่พอ (คงเหลือ {qty} {unit})', { qty: cur, unit })

    const docNo = makeDocNo('adjust', seq)
    tx.set(COL.counters, 'adjust', { value: seq })
    const now = Date.now()
    tx.set(
      COL.stockLevels,
      levelId(locationId, productId),
      levelDoc(locationId, productId, next, actor, now),
    )
    const mv: Omit<StockMovement, 'id'> = {
      docNo,
      type: 'adjust',
      productId,
      productName,
      unit,
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
 */
export async function setStockCount(params: {
  productId: string
  productName: string
  unit: string
  locationId: string
  targetQty: number
  actor: Actor
  note?: string
}): Promise<void> {
  const { productId, productName, unit, locationId, targetQty, actor, note } = params
  if (targetQty < 0) throw new AppError('จำนวนต้องไม่ติดลบ')

  return backend.transaction(async (tx) => {
    const level = await tx.get<StockLevel>(COL.stockLevels, levelId(locationId, productId))
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const cur = level?.qty ?? 0
    const delta = round(targetQty - cur)
    if (delta === 0) return

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
      date: now,
      byUserId: actor.id,
      byUserName: actor.name,
      createdAt: now,
    }
    tx.set(COL.movements, genId(), mv as Record<string, unknown>)
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
  const { movementId, newQty, newDate, newNote, actor } = params
  if (!(newQty > 0)) throw new AppError('จำนวนต้องมากกว่า 0')

  return backend.transaction(async (tx) => {
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new AppError('ไม่พบรายการ')
    if (mv.voided) throw new AppError('รายการนี้ถูกยกเลิกแล้ว')
    const delta = newQty - mv.qty

    const fromLevel = mv.fromLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelId(mv.fromLocationId, mv.productId))
      : null
    const toLevel = mv.toLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelId(mv.toLocationId, mv.productId))
      : null

    const now = Date.now()
    if (mv.fromLocationId) {
      const cur = fromLevel?.qty ?? 0
      const next = cur - delta // more qty out => lower balance
      if (next < 0) throw new AppError('แก้ไขไม่ได้: สต๊อกต้นทางจะติดลบ')
      tx.set(
        COL.stockLevels,
        levelId(mv.fromLocationId, mv.productId),
        levelDoc(mv.fromLocationId, mv.productId, next, actor, now),
      )
    }
    if (mv.toLocationId) {
      const cur = toLevel?.qty ?? 0
      const next = cur + delta
      if (next < 0) throw new AppError('แก้ไขไม่ได้: สต๊อกปลายทางจะติดลบ')
      tx.set(
        COL.stockLevels,
        levelId(mv.toLocationId, mv.productId),
        levelDoc(mv.toLocationId, mv.productId, next, actor, now),
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

/** Void a movement: reverse its balance effect and mark it voided (keeps the audit trail). */
export async function voidMovement(movementId: string, actor: Actor): Promise<void> {
  return backend.transaction(async (tx) => {
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new AppError('ไม่พบรายการ')
    if (mv.voided) return

    const fromLevel = mv.fromLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelId(mv.fromLocationId, mv.productId))
      : null
    const toLevel = mv.toLocationId
      ? await tx.get<StockLevel>(COL.stockLevels, levelId(mv.toLocationId, mv.productId))
      : null

    const now = Date.now()
    // reverse: add back to 'from', remove from 'to'
    if (mv.fromLocationId) {
      const cur = fromLevel?.qty ?? 0
      tx.set(
        COL.stockLevels,
        levelId(mv.fromLocationId, mv.productId),
        levelDoc(mv.fromLocationId, mv.productId, cur + mv.qty, actor, now),
      )
    }
    if (mv.toLocationId) {
      const cur = toLevel?.qty ?? 0
      const next = cur - mv.qty
      tx.set(
        COL.stockLevels,
        levelId(mv.toLocationId, mv.productId),
        levelDoc(mv.toLocationId, mv.productId, next < 0 ? 0 : next, actor, now),
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
      const k = levelId(m.fromLocationId, m.productId)
      map.set(k, round((map.get(k) ?? 0) - m.qty))
    }
    if (m.toLocationId) {
      const k = levelId(m.toLocationId, m.productId)
      map.set(k, round((map.get(k) ?? 0) + m.qty))
    }
  }
  return map
}

export interface LevelDrift {
  id: string
  locationId: string
  productId: string
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
  const [movements, levels] = await Promise.all([
    backend.getAll<StockMovement>(COL.movements),
    backend.getAll<StockLevel>(COL.stockLevels),
  ])
  const ledger = balancesFromLedger(movements)
  const cached = new Map(levels.map((l) => [l.id, l]))
  const out: LevelDrift[] = []

  for (const id of new Set([...ledger.keys(), ...cached.keys()])) {
    const expected = ledger.get(id) ?? 0
    const actual = cached.get(id)?.qty ?? 0
    // Both sides are rounded to 3 decimals already; anything smaller is float noise.
    if (Math.abs(expected - actual) < 0.0005) continue
    const [locationId, productId] = id.split('__')
    const lv = cached.get(id) as (StockLevel & { updatedBy?: string }) | undefined
    out.push({
      id,
      locationId: lv?.locationId ?? locationId,
      productId: lv?.productId ?? productId,
      cached: actual,
      fromLedger: expected,
      updatedBy: lv?.updatedBy,
      updatedAt: lv?.updatedAt,
    })
  }
  return out.sort((a, b) => Math.abs(b.fromLedger - b.cached) - Math.abs(a.fromLedger - a.cached))
}

/**
 * Rebuild ALL stockLevels from the movement ledger. The ledger is the source of truth;
 * this repairs the cached balances if they ever drift (admin maintenance tool).
 */
export async function recomputeLevels(actor: Actor): Promise<void> {
  const movements = await backend.getAll<StockMovement>(COL.movements)
  const levels = await backend.getAll<StockLevel>(COL.stockLevels)
  const map = balancesFromLedger(movements)

  // A ledger that adds up to less than nothing means the history itself is wrong, not the
  // cache — voiding a receipt whose goods were already used is the way that happens. Say
  // so instead of writing a negative balance the rules would refuse anyway, one document
  // in, leaving half the warehouse rebuilt.
  const negative = [...map].filter(([, qty]) => qty < 0)
  if (negative.length > 0) {
    throw new AppError(
      'คำนวณใหม่ไม่ได้: ประวัติทำให้ยอดติดลบ {count} รายการ (เช่น {example}) — ตรวจรายการที่ถูกยกเลิกก่อน',
      { count: negative.length, example: negative[0][0] },
    )
  }

  const now = Date.now()
  // write recomputed
  for (const [id, qty] of map) {
    const [locationId, productId] = id.split('__')
    await backend.set(COL.stockLevels, id, levelDoc(locationId, productId, qty, actor, now))
  }
  // zero-out any existing level not present in the ledger
  for (const lv of levels) {
    if (!map.has(lv.id)) {
      await backend.set(COL.stockLevels, lv.id, levelDoc(lv.locationId, lv.productId, 0, actor, now))
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

// re-export for convenience
export type { Product, AppUser }
