/**
 * G17 — the typed questions a System-1 model (Laya, or any other) is asked, and the only
 * answers it may give. Closed label sets: an answer outside them is malformed, and a
 * malformed answer is treated as no answer (gate.ts).
 *
 * These are ROUTING METADATA. None of them is stock truth, authorization or a decision on a
 * write: the deterministic guard and the command layer remain the source of truth.
 */

export const QUESTION_SCHEMA = 'laya-questions/1' as const

export const INTENTS = ['READ_STOCK', 'CREATE_PR', 'CREATE_TRANSFER_DRAFT', 'RECEIVE', 'SUPPLIER_QUERY', 'EXPLAIN_RISK', 'UNKNOWN'] as const
export type Intent = (typeof INTENTS)[number]

export const RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type Risk = (typeof RISKS)[number]

export const INJECTION = ['CLEAN', 'SUSPICIOUS', 'INJECTION'] as const
export type InjectionLabel = (typeof INJECTION)[number]

export const ROUTES = ['DETERMINISTIC_ONLY', 'LOCAL_QWEN', 'STRONG_LLM', 'HUMAN'] as const
export type Route = (typeof ROUTES)[number]

export const ESCALATION = ['CLEAR', 'UNCERTAIN', 'RISKY'] as const
export type Escalation = (typeof ESCALATION)[number]

export const SLOTS = ['product', 'quantity', 'source', 'destination', 'actionClear'] as const
export type Slot = (typeof SLOTS)[number]

/** Where the text came from. Everything but `chat` is a document: untrusted data, never instructions. */
export const SOURCES = ['chat', 'line', 'ocr', 'invoice', 'supplier_note', 'document'] as const
export type TextSource = (typeof SOURCES)[number]

/** Intents that, if acted on, would change state. Their path always includes the stronger safety gate. */
export const WRITE_INTENTS: readonly Intent[] = ['CREATE_PR', 'CREATE_TRANSFER_DRAFT', 'RECEIVE']

export interface LayaQuestions {
  schemaVersion: typeof QUESTION_SCHEMA
  intent: true
  completeness: readonly Slot[]
  risk: true
  injection: true
  route: true
  escalation: true
}

export const ALL_QUESTIONS: LayaQuestions = { schemaVersion: QUESTION_SCHEMA, intent: true, completeness: SLOTS, risk: true, injection: true, route: true, escalation: true }

/** One labelled answer with its confidence in [0, 1]. */
export interface Scored<T> {
  label: T
  confidence: number
}

export interface LayaAnswers {
  intent: Scored<Intent>
  completeness: Record<Slot, Scored<boolean>>
  risk: Scored<Risk>
  injection: Scored<InjectionLabel>
  route: Scored<Route>
  escalation: Scored<Escalation>
}

/** What the gate sends: the text as DATA, its origin, and no identifiers it does not need. */
export interface LayaRequest {
  requestId: string
  schemaVersion: typeof QUESTION_SCHEMA
  /** The message or document text. Never executed; only classified. */
  text: string
  source: TextSource
  /** Optional typed context (names of known sites / units) — never balances or ids to invent from. */
  context?: { sites?: string[]; units?: string[] }
  questions: LayaQuestions
}

const isConf = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

function scored<T extends string | boolean>(v: unknown, allowed: readonly T[]): Scored<T> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (Object.keys(o).some((k) => k !== 'label' && k !== 'confidence')) return null
  if (!allowed.includes(o.label as T) || !isConf(o.confidence)) return null
  return { label: o.label as T, confidence: o.confidence }
}

/** Strict: anything off-schema makes the whole answer malformed (null). */
export function parseAnswers(raw: unknown): LayaAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const keys = ['intent', 'completeness', 'risk', 'injection', 'route', 'escalation']
  if (Object.keys(r).some((k) => !keys.includes(k))) return null
  const intent = scored(r.intent, INTENTS)
  const risk = scored(r.risk, RISKS)
  const injection = scored(r.injection, INJECTION)
  const route = scored(r.route, ROUTES)
  const escalation = scored(r.escalation, ESCALATION)
  const c = r.completeness
  if (!intent || !risk || !injection || !route || !escalation || !c || typeof c !== 'object' || Array.isArray(c)) return null
  const cr = c as Record<string, unknown>
  if (Object.keys(cr).some((k) => !(SLOTS as readonly string[]).includes(k))) return null
  const completeness = {} as Record<Slot, Scored<boolean>>
  for (const s of SLOTS) {
    const v = scored(cr[s], [true, false] as const)
    if (!v) return null
    completeness[s] = v
  }
  return { intent, completeness, risk, injection, route, escalation }
}
