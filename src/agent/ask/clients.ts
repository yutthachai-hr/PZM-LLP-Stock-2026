/**
 * Step 5 — the three model clients Ask PZM can route with. Each turns one message into an
 * IntentVerdict over the closed ASK_INTENTS set, or an abstention.
 *
 *  - LayaPythonClient       laya 0.4.0 `POST /v1/systemone` (Jev-shaped), English checkpoint
 *  - ReflexModellessClient  gist-rs/reflex `POST /decide`, modelless lane over the PZM rulebook
 *  - ReflexLayaRustClient   gist-rs/reflex `POST /decide` with `X-Reflex-Lane: laya` (native Rust port)
 *
 * src/agent never touches the network (tests/agent-no-write-path): the HTTP call is an injected
 * `Transport`. The runner (stack/scripts) or a future gateway supplies it, pointed at loopback.
 * Every failure — no transport, timeout, non-200, a body off the wire contract — is an abstention
 * with the reason recorded. Nothing is retried; nothing is guessed.
 */
import { abstain, ASK_INTENTS, INTENT_CRITERIA, type AskIntent, type IntentVerdict } from './intents'

export interface TransportResponse {
  status: number
  body: unknown
}
/** POST JSON; must reject or resolve within `timeoutMs` (the client also races its own timer). */
export type Transport = (url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) => Promise<TransportResponse>

export interface IntentClient {
  readonly name: string
  classify(text: string): Promise<IntentVerdict>
}

export interface ClientOptions {
  baseUrl: string
  transport: Transport | null
  timeoutMs?: number
  /** Below this a Laya answer is treated as an abstention. Reflex abstains on its own gates. */
  minConfidence?: number
  apiKey?: string
  clock?: () => number
}

const isProb = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

async function call(o: ClientOptions, path: string, body: unknown, headers: Record<string, string>, model: string): Promise<{ ok: true; body: unknown; ms: number } | { ok: false; verdict: IntentVerdict }> {
  const clock = o.clock ?? (() => performance.now())
  const t0 = clock()
  if (!o.transport) return { ok: false, verdict: abstain(model, 0, 'UNAVAILABLE') }
  const timeoutMs = o.timeoutMs ?? 2000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const r = await Promise.race([
      o.transport(o.baseUrl + path, body, headers, timeoutMs),
      new Promise<'timeout'>((res) => (timer = setTimeout(() => res('timeout'), timeoutMs))),
    ])
    const ms = clock() - t0
    if (r === 'timeout') return { ok: false, verdict: abstain(model, ms, 'TIMEOUT') }
    if (r.status !== 200) return { ok: false, verdict: abstain(model, ms, 'HTTP') }
    return { ok: true, body: r.body, ms }
  } catch {
    return { ok: false, verdict: abstain(model, clock() - t0, 'UNAVAILABLE') }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- Laya (Python) ----

export const LAYA_QUESTIONS = {
  intent: { type: 'choice', instructions: 'Which operations request is this message?', criteria: INTENT_CRITERIA },
} as const

/** Strict read of a laya `/v1/systemone` answer for the `intent` question. Null = off-contract. */
export function readLaya(body: unknown): { intent: AskIntent; confidence: number; probabilities: number[]; checkpoint: string } | null {
  const b = body as { answers?: { intent?: { type?: string; choice?: unknown; probabilities?: Record<string, unknown>; answer_confidence?: unknown } }; routing?: { model?: unknown } }
  const a = b?.answers?.intent
  if (!a || a.type !== 'choice' || !ASK_INTENTS.includes(a.choice as AskIntent) || !isProb(a.answer_confidence)) return null
  const p = a.probabilities
  if (!p || typeof p !== 'object') return null
  const probabilities = ASK_INTENTS.map((k) => p[k])
  if (!probabilities.every(isProb) || Object.keys(p).length !== ASK_INTENTS.length) return null
  if (typeof b.routing?.model !== 'string') return null
  return { intent: a.choice as AskIntent, confidence: a.answer_confidence, probabilities: probabilities as number[], checkpoint: b.routing.model }
}

export class LayaPythonClient implements IntentClient {
  readonly name = 'laya-python'
  private o: ClientOptions
  constructor(o: ClientOptions) {
    this.o = o
  }
  async classify(text: string): Promise<IntentVerdict> {
    const model = 'laya-python/english'
    // `model: "english"`: the owner's checkpoint, never the multilingual auto-route.
    // State as the plain string: the exact input the Rust lane receives (Step 4 parity).
    const r = await call(this.o, '/v1/systemone', { state: text, model: 'english', questions: LAYA_QUESTIONS }, this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}, model)
    if (!r.ok) return r.verdict
    const a = readLaya(r.body)
    if (!a) return abstain(model, r.ms, 'MALFORMED')
    if (a.checkpoint !== 'english') return abstain(model, r.ms, 'MALFORMED') // served by another checkpoint: refuse it
    const sure = a.confidence >= (this.o.minConfidence ?? 0)
    return { intent: sure ? a.intent : null, confidence: a.confidence, probabilities: a.probabilities, latencyMs: r.ms, model }
  }
}

