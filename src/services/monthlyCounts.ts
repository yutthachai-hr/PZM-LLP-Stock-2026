import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { countDayOf, monthlyCountId, postingPlan } from '../lib/monthlyCount'
import { balanceAtDayEnd } from '../lib/ledger'
import { levelId } from '../lib/levelKey'
import { roundQty } from '../lib/validate'
import { DAY_MS } from '../lib/inventoryRules/time'
import { COL, type MonthlyCount, type MonthlyCountLine, type MonthlyCountQuestion, type MonthlyCountResult, type StockLevel } from '../types'
import { filing, listMovementsInRange, planAdjust } from './stock'

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

/** One counted product, as the sheet hands it to the posting. */
export interface CountToPost {
  productId: string
  productName: string
  unit: string
  counted: number
  /** Cost per unit, for the value of the difference on the sheet's results. */
  cost: number
}

/** The books moved while the difference was being filed: read them again and retry. */
class BooksMoved extends Error {}

/** How many times the books may move under one confirm before the person is asked to retry. */
const MAX_TRIES = 4

/**
 * Confirm the count and file its differences on the month's last day (plan A10, 6 Oct 2026).
 *
 * The difference is not taken from the screen. It is worked out inside each part's
 * transaction from the balance as it is at that moment, less what has moved since the
 * count day: counted − (balance now − movements dated after the count day). Every counted
 * product is checked, not only the ones that showed a difference, because a delivery filed
 * while the manager was reviewing can turn a zero into a difference.
 *
 * The movements after the count day cannot be read inside a transaction (that needs a
 * query), so they are read just before, with the balances. If any balance in the part is
 * not what it was when they were read, something was filed in between and the figures are
 * stale: the part is abandoned, everything is read again, and it is retried. The result is
 * the invariant the plan asks for — once posted, the books on the count day say what was
 * counted, whatever was keyed meanwhile.
 *
 * Posted in parts (lib/monthlyCount postingPlan). Each part files its adjustment AND
 * records which products it covered, so a part that fails leaves the sheet in `posting`
 * with exactly the parts done — confirming again carries on and never files a product twice.
 */
export async function postMonthlyCount(params: {
  id: string
  counts: CountToPost[]
  actor: Actor
  note: string
  /**
   * `count` for a monthly count; `opening` when this count starts the system's books —
   * the first month, whose difference is the trial period's mistakes and not stock lost,
   * so it must not read as shrinkage in the reports (owner, 29 Sep 2026).
   */
  reason?: 'count' | 'opening'
}): Promise<string[]> {
  const { id, counts, actor, note, reason = 'count' } = params
  const db = scoped()
  const first = await db.getOne<MonthlyCount>(COL.monthlyCounts, id)
  if (!first) throw new AppError('ไม่พบใบนับนี้')
  if (first.status === 'posted') throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')
  const scope = (productId: string) => ({ productId, locationId: first.locationId })
  const after = first.countDate + DAY_MS
  const docNos: string[] = []

  for (let attempt = 0; ; attempt++) {
    // ---- the books, read fresh: balances at the location, and everything after the count day ----
    const levels = new Map(
      (await db.getBy<StockLevel>(COL.stockLevels, 'locationId', first.locationId)).map((l) => [l.id, l.qty]),
    )
    const later = after <= Date.now() ? await listMovementsInRange(after, Date.now() + 400 * DAY_MS) : []
    const sheet = (await db.getOne<MonthlyCount>(COL.monthlyCounts, id)) ?? first
    const parts = postingPlan(counts, sheet.postedIds)
    const finish = parts.length === 0 ? [[] as CountToPost[]] : parts
    try {
      for (let i = 0; i < finish.length; i++) {
        const part = finish[i]
        const last = i === finish.length - 1
        const docNo = await filing(db, async (tx, file) => {
          const cur = await tx.get<MonthlyCount>(COL.monthlyCounts, id)
          if (!cur) throw new AppError('ไม่พบใบนับนี้')
          if (cur.status === 'posted') throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')
          if (Object.keys(cur.questions ?? {}).length) throw new AppError('ยังมีคำถามจากไฟล์ที่ยังไม่ได้ตอบ — ตอบให้ครบก่อนยืนยัน')
          const done = new Set(cur.postedIds ?? [])
          const todo = part.filter((c) => !done.has(c.productId))

          // The balance of each product as it stands now, inside the transaction.
          const now = await Promise.all(todo.map((c) => tx.get<StockLevel>(COL.stockLevels, levelId(first.locationId, c.productId))))
          const results: Record<string, MonthlyCountResult> = {}
          const lines: CountAdjustment[] = []
          todo.forEach((c, k) => {
            const qty = now[k]?.qty ?? 0
            if (roundQty(qty) !== roundQty(levels.get(levelId(first.locationId, c.productId)) ?? 0)) throw new BooksMoved()
            const book = balanceAtDayEnd(qty, later, scope(c.productId), after)
            const diff = roundQty(c.counted - book)
            results[c.productId] = { systemQty: book, countedQty: c.counted, diff, value: Math.round(diff * c.cost * 100) / 100 }
            if (diff !== 0) lines.push({ productId: c.productId, productName: c.productName, unit: c.unit, diff })
          })

          let filed: string | null = null
          if (lines.length > 0) {
            const planned = await planAdjust(
              tx,
              {
                locationId: cur.locationId,
                date: cur.countDate,
                actor,
                note,
                lines: lines.map((a) => ({
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
          const at = Date.now()
          tx.update(COL.monthlyCounts, id, {
            status: last ? 'posted' : 'posting',
            results: { ...(cur.results ?? {}), ...results },
            postedIds: [...done, ...todo.map((c) => c.productId)],
            adjDocNos: [...(cur.adjDocNos ?? []), ...(filed ? [filed] : [])],
            confirmedBy: actor.id,
            confirmedByName: actor.name,
            confirmedAt: at,
            updatedAt: at,
          })
          return filed
        })
        if (docNo) docNos.push(docNo)
      }
      return docNos
    } catch (e) {
      if (!(e instanceof BooksMoved)) throw e
      if (attempt + 1 >= MAX_TRIES) throw new AppError('มีการบันทึกสต๊อกของคลังนี้ระหว่างยืนยันหลายครั้ง — กรุณากดยืนยันอีกครั้ง')
    }
  }
}

/** A difference to file, worked out inside the transaction. */
interface CountAdjustment {
  productId: string
  productName: string
  unit: string
  diff: number
}
