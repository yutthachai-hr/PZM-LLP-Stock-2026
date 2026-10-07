/**
 * G17 — confidence calibration on PZM data. Upstream thresholds are not copied: a threshold
 * is chosen only from this benchmark, and only when the evidence supports it.
 */

export interface Point {
  confidence: number
  correct: boolean
}

export interface Bin {
  lo: number
  hi: number
  count: number
  meanConfidence: number
  accuracy: number
}

/** Equal-width bins over [0, 1]; the last bin includes 1. */
export function reliability(points: readonly Point[], bins = 10): Bin[] {
  const out: Bin[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, count: 0, meanConfidence: 0, accuracy: 0 }))
  for (const p of points) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(p.confidence * bins)))
    const b = out[i]
    b.meanConfidence += p.confidence
    b.accuracy += p.correct ? 1 : 0
    b.count++
  }
  for (const b of out) {
    if (!b.count) continue
    b.meanConfidence = round4(b.meanConfidence / b.count)
    b.accuracy = round4(b.accuracy / b.count)
  }
  return out
}

/** Expected calibration error: the count-weighted gap between confidence and accuracy. */
export function ece(points: readonly Point[], bins = 10): number {
  if (!points.length) return 0
  return round4(reliability(points, bins).reduce((s, b) => s + (b.count / points.length) * Math.abs(b.accuracy - b.meanConfidence), 0))
}

/** Wilson score lower bound (95%) for k successes in n. */
export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n === 0) return 0
  const p = k / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return round4((c - m) / d)
}

export interface ThresholdChoice {
  threshold: number | null
  /** Answers at or above the threshold, how many were right, and the conservative bound. */
  covered: number
  correct: number
  wilsonLower: number
  why: string
}

/**
 * The lowest confidence above which answers are right often enough — judged by the Wilson
 * lower bound, not the raw rate, so a handful of lucky answers cannot set a threshold.
 * Returns null when no threshold meets the target with at least `minSupport` answers.
 */
export function chooseThreshold(points: readonly Point[], target = 0.99, minSupport = 50): ThresholdChoice {
  const sorted = [...points].sort((a, b) => b.confidence - a.confidence)
  let best: ThresholdChoice = { threshold: null, covered: 0, correct: 0, wilsonLower: 0, why: `no threshold reaches a ${target} lower bound with ≥${minSupport} answers` }
  let k = 0
  for (let i = 0; i < sorted.length; i++) {
    k += sorted[i].correct ? 1 : 0
    const n = i + 1
    // Only cut between distinct confidences.
    if (i + 1 < sorted.length && sorted[i + 1].confidence === sorted[i].confidence) continue
    const lb = wilsonLower(k, n)
    if (n >= minSupport && lb >= target) best = { threshold: sorted[i].confidence, covered: n, correct: k, wilsonLower: lb, why: `lowest confidence whose ≥ set has Wilson lower bound ≥ ${target}` }
  }
  return best
}

/** Accuracy per confidence bucket, for the report table. */
export function accuracyByBucket(points: readonly Point[], edges: readonly number[] = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0001]): { from: number; to: number; count: number; accuracy: number }[] {
  const out = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const inBin = points.filter((p) => p.confidence >= edges[i] && p.confidence < edges[i + 1])
    out.push({ from: edges[i], to: Math.min(1, edges[i + 1]), count: inBin.length, accuracy: inBin.length ? round4(inBin.filter((p) => p.correct).length / inBin.length) : 0 })
  }
  return out
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}
