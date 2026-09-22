/**
 * The "ข้อมูลเชิงลึก" card on the reports overview (spec §2.8): four sentences, each one a
 * figure the report already worked out, never an opinion.
 *
 * Returned as kinds with their numbers rather than as text, so the screen translates them
 * and this file stays pure. A figure that cannot be compared (the earlier period is outside
 * the loaded ledger) produces no sentence rather than a guess. Tests: tests/insights.test.ts.
 */
export type Insight =
  | { kind: 'receiptsUp' | 'receiptsDown'; pct: number }
  | { kind: 'receiptsFlat' }
  | { kind: 'topIssue'; name: string; pct: number }
  | { kind: 'valueUp' | 'valueDown'; pct: number }
  | { kind: 'valueFlat' }
  | { kind: 'lowStock'; count: number }
  | { kind: 'allStocked' }

export interface InsightInput {
  receiptsNow: number
  /** Null when the period before is not in the loaded ledger. */
  receiptsBefore: number | null
  /** What was used, per product, over the period — value if costs are known, else lines. */
  issued: { name: string; amount: number }[]
  valueNow: number
  /** Stock value at the start of the period; null when it cannot be worked out. */
  valueBefore: number | null
  lowCount: number
}

function pct(now: number, before: number): number {
  return Math.round((Math.abs(now - before) / Math.abs(before)) * 1000) / 10
}

export function insights(x: InsightInput): Insight[] {
  const out: Insight[] = []

  if (x.receiptsBefore !== null) {
    if (x.receiptsBefore === 0 || x.receiptsNow === x.receiptsBefore) {
      if (x.receiptsNow === x.receiptsBefore) out.push({ kind: 'receiptsFlat' })
    } else {
      out.push({ kind: x.receiptsNow > x.receiptsBefore ? 'receiptsUp' : 'receiptsDown', pct: pct(x.receiptsNow, x.receiptsBefore) })
    }
  }

  const total = x.issued.reduce((s, i) => s + i.amount, 0)
  if (total > 0) {
    const top = x.issued.reduce((a, b) => (b.amount > a.amount ? b : a))
    out.push({ kind: 'topIssue', name: top.name, pct: Math.round((top.amount / total) * 1000) / 10 })
  }

  if (x.valueBefore !== null && x.valueBefore > 0) {
    if (x.valueNow === x.valueBefore) out.push({ kind: 'valueFlat' })
    else out.push({ kind: x.valueNow > x.valueBefore ? 'valueUp' : 'valueDown', pct: pct(x.valueNow, x.valueBefore) })
  }

  out.push(x.lowCount > 0 ? { kind: 'lowStock', count: x.lowCount } : { kind: 'allStocked' })
  return out
}
