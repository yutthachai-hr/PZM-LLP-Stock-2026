/**
 * Ask PZM — one question in, one read-only answer out.
 *
 *   text → GUARD (DENY is final) → keyword router → [models, only if the router is unsure] → answer()
 *
 * Models only ROUTE: they pick an intent label, and only when the deterministic router could not.
 * They never see data, never produce a figure, and can only make the outcome stricter:
 *  - a guard DENY returns before any model is called;
 *  - a model saying `write_request` refuses (it can add a refusal, never remove one);
 *  - two models that disagree ask the person instead of picking one.
 * With every model stopped (clients = []), the router + clarify path still answers (tests).
 */
import { answer, type Answer, type AskSnapshot } from './answer'
import { guard, keywordRoute } from './guard'
import type { IntentClient } from './clients'
import type { AskIntent, IntentVerdict } from './intents'

export interface AskConfig {
  /** Run the deterministic guard first. Off only to MEASURE raw models (arms B–D); never in use. */
  guard: boolean
  /** Use the keyword router; models are consulted only when it is unsure. */
  router: boolean
  /** Consulted in order when needed. With 2+, all must agree (abstentions excepted, at least one answer). */
  models: IntentClient[]
}

export interface AskResult {
  answer: Answer
  intent: AskIntent | null
  decidedBy: 'guard' | 'router' | 'models' | 'none'
  verdicts: IntentVerdict[]
  guardRule?: string
  ms: number
}

export async function askPzm(text: string, snap: AskSnapshot, cfg: AskConfig, clock: () => number = () => performance.now()): Promise<AskResult> {
  const t0 = clock()
  const done = (r: Omit<AskResult, 'ms'>): AskResult => ({ ...r, ms: clock() - t0 })
  if (cfg.guard) {
    const g = guard(text)
    if (g.decision === 'DENY') return done({ answer: { kind: 'REFUSE', reason: g.reason, text: g.reason === 'WRITE' ? answer('write_request', text, snap).text : 'คำขอนี้มีคำสั่งถึงผู้ช่วยเอง — ไม่ดำเนินการ' }, intent: null, decidedBy: 'guard', verdicts: [], guardRule: g.rule })
  }
  if (cfg.router) {
    const r = keywordRoute(text)
    if (r.intent) return done({ answer: answer(r.intent, text, snap), intent: r.intent, decidedBy: 'router', verdicts: [] })
  }
  const verdicts: IntentVerdict[] = []
  for (const m of cfg.models) verdicts.push(await m.classify(text))
  const said = verdicts.filter((v) => v.intent !== null).map((v) => v.intent as AskIntent)
  if (said.includes('write_request')) return done({ answer: answer('write_request', text, snap), intent: 'write_request', decidedBy: 'models', verdicts })
  const agreed = said.length > 0 && said.every((x) => x === said[0]) ? said[0] : null
  if (agreed && (cfg.models.length < 2 || said.length === cfg.models.length)) return done({ answer: answer(agreed, text, snap), intent: agreed, decidedBy: 'models', verdicts })
  return done({ answer: { kind: 'CLARIFY', intent: null, text: 'ไม่แน่ใจว่าถามเรื่องไหน — สต๊อก, ใบสั่งซื้อที่รอยืนยัน, ของเสี่ยงหมด หรือใบโอน?' }, intent: null, decidedBy: cfg.models.length ? 'models' : 'none', verdicts })
}
