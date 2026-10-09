/**
 * G17 — where a request goes next, given the deterministic guard and (optionally) Laya.
 *
 *   ActionProposal → Business Guard → Laya → next stage
 *
 * The order is the point: the guard has already ruled before Laya is consulted, and nothing
 * here can loosen it.
 *  - Guard DENY is final. No answer, label or confidence changes it.
 *  - A WRITE (anything carried by an ActionProposal, or a request whose intent is a write)
 *    keeps every mandatory stage: safety gate → human approval → refreshed guard → command
 *    layer → post-condition check. Laya may add reasons to look harder; it may not remove a
 *    stage.
 *  - Only a READ may be routed straight on, and only when Laya answers with calibrated
 *    confidence (thresholds come from the benchmark; `null` = not calibrated = never).
 *  - Laya failing — unavailable, timed out, malformed, unsure — fails safe: a read goes to
 *    the next model or a person, and a write goes down the full path it would take anyway.
 *
 * Laya's risk label is metadata. It can only send something to a person sooner; it never
 * replaces the deterministic risk figures (src/intel, src/lib/inventoryRisk.ts).
 */
import type { GuardResult } from '../guard'
import type { GateResult } from './gate'
import { WRITE_INTENTS } from './questions'

export type Stage = 'DENY' | 'AUTO_ROUTE_READ_ONLY' | 'ESCALATE_LOCAL' | 'ESCALATE_LLM' | 'ESCALATE_SAFETY_GATE' | 'ASK_HUMAN'

/** The write path, in order. A write's decision always lists all of it. */
export const MANDATORY_WRITE_PATH = ['SAFETY_GATE', 'HUMAN_APPROVAL', 'REFRESHED_GUARD', 'COMMAND_LAYER', 'POST_CONDITION'] as const

export interface Thresholds {
  /** Minimum confidence (intent, escalation and injection alike) to route a read with no model. null = never. */
  autoRouteReadOnly: number | null
  /** Below this, an answer is treated as "unsure" for every purpose. */
  minUsable: number
}

/** Until the benchmark calibrates a real model, nothing is routed automatically. */
export const UNCALIBRATED: Thresholds = { autoRouteReadOnly: null, minUsable: 1.01 }

export interface Availability {
  localModel: boolean
  strongLlm: boolean
}

export interface RouteDecision {
  stage: Stage
  /** Present for every write: the stages that must still run, none of which Laya can skip. */
  mandatory: readonly string[]
  write: boolean
  /** Laya was asked and its answer was used for routing (not merely recorded). */
  layaUsed: boolean
  reasons: string[]
}

export interface RouteInput {
  /** The guard's result when a proposal exists; null for a free-text request with no proposal yet. */
  guard: GuardResult | null
  laya: GateResult
  thresholds: Thresholds
  available: Availability
}

export function route(input: RouteInput): RouteDecision {
  const { guard, laya, thresholds: th, available } = input
  const reasons: string[] = []
  const answers = laya.ok ? laya.answers : null
  if (!laya.ok) reasons.push(`laya:${laya.reason}`)
  const usable = (c: number) => c >= th.minUsable

  // ------------------------------------------------ a proposal exists: it is a write, and the guard has ruled
  if (guard) {
    if (guard.decision === 'DENY') return { stage: 'DENY', mandatory: [], write: true, layaUsed: false, reasons: ['guard:DENY', ...reasons] }
    if (guard.decision === 'NEEDS_HUMAN') reasons.push('guard:NEEDS_HUMAN')
    if (answers) {
      if (answers.injection.label !== 'CLEAN') reasons.push(`laya:injection:${answers.injection.label}`)
      if (answers.escalation.label === 'RISKY') reasons.push('laya:risky')
      if (answers.risk.label === 'CRITICAL') reasons.push('laya:risk:CRITICAL')
    }
    // Every write takes the full path. A person sees it first when anything at all is off.
    const toHuman = guard.decision === 'NEEDS_HUMAN' || reasons.some((r) => r.startsWith('laya:injection') || r === 'laya:risky' || r === 'laya:risk:CRITICAL')
    return { stage: toHuman ? 'ASK_HUMAN' : 'ESCALATE_SAFETY_GATE', mandatory: MANDATORY_WRITE_PATH, write: true, layaUsed: !!answers && toHuman, reasons }
  }

  // ------------------------------------------------ no proposal: a request in words
  const next = (): Stage => (available.localModel ? 'ESCALATE_LOCAL' : available.strongLlm ? 'ESCALATE_LLM' : 'ASK_HUMAN')
  if (!answers) return { stage: next(), mandatory: [], write: false, layaUsed: false, reasons }

  if (answers.injection.label !== 'CLEAN') return { stage: 'ASK_HUMAN', mandatory: [], write: false, layaUsed: true, reasons: [...reasons, `laya:injection:${answers.injection.label}`] }
  if (answers.escalation.label === 'RISKY' || answers.risk.label === 'CRITICAL') return { stage: 'ASK_HUMAN', mandatory: [], write: false, layaUsed: true, reasons: [...reasons, 'laya:risky'] }

  const intentIsWrite = WRITE_INTENTS.includes(answers.intent.label)
  if (intentIsWrite) {
    // Words asking for a change become a proposal first, which then meets the guard. Never routed straight on.
    return { stage: available.strongLlm && answers.route.label === 'STRONG_LLM' ? 'ESCALATE_LLM' : next(), mandatory: MANDATORY_WRITE_PATH, write: true, layaUsed: true, reasons: [...reasons, 'laya:write-intent'] }
  }

  const auto = th.autoRouteReadOnly
  const sure = auto !== null && answers.intent.confidence >= auto && answers.escalation.confidence >= auto && answers.injection.confidence >= auto
  if (sure && answers.intent.label !== 'UNKNOWN' && answers.escalation.label === 'CLEAR' && answers.route.label === 'DETERMINISTIC_ONLY') {
    return { stage: 'AUTO_ROUTE_READ_ONLY', mandatory: [], write: false, layaUsed: true, reasons: [...reasons, 'laya:auto-read'] }
  }
  if (!usable(answers.route.confidence) || answers.escalation.label === 'UNCERTAIN') return { stage: next(), mandatory: [], write: false, layaUsed: true, reasons: [...reasons, 'laya:unsure'] }
  switch (answers.route.label) {
    case 'HUMAN':
      return { stage: 'ASK_HUMAN', mandatory: [], write: false, layaUsed: true, reasons }
    case 'STRONG_LLM':
      return { stage: available.strongLlm ? 'ESCALATE_LLM' : 'ASK_HUMAN', mandatory: [], write: false, layaUsed: true, reasons }
    default:
      return { stage: next(), mandatory: [], write: false, layaUsed: true, reasons }
  }
}
