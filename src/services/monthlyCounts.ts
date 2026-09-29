import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { countDayOf, monthlyCountId } from '../lib/monthlyCount'
import { COL, type MonthlyCount, type MonthlyCountLine, type MonthlyCountResult } from '../types'
import { filing, planAdjust } from './stock'

/**
 * Monthly stock-count sheets (owner, 29 Sep 2026): figures are keyed and saved without
 * touching stock; a manager later either keeps them as a record or confirms them, which
 * files the differences as adjustments on the month's last day. See lib/monthlyCount for
 * the arithmetic and firestore.rules (monthlyCounts) for who may do what.
 */

interface Actor {
  id: string
  name: string
}

function scoped() {
  return backend.forBrand(getBrand())
}

export async function listMonthlyCounts(): Promise<MonthlyCount[]> {
  const rows = await scoped().getAll<MonthlyCount>(COL.monthlyCounts)
  return rows.sort((a, b) => b.month.localeCompare(a.month) || a.locationId.localeCompare(b.locationId))
}

export async function getMonthlyCount(id: string): Promise<MonthlyCount | null> {
  return scoped().getOne<MonthlyCount>(COL.monthlyCounts, id)
}

/** The sheet for this location and month — opened if it exists, started if not. */
export async function openMonthlyCount(params: { locationId: string; month: string; actor: Actor }): Promise<string> {
  const { locationId, month, actor } = params
  if (!locationId) throw new AppError('กรุณาเลือกคลัง')
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError('กรุณาเลือกเดือน')
  const id = monthlyCountId(locationId, month)
  return scoped().transaction(async (tx) => {
    const existing = await tx.get<MonthlyCount>(COL.monthlyCounts, id)
    if (existing) return id
    const now = Date.now()
    const sheet: Omit<MonthlyCount, 'id'> & { id: string } = {
      id,
      locationId,
      month,
      countDate: countDayOf(month),
      status: 'counting',
      lines: {},
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
    }
    tx.set(COL.monthlyCounts, id, sheet as unknown as Record<string, unknown>)
    return id
  })
}

/**
 * Save counted figures: `changes` maps a product to its count, or to null to clear it.
 * Merged inside a transaction, so two people counting different shelves of one sheet do
 * not overwrite each other's rows.
 */
export async function saveCountLines(params: {
  id: string
  changes: Record<string, { qty: number; entryUnit?: string; entryQty?: number } | null>
  actor: Actor
}): Promise<MonthlyCount> {
  const { id, changes, actor } = params
  return scoped().transaction(async (tx) => {
    const sheet = await tx.get<MonthlyCount>(COL.monthlyCounts, id)
    if (!sheet) throw new AppError('ไม่พบใบนับนี้')
    if (sheet.status !== 'counting') throw new AppError('ใบนับนี้ยืนยันแล้ว — แก้ยอดนับไม่ได้')
    const now = Date.now()
    const lines: Record<string, MonthlyCountLine> = { ...sheet.lines }
    for (const [productId, c] of Object.entries(changes)) {
      if (c === null) {
        delete lines[productId]
        continue
      }
      if (!Number.isFinite(c.qty) || c.qty < 0) throw new AppError('จำนวนที่นับได้ต้องไม่ติดลบ')
      lines[productId] = {
        qty: c.qty,
        ...(c.entryUnit && c.entryQty !== undefined ? { entryUnit: c.entryUnit, entryQty: c.entryQty } : {}),
        by: actor.id,
        byName: actor.name,
        at: now,
      }
    }
    tx.update(COL.monthlyCounts, id, { lines, updatedAt: now, updatedBy: actor.id, updatedByName: actor.name })
    return { ...sheet, lines, updatedAt: now, updatedBy: actor.id, updatedByName: actor.name }
  })
}

/** Keep the count as a record, stock untouched — while the books are not yet trusted. */
export async function recordMonthlyCount(params: {
  id: string
  results: Record<string, MonthlyCountResult>
  actor: Actor
}): Promise<void> {
  const { id, results, actor } = params
  await scoped().transaction(async (tx) => {
    const sheet = await tx.get<MonthlyCount>(COL.monthlyCounts, id)
    if (!sheet) throw new AppError('ไม่พบใบนับนี้')
    if (sheet.status !== 'counting') throw new AppError('ใบนับนี้ยืนยันแล้ว')
    const now = Date.now()
    tx.update(COL.monthlyCounts, id, {
      status: 'recorded',
      results,
      confirmedBy: actor.id,
      confirmedByName: actor.name,
      confirmedAt: now,
      updatedAt: now,
    })
  })
}

export interface CountAdjustment {
  productId: string
  productName: string
  unit: string
  diff: number
}

/**
 * Confirm the count and file its differences on the month's last day, in parts
 * (lib/monthlyCount postingPlan). Each part is one transaction that files its adjustment
 * AND records on the sheet which products it covered, so a part that fails leaves the
 * sheet in `posting` with exactly the parts done — confirming again carries on from there
 * and never files a product twice.
 */
export async function postMonthlyCount(params: {
  id: string
  parts: CountAdjustment[][]
  results: Record<string, MonthlyCountResult>
  actor: Actor
  note: string
  /**
   * `count` for a monthly count; `opening` when this count starts the system's books —
   * the first month, whose difference is the trial period's mistakes and not stock lost,
   * so it must not read as shrinkage in the reports (owner, 29 Sep 2026).
   */
  reason?: 'count' | 'opening'
}): Promise<string[]> {
  const { id, parts, results, actor, note, reason = 'count' } = params
  const db = scoped()
  const docNos: string[] = []
  const finish = parts.length === 0 ? [[] as CountAdjustment[]] : parts
  for (let i = 0; i < finish.length; i++) {
    const part = finish[i]
    const last = i === finish.length - 1
    const docNo = await filing(db, async (tx, file) => {
      const sheet = await tx.get<MonthlyCount>(COL.monthlyCounts, id)
      if (!sheet) throw new AppError('ไม่พบใบนับนี้')
      if (sheet.status === 'posted') throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')
      const done = new Set(sheet.postedIds ?? [])
      const todo = part.filter((a) => !done.has(a.productId))
      let filed: string | null = null
      if (todo.length > 0) {
        const planned = await planAdjust(
          tx,
          {
            locationId: sheet.locationId,
            date: sheet.countDate,
            actor,
            note,
            lines: todo.map((a) => ({
              productId: a.productId,
              productName: a.productName,
              unit: a.unit,
              qty: Math.abs(a.diff),
              direction: a.diff > 0 ? ('in' as const) : ('out' as const),
              reason,
            })),
          },
          file,
        )
        filed = planned.commit()
      }
      const now = Date.now()
      tx.update(COL.monthlyCounts, id, {
        status: last ? 'posted' : 'posting',
        results,
        postedIds: [...done, ...todo.map((a) => a.productId)],
        adjDocNos: [...(sheet.adjDocNos ?? []), ...(filed ? [filed] : [])],
        confirmedBy: actor.id,
        confirmedByName: actor.name,
        confirmedAt: now,
        updatedAt: now,
      })
      return filed
    })
    if (docNo) docNos.push(docNo)
  }
  return docNos
}
