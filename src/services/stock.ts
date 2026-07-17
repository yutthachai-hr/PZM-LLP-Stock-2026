import { backend } from '../backend'
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
  if (lines.length === 0) throw new Error('ไม่มีรายการสินค้า')
  for (const l of lines) if (!(l.qty > 0)) throw new Error('จำนวนต้องมากกว่า 0')

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
      tx.set(COL.stockLevels, levelId(toLocationId, l.productId), {
        productId: l.productId,
        locationId: toLocationId,
        qty: round(cur + l.qty),
        updatedAt: now,
      })
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
  if (lines.length === 0) throw new Error('ไม่มีรายการสินค้า')
  if (fromLocationId === toLocationId) throw new Error('ต้นทางและปลายทางต้องต่างกัน')
  for (const l of lines) if (!(l.qty > 0)) throw new Error('จำนวนต้องมากกว่า 0')

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
        throw new Error(`สต๊อกไม่พอสำหรับ "${l.productName}" (คงเหลือ ${avail} ${l.unit})`)
      }
    })
    // ---- writes ----
    const docNo = makeDocNo('issue', seq)
    tx.set(COL.counters, 'issue', { value: seq })
    const now = Date.now()
    lines.forEach((l, i) => {
      const fromCur = fromLevels[i]?.qty ?? 0
      const toCur = toLevels[i]?.qty ?? 0
      tx.set(COL.stockLevels, levelId(fromLocationId, l.productId), {
        productId: l.productId,
        locationId: fromLocationId,
        qty: round(fromCur - l.qty),
        updatedAt: now,
      })
      tx.set(COL.stockLevels, levelId(toLocationId, l.productId), {
        productId: l.productId,
        locationId: toLocationId,
        qty: round(toCur + l.qty),
        updatedAt: now,
      })
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
  if (lines.length === 0) throw new Error('ไม่มีรายการสินค้า')
  for (const l of lines) if (!(l.qty > 0)) throw new Error('จำนวนต้องมากกว่า 0')

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
        throw new Error(`สต๊อกไม่พอสำหรับ "${l.productName}" (คงเหลือ ${avail} ${l.unit})`)
      }
    })
    // ---- writes ----
    const doc = makeDocNo('consume', seq)
    tx.set(COL.counters, 'consume', { value: seq })
    const now = Date.now()
    lines.forEach((l, i) => {
      const cur = levels[i]?.qty ?? 0
      tx.set(COL.stockLevels, levelId(fromLocationId, l.productId), {
        productId: l.productId,
        locationId: fromLocationId,
        qty: round(cur - l.qty),
        updatedAt: now,
      })
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
  if (!(qty > 0)) throw new Error('จำนวนต้องมากกว่า 0')

  return backend.transaction(async (tx) => {
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const seq = (counter?.value ?? 0) + 1
    const level = await tx.get<StockLevel>(COL.stockLevels, levelId(locationId, productId))
    const cur = level?.qty ?? 0
    const delta = direction === 'in' ? qty : -qty
    const next = cur + delta
    if (next < 0) throw new Error(`สต๊อกไม่พอ (คงเหลือ ${cur} ${unit})`)

    const docNo = makeDocNo('adjust', seq)
    tx.set(COL.counters, 'adjust', { value: seq })
    const now = Date.now()
    tx.set(COL.stockLevels, levelId(locationId, productId), {
      productId,
      locationId,
      qty: round(next),
      updatedAt: now,
    })
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
  if (targetQty < 0) throw new Error('จำนวนต้องไม่ติดลบ')

  return backend.transaction(async (tx) => {
    const level = await tx.get<StockLevel>(COL.stockLevels, levelId(locationId, productId))
    const counter = await tx.get<{ value: number }>(COL.counters, 'adjust')
    const cur = level?.qty ?? 0
    const delta = round(targetQty - cur)
    if (delta === 0) return

    const seq = (counter?.value ?? 0) + 1
    const now = Date.now()
    tx.set(COL.counters, 'adjust', { value: seq })
    tx.set(COL.stockLevels, levelId(locationId, productId), {
      productId,
      locationId,
      qty: round(targetQty),
      updatedAt: now,
    })
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
  if (!(newQty > 0)) throw new Error('จำนวนต้องมากกว่า 0')

  return backend.transaction(async (tx) => {
    const mv = await tx.get<StockMovement>(COL.movements, movementId)
    if (!mv) throw new Error('ไม่พบรายการ')
    if (mv.voided) throw new Error('รายการนี้ถูกยกเลิกแล้ว')
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
      if (next < 0) throw new Error('แก้ไขไม่ได้: สต๊อกต้นทางจะติดลบ')
      tx.set(COL.stockLevels, levelId(mv.fromLocationId, mv.productId), {
        productId: mv.productId,
        locationId: mv.fromLocationId,
        qty: round(next),
        updatedAt: now,
      })
    }
    if (mv.toLocationId) {
      const cur = toLevel?.qty ?? 0
      const next = cur + delta
      if (next < 0) throw new Error('แก้ไขไม่ได้: สต๊อกปลายทางจะติดลบ')
      tx.set(COL.stockLevels, levelId(mv.toLocationId, mv.productId), {
        productId: mv.productId,
        locationId: mv.toLocationId,
        qty: round(next),
        updatedAt: now,
      })
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
    if (!mv) throw new Error('ไม่พบรายการ')
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
      tx.set(COL.stockLevels, levelId(mv.fromLocationId, mv.productId), {
        productId: mv.productId,
        locationId: mv.fromLocationId,
        qty: round(cur + mv.qty),
        updatedAt: now,
      })
    }
    if (mv.toLocationId) {
      const cur = toLevel?.qty ?? 0
      const next = cur - mv.qty
      tx.set(COL.stockLevels, levelId(mv.toLocationId, mv.productId), {
        productId: mv.productId,
        locationId: mv.toLocationId,
        qty: round(next < 0 ? 0 : next),
        updatedAt: now,
      })
    }
    tx.update(COL.movements, movementId, {
      voided: true,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    })
  })
}

/**
 * Rebuild ALL stockLevels from the movement ledger. The ledger is the source of truth;
 * this repairs the cached balances if they ever drift (admin maintenance tool).
 */
export async function recomputeLevels(): Promise<void> {
  const movements = await backend.getAll<StockMovement>(COL.movements)
  const levels = await backend.getAll<StockLevel>(COL.stockLevels)
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
  // write recomputed
  for (const [id, qty] of map) {
    const [locationId, productId] = id.split('__')
    await backend.set(COL.stockLevels, id, {
      productId,
      locationId,
      qty,
      updatedAt: Date.now(),
    })
  }
  // zero-out any existing level not present in the ledger
  for (const lv of levels) {
    if (!map.has(lv.id)) {
      await backend.set(COL.stockLevels, lv.id, { ...lv, qty: 0, updatedAt: Date.now() })
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

// re-export for convenience
export type { Product, AppUser }
