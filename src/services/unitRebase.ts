import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { genId } from '../lib/id'
import { describeQty, resolveFactor } from '../lib/uom'
import { sameUnit, unitNameFor, type UnitConversion } from '../lib/units'
import { roundQty } from '../lib/validate'
import { COL, type PoRevisionEntry, type Product, type PurchaseOrder, type StockLevel, type StockLocation, type StockMovement } from '../types'
import { makeDocNo, rebuildProductLevels, setStockCount } from './stock'

/**
 * Changing a product's own unit AFTER goods and history exist — the case `changeProductUnit`
 * (a relabel) cannot do honestly, because 75 KG is not 75 pieces.
 *
 * Two ways, chosen per product by the owner (21 Sep 2026):
 *
 *  - **by rate** ("1 EA = 2.72 KG"): every row keyed in the old unit is re-expressed in the
 *    new one and keeps what was keyed — "5.44 KG (= 2 EA)" — so the history reads both
 *    ways; the product's rates are restated in the new unit; balances are rebuilt from
 *    the ledger. Where a site's new balance is not a whole number of a counting unit,
 *    the owner's physical count sets it right, filed as an ordinary count adjustment.
 *
 *  - **by recount** (catch weight — Parma legs that each weigh differently): the old
 *    weight rows cannot be turned into pieces, so they become legacy rows on the old
 *    unit's own balance, that balance is closed with a signed adjustment, and the new
 *    balance is the owner's physical count. Nothing is invented; the weights stay readable.
 *
 * Every row touched carries a signed edit; a run that stops halfway is finished by the
 * next (a row already in the new unit is skipped). Nothing runs without a preview.
 */

export type RebaseMode = 'rate' | 'recount'

export interface RebaseSite {
  locationId: string
  locationName: string
  /** The balance now, in the old unit (the base row). */
  oldQty: number
  /** Rate mode: what that comes to in the new unit; recount mode: the count-unit rows already there. */
  suggested: number
  /** Whether `suggested` is a whole number — a count unit cannot really hold 0.65 of a piece. */
  whole: boolean
}

export interface RebasePreview {
  productId: string
  productName: string
  from: string
  to: string
  mode: RebaseMode
  /** Rate mode: one `to` is this many `from`. */
  factor?: number
  sites: RebaseSite[]
  movements: number
  /** The product's rates as they will read afterwards. */
  conversions: UnitConversion[]
  /** Open orders carrying this product in the old unit — rewritten (rate) or blocking (recount). */
  openOrders: { docNo: string; lines: number }[]
}

const MAX_ROWS = 1000

function scoped() {
  return backend.forBrand(getBrand())
}

/** The product's rates restated in the new base: each old row's size divided by the rate. */
function restateConversions(product: Product, to: string, factor: number): UnitConversion[] {
  const out: UnitConversion[] = [{ label: product.unitType, size: 1, per: factor }]
  for (const c of product.unitConversions ?? []) {
    if (sameUnit(c.label, to) || sameUnit(c.label, product.unitType)) continue
    const inOld = resolveFactor(product, c.label)
    if (inOld === null) continue
    const inNew = inOld / factor
    // A clean ratio is kept as one; anything else is written as "size per" so nothing rounds.
    out.push(Number.isInteger(inNew) ? { label: c.label, size: inNew } : { label: c.label, size: inOld, per: factor })
  }
  return out
}

async function openOrdersFor(productId: string, oldUnit: string): Promise<PurchaseOrder[]> {
  const db = scoped()
  const ordered = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'ordered')
  const drafts = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'draft')
  return [...ordered, ...drafts].filter((o) => o.lines.some((l) => l.productId === productId && (!l.entryUnit || sameUnit(l.entryUnit, oldUnit) || l.baseQty !== undefined)))
}

