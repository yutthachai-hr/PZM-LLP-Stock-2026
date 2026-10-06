import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { countDayOf, monthlyCountId, postingPlan } from '../lib/monthlyCount'
import { COL, type MonthlyCount, type MonthlyCountLine, type MonthlyCountQuestion, type MonthlyCountResult } from '../types'
import { execute } from './stock'
import { BOOKS_MOVED, postCountCommand } from '../commands/countPost'

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
  /** Imported rows awaiting a decision: added, or answered (null). */
  questions?: Record<string, Omit<MonthlyCountQuestion, 'by' | 'byName' | 'at'> | null>
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
    const questions: Record<string, MonthlyCountQuestion> = { ...(sheet.questions ?? {}) }
    for (const [key, q] of Object.entries(params.questions ?? {})) {
      if (q === null) delete questions[key]
      else questions[key] = { ...q, by: actor.id, byName: actor.name, at: now }
    }
    tx.update(COL.monthlyCounts, id, { lines, questions, updatedAt: now, updatedBy: actor.id, updatedByName: actor.name })
    return { ...sheet, lines, questions, updatedAt: now, updatedBy: actor.id, updatedByName: actor.name }
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
    if (Object.keys(sheet.questions ?? {}).length) throw new AppError('ยังมีคำถามจากไฟล์ที่ยังไม่ได้ตอบ — ตอบให้ครบก่อนยืนยัน')
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

/** How many times the books may move under one confirm before the person is asked to retry. */
const MAX_TRIES = 4

/**
 * Confirm the count and file its differences on the month's last day (plan A10, 6 Oct 2026),
 * through the postCount command (src/commands/countPost.ts; on the server when this build
 * sends it there — ADR-001).
 *
 * The counted figures are the sheet's own, read inside each part's transaction; the
 * difference is worked out there from the balance at that moment less what has moved since
 * the count day. Every counted product is settled, not only the ones that showed a
 * difference on screen. If a balance moved after the books were read, the part is refused
 * with BOOKS_MOVED and this reads again and retries.
 *
 * Posted in parts (lib/monthlyCount postingPlan). Each part files its adjustment AND records
 * which products it covered, so a part that fails leaves the sheet in `posting` with exactly
 * the parts done — confirming again carries on and never files a product twice.
 */
export async function postMonthlyCount(params: {
  id: string
  actor: Actor
  note: string
  /**
   * `count` for a monthly count; `opening` when this count starts the system's books —
   * the first month, whose difference is the trial period's mistakes and not stock lost,
   * so it must not read as shrinkage in the reports (owner, 29 Sep 2026).
   */
  reason?: 'count' | 'opening'
}): Promise<string[]> {
  const { id, actor, note, reason = 'count' } = params
  const db = scoped()
  const docNos: string[] = []
  for (let attempt = 0; ; attempt++) {
    const sheet = await db.getOne<MonthlyCount>(COL.monthlyCounts, id)
    if (!sheet) throw new AppError('ไม่พบใบนับนี้')
    if (sheet.status === 'posted') {
      if (attempt === 0) throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')
      return docNos
    }
    const parts = postingPlan(Object.keys(sheet.lines).map((productId) => ({ productId })), sheet.postedIds)
    const finish = parts.length === 0 ? [[]] : parts
    try {
      for (const part of finish) {
        const docNo = await execute(postCountCommand, { id, productIds: part.map((r) => r.productId), note, reason }, actor)
        if (docNo) docNos.push(docNo)
      }
      return docNos
    } catch (e) {
      if (!(e instanceof AppError && e.key === BOOKS_MOVED)) throw e
      if (attempt + 1 >= MAX_TRIES) throw new AppError('มีการบันทึกสต๊อกของคลังนี้ระหว่างยืนยันหลายครั้ง — กรุณากดยืนยันอีกครั้ง')
    }
  }
}
