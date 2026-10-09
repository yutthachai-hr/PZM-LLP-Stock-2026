import { LayaPythonClient, type Transport } from '../../src/agent/ask/clients'
import { abstain, type IntentVerdict } from '../../src/agent/ask/intents'

/**
 * The server's only way to a model (owner approval 5, 9 Oct 2026): the authenticated Staging AI
 * Gateway (stack/gateway), reached through a Cloudflare Tunnel protected by Cloudflare Access.
 *
 *  - Auth: an Access SERVICE TOKEN (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), held only
 *    as Pages secrets; the browser never sees it and never talks to the gateway.
 *  - Payload: the question text and nothing else — no user, no brand, no data, no ids.
 *  - Limits: per-call timeout, a per-isolate concurrency cap, and a circuit breaker that stops
 *    calling for a cool-down after consecutive failures. Every failure is an abstention, and
 *    Ask PZM answers without a model (tests: a complete AI outage changes no workflow).
 */

export interface GatewayEnv {
  AI_GATEWAY_URL?: string
  AI_GATEWAY_CLIENT_ID?: string
  AI_GATEWAY_CLIENT_SECRET?: string
}

export const GATEWAY_LIMITS = { timeoutMs: 2500, maxConcurrent: 4, failuresToOpen: 3, coolDownMs: 60_000, minConfidence: 0.8 }

export class CircuitBreaker {
  private failures = 0
  private openUntil = 0
  private inFlight = 0
  private limits: typeof GATEWAY_LIMITS
  constructor(limits = GATEWAY_LIMITS) {
    this.limits = limits
  }
  /** Null when the call may go ahead, or why it may not. */
  admit(now: number): 'OPEN' | 'BUSY' | null {
    if (now < this.openUntil) return 'OPEN'
    if (this.inFlight >= this.limits.maxConcurrent) return 'BUSY'
    this.inFlight++
    return null
  }
  done(ok: boolean, now: number) {
    this.inFlight = Math.max(0, this.inFlight - 1)
    if (ok) this.failures = 0
    else if (++this.failures >= this.limits.failuresToOpen) {
      this.openUntil = now + this.limits.coolDownMs
      this.failures = 0
    }
  }
  get state() {
    return { failures: this.failures, openUntil: this.openUntil, inFlight: this.inFlight }
  }
}

/** One breaker per isolate: shared by every request this isolate serves. */
const BREAKER = new CircuitBreaker()

export function gatewayTransport(env: Required<GatewayEnv>): Transport {
  return async (url, body, headers, timeoutMs) => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Access-Client-Id': env.AI_GATEWAY_CLIENT_ID, 'CF-Access-Client-Secret': env.AI_GATEWAY_CLIENT_SECRET, ...headers },
        body: JSON.stringify(body),
        signal: ctl.signal,
        redirect: 'manual', // an Access login redirect is a failure, not something to follow
      })
      return { status: r.status, body: r.status === 200 ? await r.json().catch(() => null) : null }
    } finally {
      clearTimeout(t)
    }
  }
}

/** The classifier Ask PZM uses, or null when no gateway is configured. */
export function gatewayClassifier(env: GatewayEnv, opts: { breaker?: CircuitBreaker; transport?: Transport; now?: () => number } = {}): ((text: string) => Promise<IntentVerdict>) | null {
  const url = (env.AI_GATEWAY_URL ?? '').trim().replace(/\/$/, '')
  if (!url || !env.AI_GATEWAY_CLIENT_ID || !env.AI_GATEWAY_CLIENT_SECRET) return null
  if (!/^https:\/\//.test(url)) return null // never plain http, never localhost from the edge
  const breaker = opts.breaker ?? BREAKER
  const now = opts.now ?? (() => Date.now())
  const client = new LayaPythonClient({
    baseUrl: `${url}/laya`,
    transport: opts.transport ?? gatewayTransport(env as Required<GatewayEnv>),
    timeoutMs: GATEWAY_LIMITS.timeoutMs,
    minConfidence: GATEWAY_LIMITS.minConfidence,
  })
  return async (text) => {
    const blocked = breaker.admit(now())
    if (blocked) return abstain(client.name, 0, 'UNAVAILABLE')
    const v = await client.classify(text)
    breaker.done(!v.failure, now())
    return v
  }
}