export async function previewRebase(params: { productId: string; to: string; mode: RebaseMode; factor?: number }): Promise<RebasePreview> {
  const { productId, mode } = params
  const to = params.to.trim()
  const db = scoped()
  const product = await db.getOne<Product>(COL.products, productId)
  if (!product) throw new AppError('ไม่พบสินค้า')
  if (!to) throw new AppError('กรุณาเลือกหน่วยใหม่')
  if (sameUnit(product.unitType, to)) throw new AppError('สินค้านี้ใช้หน่วย {unit} อยู่แล้ว', { unit: to })
  const factor = params.factor
  if (mode === 'rate' && !(factor !== undefined && Number.isFinite(factor) && factor > 0)) {
    throw new AppError('กรุณาระบุอัตรา: 1 {to} = กี่ {from}', { to, from: product.unitType })
  }
  const [mine, levels, locations, orders] = await Promise.all([
    db.getBy<StockMovement>(COL.movements, 'productId', productId),
    db.getBy<StockLevel>(COL.stockLevels, 'productId', productId),
    db.getAll<StockLocation>(COL.locations),
    openOrdersFor(productId, product.unitType),
  ])
  if (mine.length > MAX_ROWS) throw new AppError('สินค้านี้มีประวัติ {count} รายการ มากเกินกว่าจะแปลงทั้งหมดได้', { count: mine.length })
  const name = (id: string) => locations.find((l) => l.id === id)?.name ?? id
  const sites: RebaseSite[] = []
  for (const l of locations.filter((x) => x.active !== false)) {
    const base = levels.find((x) => x.locationId === l.id && !x.unit)?.qty ?? 0
    const already = levels.find((x) => x.locationId === l.id && x.unit && sameUnit(x.unit, to))?.qty ?? 0
    const suggested = mode === 'rate' ? roundQty(base / factor! + already) : already
    if (base === 0 && already === 0) continue
    sites.push({ locationId: l.id, locationName: name(l.id), oldQty: base, suggested, whole: Number.isInteger(suggested) })
  }
  return {
    productId,
    productName: product.name,
    from: product.unitType,
    to,
    mode,
    ...(mode === 'rate' ? { factor } : {}),
    sites,
    movements: mine.filter((m) => !sameUnit(m.unit, to)).length,
    conversions: mode === 'rate' ? restateConversions(product, to, factor!) : [],
    openOrders: orders.map((o) => ({ docNo: o.docNo, lines: o.lines.filter((l) => l.productId === productId).length })),
  }
}

/**
 * Do it. `counts` are the owner's physical counts per site in the new unit — required in
 * recount mode, and in rate mode wherever the converted balance is not a whole number of
 * a counting unit (the screen insists). Returns what was written.
 */
