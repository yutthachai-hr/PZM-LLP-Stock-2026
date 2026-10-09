/**
 * Phase G — PZM Operations Intelligence: what every result carries.
 *
 * READ / ANALYZE / RECOMMEND only. Nothing under src/intel writes to the database, places
 * an order, moves stock or sends a message — tests/suggest-only.test.ts holds that. Every
 * result says which engine made it, when, from data as of when, why (reasons with their
 * figures), and how much the evidence can bear (dataConfidence). "No reliable
 * recommendation" is a valid answer and is given whenever the evidence is too thin.
 */

export const INTEL_VERSIONS = {
  supplier: 'supplier-1',
  delivery: 'delivery-rules-1',
  stockout: 'stockout-1',
  transfer: 'transfer-1',
  purchase: 'purchase-1',
  alternate: 'alternate-1',
  anomaly: 'anomaly-1',
} as const

export type IntelEngine = keyof typeof INTEL_VERSIONS

/** How much the evidence behind a result can bear. `insufficient` = do not recommend. */
export type DataConfidence = 'high' | 'medium' | 'low' | 'insufficient'

/** A gap in the evidence, named so the screen can say what is missing. */
export type DataNote =
  | 'thinSupplierHistory'
  | 'noSupplierHistory'
  | 'noUsageHistory'
  | 'shortUsageHistory'
  | 'unknownUnit'
  | 'staleBalance'
  | 'missingIncomingDate'
  | 'noPrice'
  | 'noSafetyLevel'
  | 'unknownLeadTime'

/** One step of WHY: a code the screen words, its figures, and its weight where it has one. */
export interface Reason {
  code: string
  params: Record<string, string | number>
  /** Points added to a score, when the result is a score. */
  points?: number
}

export interface IntelMeta {
  engine: IntelEngine
  engineVersion: string
  calculatedAt: number
  /** The newest fact the inputs could hold — `now` live, the decision point in a backtest. */
  inputsAsOf: number
  dataConfidence: DataConfidence
  dataNotes: DataNote[]
}

export function meta(engine: IntelEngine, at: { now: number; asOf?: number }, notes: DataNote[], confidence?: DataConfidence): IntelMeta {
  const uniq = [...new Set(notes)]
  return {
    engine,
    engineVersion: INTEL_VERSIONS[engine],
    calculatedAt: at.now,
    inputsAsOf: at.asOf ?? at.now,
    dataConfidence: confidence ?? confidenceFromNotes(uniq),
    dataNotes: uniq,
  }
}

/** The default reading of the gaps: any blocking gap = insufficient; soft gaps step down. */
const BLOCKING: readonly DataNote[] = ['noSupplierHistory', 'noUsageHistory', 'unknownUnit']
export function confidenceFromNotes(notes: readonly DataNote[]): DataConfidence {
  if (notes.some((n) => BLOCKING.includes(n))) return 'insufficient'
  if (notes.length >= 2) return 'low'
  if (notes.length === 1) return 'medium'
  return 'high'
}

/** The weaker of two confidences — a chain is as strong as its weakest input. */
export function weaker(a: DataConfidence, b: DataConfidence): DataConfidence {
  const rank: Record<DataConfidence, number> = { insufficient: 0, low: 1, medium: 2, high: 3 }
  return rank[a] <= rank[b] ? a : b
}

/** Heuristic scores are scores, not probabilities: "HIGH · 72/100", never "72%". */
export function scoreLabel(level: string, score: number): string {
  return `${level} · ${Math.round(score)}/100`
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000
