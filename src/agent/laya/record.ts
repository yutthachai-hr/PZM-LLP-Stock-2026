/**
 * G17 — what is kept about every System-1 decision. No raw business text: the request text is
 * reduced to a hash (to join with a later ground-truth label) and its length.
 *
 * Pure: the caller decides where records go (a log line, a shadow collection). Writing them is
 * not this module's business — src/agent writes nothing.
 */
import { fnv1a64 } from '../proposal'
import type { GateResult } from './gate'
import type { RouteDecision } from './policy'
import { QUESTION_SCHEMA, type LayaRequest } from './questions'

export const RECORD_SCHEMA = 'laya-decision/1' as const

export interface LayaDecisionRecord {
  schema: typeof RECORD_SCHEMA
  requestId: string
  /** G18: the workflow, when the request carried one. */
  traceId?: string
  questionSchema: typeof QUESTION_SCHEMA
  model: { name: string; checkpoint: string } | null
  source: LayaRequest['source']
  textHash: string
  textLength: number
  /** null when the gate returned no answer. */
  answer: { intent: string; intentConfidence: number; injection: string; escalation: string; route: string; risk: string } | null
  failure: string | null
  latencyMs: number
  stage: RouteDecision['stage']
  escalated: boolean
  write: boolean
  /** Filled in later when the outcome is known (the person's choice, the guard's result). */
  groundTruth?: { intent?: string; route?: string; at: number }
}

export function decisionRecord(req: LayaRequest, gate: GateResult, decision: RouteDecision): LayaDecisionRecord {
  return {
    schema: RECORD_SCHEMA,
    requestId: req.requestId,
    ...(req.traceId && /^[0-9a-f]{32}$/.test(req.traceId) ? { traceId: req.traceId } : {}),
    questionSchema: req.schemaVersion,
    model: gate.model ? { name: gate.model.name, checkpoint: gate.model.checkpoint } : null,
    source: req.source,
    textHash: fnv1a64(req.text),
    textLength: req.text.length,
    answer: gate.ok
      ? { intent: gate.answers.intent.label, intentConfidence: gate.answers.intent.confidence, injection: gate.answers.injection.label, escalation: gate.answers.escalation.label, route: gate.answers.route.label, risk: gate.answers.risk.label }
      : null,
    failure: gate.ok ? null : gate.reason,
    latencyMs: Math.round(gate.latencyMs * 1000) / 1000,
    stage: decision.stage,
    escalated: decision.stage !== 'AUTO_ROUTE_READ_ONLY' && decision.stage !== 'DENY',
    write: decision.write,
  }
}
