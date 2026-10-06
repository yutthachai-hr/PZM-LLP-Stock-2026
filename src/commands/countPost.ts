import { AppError } from '../i18n/AppError'
import { balanceAtDayEnd } from '../lib/ledger'
import { isBig } from '../lib/monthlyCount'
import { levelId } from '../lib/levelKey'
import { DAY_MS } from '../lib/inventoryRules/time'
import { roundQty } from '../lib/validate'
import { COL, type MonthlyCount, type MonthlyCountResult, type Product, type Role, type StockLevel, type StockMovement } from '../types'
import { id as idOf, list, obj, only, text } from './check'
import { planAdjust } from './ledgerTx'
import { BadInput, defineCommand } from './spec'

/**
 * Posting a monthly count, one part at a time (plan A10, ADR-001).
 *
 * The counted figures come from the sheet itself, read inside the transaction — never from
 * the caller. The difference is worked out there too, from the balance at that moment less
 * what has moved since the count day: counted − (balance now − movements after the day).
 * The movements after the day need a query, which a transaction cannot make, so `prepare`
 * reads them with the location's balances just before; if any balance in the part has moved
 * since, the part is refused with BOOKS_MOVED and the caller reads again and retries.
 */

/** The refusal that means "read the books again and retry", not "this cannot be done". */
export const BOOKS_MOVED = 'มีการบันทึกสต๊อกของคลังนี้ระหว่างยืนยัน กำลังอ่านยอดใหม่' // i18n-key

/**
 * A big difference (over 10% of the books or 500 baht) is not filed until a manager says
 * they looked at it (plan E2): the post is refused with this, the screen lists the big
 * lines, and the manager confirms with `approveBig`. Who approved is kept on each result.
 */
export const BIG_NEEDS_APPROVAL = 'มีผลต่างมาก {n} รายการ — ตรวจและอนุมัติผลต่างก่อนปรับสต๊อก' // i18n-key

export interface PostCountParams {
  id: string
  /** The manager has looked at the big differences and approves filing them (plan E2). */
  approveBig?: boolean
  /** The counted products this part settles. */
  productIds: string[]
  note: string
  reason: 'count' | 'opening'
}

export interface PostCountContext {
  levels: Record<string, number>
  later: StockMovement[]
}

const MANAGERS: readonly Role[] = ['manager', 'admin']

export const postCountCommand = defineCommand<PostCountParams, string | null, PostCountContext>({
  name: 'postCount',
  roles: MANAGERS,
  writes: { stockMovements: ['set'], stockLevels: ['set'], counters: ['set'], monthlyCounts: ['update'] },
  parse(raw): PostCountParams {
    const p = obj(raw)
    only(p, ['id', 'productIds', 'note', 'reason', 'approveBig'])
    if (p.reason !== 'count' && p.reason !== 'opening') throw new BadInput('reason')
    if (p.approveBig !== undefined && typeof p.approveBig !== 'boolean') throw new BadInput('approveBig')
    const productIds = Array.isArray(p.productIds) && p.productIds.length === 0 ? [] : list(p.productIds, 'productIds', (x) => idOf(x, 'productId'))
    return { id: idOf(p.id, 'id'), productIds, note: text(p.note, 'note', 500), reason: p.reason, ...(p.approveBig ? { approveBig: true } : {}) }
  },
  async prepare(read, p) {
    const sheet = await read.get<MonthlyCount>(COL.monthlyCounts, p.id)
    if (!sheet) throw new AppError('ไม่พบใบนับนี้')
    const after = sheet.countDate + DAY_MS
    const levels: Record<string, number> = {}
    for (const l of await read.getBy<StockLevel & { id: string }>(COL.stockLevels, 'locationId', sheet.locationId)) levels[l.id] = l.qty
    const now = Date.now()
    const later = after <= now ? await read.getRange<StockMovement>(COL.movements, 'date', after, now + 400 * DAY_MS) : []
    return { levels, later }
  },
  async run(tx, file, p, actor, ctx) {
    const cur = await tx.get<MonthlyCount>(COL.monthlyCounts, p.id)
    if (!cur) throw new AppError('ไม่พบใบนับนี้')
    if (cur.status === 'posted') throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')
    if (cur.status !== 'counting' && cur.status !== 'recorded' && cur.status !== 'posting') throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')
    if (Object.keys(cur.questions ?? {}).length) throw new AppError('ยังมีคำถามจากไฟล์ที่ยังไม่ได้ตอบ — ตอบให้ครบก่อนยืนยัน')
    const done = new Set(cur.postedIds ?? [])
    // Only products counted on this sheet, not yet settled.
    const todo = p.productIds.filter((pid) => !done.has(pid) && cur.lines[pid])
    const after = cur.countDate + DAY_MS

    const balances = await Promise.all(todo.map((pid) => tx.get<StockLevel>(COL.stockLevels, levelId(cur.locationId, pid))))
    const products = await Promise.all(todo.map((pid) => tx.get<Product>(COL.products, pid)))
    const results: Record<string, MonthlyCountResult> = {}
    const lines: { productId: string; productName: string; unit: string; diff: number }[] = []
    let big = 0
    todo.forEach((pid, k) => {
      const qty = balances[k]?.qty ?? 0
      if (roundQty(qty) !== roundQty(ctx.levels[levelId(cur.locationId, pid)] ?? 0)) throw new AppError(BOOKS_MOVED)
      const book = balanceAtDayEnd(qty, ctx.later, { productId: pid, locationId: cur.locationId }, after)
      const counted = cur.lines[pid].qty
      const diff = roundQty(counted - book)
      const product = products[k]
      const value = Math.round(diff * (product?.cost ?? 0) * 100) / 100
      results[pid] = { systemQty: book, countedQty: counted, diff, value }
      // The opening count sets the books: its differences are the trial period's, not losses.
      if (p.reason === 'count' && isBig(book, diff, value)) {
        big++
        if (p.approveBig) results[pid].bigApprovedBy = actor.name
      }
      if (diff !== 0) lines.push({ productId: pid, productName: product?.name ?? pid, unit: product?.unitType ?? '', diff })
    })

    if (big > 0 && !p.approveBig) throw new AppError(BIG_NEEDS_APPROVAL, { n: big })

    let filed: string | null = null
    if (lines.length > 0) {
      const planned = await planAdjust(
        tx,
        {
          locationId: cur.locationId,
          date: cur.countDate,
          actor,
          note: p.note,
          lines: lines.map((a) => ({
            productId: a.productId,
            productName: a.productName,
            unit: a.unit,
            qty: Math.abs(a.diff),
            direction: a.diff > 0 ? ('in' as const) : ('out' as const),
            reason: p.reason,
          })),
        },
        file,
      )
      filed = planned.commit()
    }
    const postedIds = [...done, ...todo]
    const settled = new Set(postedIds)
    const last = Object.keys(cur.lines).every((pid) => settled.has(pid))
    const at = Date.now()
    tx.update(COL.monthlyCounts, p.id, {
      status: last ? 'posted' : 'posting',
      results: { ...(cur.results ?? {}), ...results },
      postedIds,
      adjDocNos: [...(cur.adjDocNos ?? []), ...(filed ? [filed] : [])],
      confirmedBy: actor.id,
      confirmedByName: actor.name,
      confirmedAt: at,
      updatedAt: at,
    })
    return filed
  },
})
