/**
 * G17 — benchmark arms A–G on the G15/G16 proposals, with adapter slots for components that
 * are not here yet. An arm whose component is missing is NOT_RUN with the reason — never
 * scored, never estimated.
 *
 * Every arm starts from the deterministic guard, and every later stage is folded in with
 * `combine`, so no arm can be looser than A by construction. What the benchmark measures is
 * whether a stage adds anything: catches the guard missed, or false rejects it adds.
 */
import { combine, guard, type GuardResult, type ModelVerdict } from '../guard'
import type { Arm } from '../safety/bench'
import type { GuardSnapshot } from '../snapshot'
import type { ModelInfo } from './gate'

/** A safety reviewer (KatGPT-rs, Reflex/Jev, or Laya in reviewer mode) judging a proposal the guard has seen. */
export interface SafetyReviewer {
  info: ModelInfo
  /** Synchronous for the benchmark harness; a service adapter blocks or precomputes. Throwing = ABSTAIN. */
  review(proposal: unknown, guardResult: GuardResult, snap: GuardSnapshot): ModelVerdict
}

export type Component = 'laya' | 'kat' | 'reflex'

export interface ArmSpec {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  name: string
  stages: Component[]
}

export const ARMS: readonly ArmSpec[] = [
  { id: 'A', name: 'Business Guard only', stages: [] },
  { id: 'B', name: 'Guard + Laya', stages: ['laya'] },
  { id: 'C', name: 'Guard + KatGPT-rs', stages: ['kat'] },
  { id: 'D', name: 'Guard + Reflex/Jev', stages: ['reflex'] },
  { id: 'E', name: 'Guard + Laya → KatGPT-rs', stages: ['laya', 'kat'] },
  { id: 'F', name: 'Guard + Laya → Reflex', stages: ['laya', 'reflex'] },
  { id: 'G', name: 'Guard + Laya → KatGPT-rs → Reflex', stages: ['laya', 'kat', 'reflex'] },
]

export type Reviewers = Partial<Record<Component, SafetyReviewer>>

export type Built = { id: ArmSpec['id']; name: string; status: 'READY'; arm: Arm; models: ModelInfo[] } | { id: ArmSpec['id']; name: string; status: 'NOT_RUN'; missing: Component[] }

/** Build an arm if every component it needs is supplied. */
export function buildArm(spec: ArmSpec, reviewers: Reviewers): Built {
  const missing = spec.stages.filter((c) => !reviewers[c])
  if (missing.length) return { id: spec.id, name: spec.name, status: 'NOT_RUN', missing }
  const chain = spec.stages.map((c) => reviewers[c]!)
  const arm: Arm = (proposal, snap) => {
    const g = guard(proposal, snap)
    let decision = g.decision
    for (const r of chain) {
      if (decision === 'DENY') break // nothing after a DENY can change it; skip the call
      let v: ModelVerdict
      try {
        v = r.review(proposal, g, snap)
      } catch {
        v = 'ABSTAIN'
      }
      decision = combine(decision, v)
    }
    return { ...g, decision }
  }
  return { id: spec.id, name: spec.name, status: 'READY', arm, models: chain.map((r) => r.info) }
}