export async function rebaseProductUnit(params: {
  productId: string
  to: string
  mode: RebaseMode
  factor?: number
  counts?: Record<string, number>
  actor: { id: string; name: string }
}): Promise<{ movements: number; counted: number; closed: number }> {
  const preview = await previewRebase(params)
  const { productId, mode, actor } = params
  const to = preview.to
  const from = preview.from
  const factor = preview.factor
  const db = scoped()
  const product = (await db.getOne<Product>(COL.products, productId))!
  const now = Date.now()

  if (mode === 'recount') {
    if (preview.openOrders.length > 0) {
      throw new AppError('มีใบสั่งซื้อที่เปิดอยู่ของสินค้านี้ในหน่วยเดิม ({list}) — รับของหรือยกเลิกก่อน', { list: preview.openOrders.map((o) => o.docNo).join(', ') })
    }
    for (const s of preview.sites) {
      if (params.counts?.[s.locationId] === undefined) throw new AppError('กรุณาระบุจำนวนนับจริงที่ {site}', { site: s.locationName })
    }
  } else {
    for (const s of preview.sites) {
      if (!s.whole && params.counts?.[s.locationId] === undefined) {
        throw new AppError('ยอดที่ {site} แปลงได้ {qty} {unit} ไม่เต็มหน่วย — กรุณาระบุจำนวนนับจริง', { site: s.locationName, qty: s.suggested, unit: to })
      }
    }
  }

  // ---- 1. the ledger, row by row ----
  const mine = await db.getBy<StockMovement>(COL.movements, 'productId', productId)
  const transformed: StockMovement[] = []
  let touched = 0
  for (const m of mine) {
    if (sameUnit(m.unit, to)) {
      transformed.push(m) // a row a previous run already brought across
      continue
    }
    const next: StockMovement = { ...m, unit: to }
    const write: Record<string, unknown> = { unit: to }
    const keyedInNew = !!m.entryUnit && sameUnit(m.entryUnit, to)
    if (keyedInNew && m.entryQty !== undefined) {
      // "2 EA (= 5.44 KG)" becomes plainly 2 EA — exact, no division.
      next.qty = m.entryQty
      delete next.entryUnit
      delete next.entryQty
      Object.assign(write, { qty: m.entryQty, entryUnit: DELETE_FIELD, entryQty: DELETE_FIELD })
    } else if (keyedInNew) {
      // A legacy row already keyed in the new unit: its quantity is the count.
      delete next.entryUnit
      write.entryUnit = DELETE_FIELD
    } else if (!m.entryUnit) {
      if (mode === 'rate') {
        // Keyed in the old base: keep it as keyed, file the converted quantity.
        next.entryUnit = from
        next.entryQty = m.qty
        next.qty = roundQty(m.qty / factor!)
        Object.assign(write, { entryUnit: from, entryQty: m.qty, qty: next.qty })
      } else {
        // Catch weight: the row keeps its weight on the old unit's own balance (legacy).
        next.entryUnit = from
        write.entryUnit = from
      }
    } else if (m.entryQty !== undefined) {
      // Converted from some third unit: its base quantity is re-expressed; what was keyed stays.
      if (mode === 'rate') {
        next.qty = roundQty(m.qty / factor!)
        write.qty = next.qty
      } else {
        // Its base quantity was a weight; it can only stay as a legacy weight row.
        next.entryUnit = from
        next.entryQty = undefined
        next.qty = m.qty
        Object.assign(write, { entryUnit: from, entryQty: DELETE_FIELD })
      }
    }
    // else: a legacy row in some third unit — relabelled only, its balance untouched.
    const edit = {
      by: actor.id,
      byName: actor.name,
      at: now,
      changed: ['หน่วย'], // i18n-key
      changes: [{ field: 'unit' as const, from: describeQty(m), to: describeQty(next) }],
    }
    await db.update(COL.movements, m.id, { ...write, edits: [...(m.edits ?? []), edit], updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
    transformed.push({ ...next, edits: [...(m.edits ?? []), edit] })
    touched++
  }

  // ---- 2. open orders: their lines follow the product (rate mode only) ----
  if (mode === 'rate') {
    const orders = await openOrdersFor(productId, from)
    for (const o of orders) {
      const lines = o.lines.map((l) => {
        if (l.productId !== productId) return l
        if (!l.entryUnit) return { ...l, unit: to, entryUnit: from, baseQty: roundQty(l.orderedQty / factor!) }
        if (sameUnit(l.entryUnit, to)) {
          const { entryUnit: _e, baseQty: _b, ...rest } = l
          void _e
          void _b
          return { ...rest, unit: to }
        }
        return { ...l, unit: to, ...(l.baseQty !== undefined ? { baseQty: roundQty(l.baseQty / factor!) } : {}) }
      })
      const rev = (o.revision ?? 0) + 1
      const entry: PoRevisionEntry = { rev, at: now, by: actor.id, byName: actor.name, reason: `เปลี่ยนหน่วยหลักสินค้า ${product.name}: ${from} → ${to}`, changes: [] }
      await db.update(COL.purchaseOrders, o.id, { lines, revision: rev, revisions: [...(o.revisions ?? []), entry], updatedAt: now })
    }
  }

  // ---- 3. the product itself ----
  await db.update(COL.products, productId, {
    unitType: to,
    unit: unitNameFor(to),
    unitConversions: preview.conversions.length ? preview.conversions : DELETE_FIELD,
    updatedAt: now,
  })

  // ---- 4. balances from the ledger ----
  await rebuildProductLevels(db, productId, transformed, actor, now)

  // ---- 5. recount: close the old weight balances, signed ----
  let closed = 0
  if (mode === 'recount') {
    const levels = await db.getBy<StockLevel>(COL.stockLevels, 'productId', productId)
    for (const lv of levels) {
      if (!lv.unit || !sameUnit(lv.unit, from) || !(lv.qty > 0)) continue
      const counter = await db.getOne<{ value: number }>(COL.counters, 'adjust')
      const seq = (counter?.value ?? 0) + 1
      await db.set(COL.counters, 'adjust', { value: seq })
      const mv: Omit<StockMovement, 'id'> = {
        docNo: makeDocNo('adjust', seq),
        type: 'adjust',
        productId,
        productName: product.name,
        unit: to,
        entryUnit: from,
        qty: lv.qty,
        fromLocationId: lv.locationId,
        reason: 'count',
        note: `ปิดยอด ${from} เดิม เมื่อเปลี่ยนสินค้าเป็นนับ ${to}`,
        date: now,
        byUserId: actor.id,
        byUserName: actor.name,
        createdAt: now,
      }
      await db.set(COL.movements, genId(), mv as Record<string, unknown>)
      await db.set(COL.stockLevels, lv.id, { productId, locationId: lv.locationId, unit: lv.unit, qty: 0, updatedAt: now, updatedBy: actor.id })
      closed++
    }
  }

  // ---- 6. the owner's counts, as ordinary count adjustments ----
  let counted = 0
  for (const [locationId, target] of Object.entries(params.counts ?? {})) {
    const changed = await setStockCount({ productId, productName: product.name, unit: to, locationId, targetQty: target, actor, note: `นับจริงเมื่อเปลี่ยนหน่วยเป็น ${to}` })
    if (changed) counted++
  }
  return { movements: touched, counted, closed }
}
