import type { SupplierStats } from './supplierPerformance'

/**
 * The Supplier Score (0–100) and its grade — deterministic and explainable (Supplier
 * Intelligence S2, 5 Oct 2026). No model, no LLM: each component is a 0–100 sub-score,
 * weighted, summed. The breakdown it returns is the answer to "why is this supplier 82?".
 *
 * Every knob is in SUPPLIER_SCORE_CONFIG and nowhere else — the screens read weights and
 * thresholds from here, so changing a weight is a one-line change (and later a setting).
 */

export interface ScoreConfig {
  version: number
  weights: {
    onTime: number
    fill: number
    delaySeverity: number
    acceptance: number
    response: number
    reliability: number
  }
  /** Mean days late over every dated delivery at which the severity sub-score reaches 0. */
  delaySeverityWorstDays: number
  /** Response at or under `goodMinutes` scores 100, at or over `badMinutes` scores 0. */
  response: { goodMinutes: number; badMinutes: number }
  /** Lower bounds, best first. */
  grades: { min: number; grade: Grade }[]
  /** Delivered orders needed for each confidence level. */
  confidence: { low: number; medium: number; high: number }
  trendMinSample: number
  /** A change in on-time rate smaller than this reads as flat. */
  trendFlatBand: number
}

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'

export const SUPPLIER_SCORE_CONFIG: ScoreConfig = {
  version: 1,
  weights: { onTime: 40, fill: 20, delaySeverity: 15, acceptance: 10, response: 10, reliability: 5 },
  delaySeverityWorstDays: 3,
  response: { goodMinutes: 60, badMinutes: 24 * 60 },
  grades: [
    { min: 95, grade: 'A+' },
    { min: 90, grade: 'A' },
    { min: 80, grade: 'B' },
    { min: 70, grade: 'C' },
    { min: 60, grade: 'D' },
    { min: 0, grade: 'F' },
  ],
  confidence: { low: 5, medium: 20, high: 50 },
  trendMinSample: 5,
  trendFlatBand: 0.05,
}

export type ScoreComponentKey = keyof ScoreConfig['weights']

export interface ScoreComponent {
  key: ScoreComponentKey
  /** Configured weight (of 100). */
  weight: number
  /** Weight after missing components were dropped and the rest scaled back to 100. */
  effectiveWeight: number
  /** 0–100, or null when there is no data for it. */
  value: number | null
  /** value × effectiveWeight ÷ 100 — this component's share of the score. */
  points: number
  /** The input it came from, for the breakdown: "18 of 20 on time". */
  basis: { hits?: number; n?: number; raw?: number | null }
}

export interface SupplierScore {
  version: number
  score: number | null
  /** Null below the minimum sample: a grade from three orders is not a grade. */
  grade: Grade | null
  components: ScoreComponent[]
}

export function gradeFor(score: number, cfg: ScoreConfig = SUPPLIER_SCORE_CONFIG): Grade {
  return (cfg.grades.find((g) => score >= g.min) ?? cfg.grades[cfg.grades.length - 1]).grade
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

export function supplierScore(s: SupplierStats, cfg: ScoreConfig = SUPPLIER_SCORE_CONFIG): SupplierScore {
  const pct = (r: number | null) => (r === null ? null : clamp(r * 100))
  const raw: { key: ScoreComponentKey; value: number | null; basis: ScoreComponent['basis'] }[] = [
    { key: 'onTime', value: pct(s.onTime.rate), basis: { hits: s.onTime.hits, n: s.onTime.n } },
    { key: 'fill', value: pct(s.fill.rate), basis: { raw: s.fill.rate } },
    {
      key: 'delaySeverity',
      value: s.delay.meanOverAll === null ? null : clamp(100 * (1 - s.delay.meanOverAll / cfg.delaySeverityWorstDays)),
      basis: { raw: s.delay.meanOverAll },
    },
    {
      key: 'acceptance',
      value: pct(s.requestedAcceptance.rate),
      basis: { hits: s.requestedAcceptance.hits, n: s.requestedAcceptance.n },
    },
    {
      key: 'response',
      value:
        s.response.avgMinutes === null
          ? null
          : clamp(
              100 *
                (1 -
                  (s.response.avgMinutes - cfg.response.goodMinutes) / (cfg.response.badMinutes - cfg.response.goodMinutes)),
            ),
      basis: { n: s.response.n, raw: s.response.avgMinutes },
    },
    {
      key: 'reliability',
      value: s.cancellation.rate === null ? null : clamp(100 * (1 - s.cancellation.rate)),
      basis: { hits: s.cancellation.hits, n: s.cancellation.n },
    },
  ]
  const present = raw.filter((c) => c.value !== null).reduce((sum, c) => sum + cfg.weights[c.key], 0)
  const components: ScoreComponent[] = raw.map((c) => {
    const weight = cfg.weights[c.key]
    const effectiveWeight = c.value === null || present === 0 ? 0 : (weight * 100) / present
    return { key: c.key, weight, effectiveWeight, value: c.value, points: c.value === null ? 0 : (c.value * effectiveWeight) / 100, basis: c.basis }
  })
  // Nothing delivered yet means no delivery evidence at all: no score, whatever else exists.
  const score = present === 0 || s.delivered === 0 ? null : Math.round(components.reduce((sum, c) => sum + c.points, 0) * 10) / 10
  return {
    version: cfg.version,
    score,
    grade: score === null || s.confidence === 'insufficient' ? null : gradeFor(score, cfg),
    components,
  }
}
