// Browser-free issue planner. Browser issues, transfer dispatch/receipt and the trusted server
// transfer command (functions/_lib/stockCommand.ts) all file issues through it.
import type { TxContext } from '../backend/tx'
import { AppError } from '../i18n/AppError'
import { COL, type StockLevel, type StockMovement } from '../types'
import { levelRef } from '../lib/levelKey'
import { requireEpochMs, requireId } from '../lib/validate'
import { keyedFields, mergeLines, requireMasterData, type MovementLine } from './receivePlan'
import { levelDoc, makeDocNo, shortMessage } from './movementDoc'

interface Actor {
  id: string
  name: string
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