// ---------------------------------------------------------------- Reflex (both lanes) ----

/** The katgpt-rs decision wire: options ARE the rulebook's domain names, so they route by name. */
export const reflexRequest = (text: string, withCriteria = false) => ({
  state: text,
  // The laya lane gets Laya's own criteria object (as the wire's JSON string), so the Rust port
  // and laya-python see byte-identical questions; the modelless lane routes by option NAME.
  questions: [{ id: 'intent', kind: 'choice', prompt: LAYA_QUESTIONS.intent.instructions, options: [...ASK_INTENTS], criteria: withCriteria ? JSON.stringify(INTENT_CRITERIA) : null }],
})

/** decision_wire.rs validate_against for the one-question request; null = off-contract. */
export function readReflex(body: unknown): { index: number | null; confidence: number; probabilities: number[]; lane: string } | null {
  const b = body as { answers?: { question_id?: unknown; outcome?: { choice?: { index?: unknown } } | null; probabilities?: unknown; confidence?: unknown }[]; routing?: { lane?: unknown } }
  if (!Array.isArray(b?.answers) || b.answers.length !== 1) return null
  const a = b.answers[0]
  if (a.question_id !== 'intent' || !isProb(a.confidence) || typeof b.routing?.lane !== 'string') return null
  const probs = Array.isArray(a.probabilities) ? a.probabilities : null
  let index: number | null = null
  if (a.outcome !== null && a.outcome !== undefined) {
    const i = a.outcome.choice?.index
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= ASK_INTENTS.length) return null
    index = i
    if (!probs || probs.length !== ASK_INTENTS.length) return null
  }
  if (probs && (probs.length !== ASK_INTENTS.length || !probs.every(isProb))) return null
  return { index, confidence: a.confidence, probabilities: (probs as number[]) ?? [], lane: b.routing.lane }
}

class ReflexClient implements IntentClient {
  readonly name: string
  private lane: 'modelless' | 'laya'
  private o: ClientOptions
  constructor(name: string, lane: 'modelless' | 'laya', o: ClientOptions) {
    this.name = name
    this.lane = lane
    this.o = o
  }
  async classify(text: string): Promise<IntentVerdict> {
    const r = await call(this.o, '/decide', reflexRequest(text, this.lane === 'laya'), { 'x-reflex-lane': this.lane }, this.name)
    if (!r.ok) return r.verdict
    const a = readReflex(r.body)
    if (!a || a.lane !== this.lane) return abstain(this.name, r.ms, 'MALFORMED')
    // Laya lane: threshold on the chosen option's probability, the same readout laya-python's
    // `answer_confidence` is, so B and D are comparable. Modelless: the engine's own readout.
    const confidence = this.lane === 'laya' && a.index !== null ? a.probabilities[a.index] : a.confidence
    const sure = a.index !== null && confidence >= (this.o.minConfidence ?? 0)
    return { intent: sure ? ASK_INTENTS[a.index!] : null, confidence, probabilities: a.probabilities.length ? a.probabilities : null, latencyMs: r.ms, model: this.name }
  }
}

export class ReflexModellessClient extends ReflexClient {
  constructor(o: ClientOptions) {
    super('reflex-modelless/pzm-rulebook', 'modelless', o)
  }
}

export class ReflexLayaRustClient extends ReflexClient {
  constructor(o: ClientOptions) {
    super('reflex-laya-rust/english', 'laya', o)
  }
}
