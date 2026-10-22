// Browser-free adjustment planner. Browser adjustments, monthly counts, transfer settlement and the
// trusted server stock command (functions/_lib/stockCommand.ts) all file adjustments through it.
import type { TxContext } from '../backend/tx'
import { AppError } from '../i18n/AppError'
import { ADJUST_REASONS, COL, type StockLevel, type StockMovement } from '../types'
import { levelRef } from '../lib/levelKey'
import { requireEpochMs, requireId, requireOneOf, roundQty } from '../lib/validate'
import { keyedFields, mergeLines, requireMasterData, type MovementLine } from './receivePlan'
import { levelDoc, makeDocNo, shortMessage } from './movementDoc'

interface Actor {
  id: string
  name: string
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
