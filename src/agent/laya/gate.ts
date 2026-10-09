/**
 * G17 — `pzm-laya-gate`: the one boundary between PZM and a System-1 model.
 *
 * The model sits behind `LayaClient`. This file never reaches the network itself (src/agent is
 * pure; tests/agent-no-write-path); a transport — an HTTP client to a local service, a
 * subprocess, a test double — is passed in. Nothing in the app imports this module, so the app
 * runs exactly the same when no model exists (tests/agent-laya.test.ts checks that statically).
 *
 * Every way a call can go wrong ends in the same place: `{ ok: false, reason }`. The caller's
 * policy (policy.ts) then fails safe. The gate never retries into a write and never guesses.
 */
import { parseAnswers, type LayaAnswers, type LayaRequest } from './questions'

export interface ModelInfo {
  /** e.g. 'laya' — or 'keyword-baseline' for the in-repo reference arm. */
  name: string
  /** The checkpoint or build this answer came from; recorded on every decision. */
  checkpoint: string
}

export interface LayaClient {
  info: ModelInfo
  /** Resolve with the model's raw answer object. Throwing or hanging is handled by the gate. */
  ask(req: LayaRequest): Promise<unknown>
}

export type GateFailure = 'UNAVAILABLE' | 'TIMEOUT' | 'ERROR' | 'MALFORMED'

export type GateResult =
  | { ok: true; answers: LayaAnswers; model: ModelInfo; latencyMs: number }
  | { ok: false; reason: GateFailure; model: ModelInfo | null; latencyMs: number; detail?: string }

export interface GateOptions {
  timeoutMs: number
  /** Injected so tests and benchmarks control time. */
  clock?: () => number
}

export const DEFAULT_GATE: GateOptions = { timeoutMs: 300 }

const TIMEOUT = Symbol('timeout')

export async function askLaya(client: LayaClient | null, req: LayaRequest, opts: GateOptions = DEFAULT_GATE): Promise<GateResult> {
  const clock = opts.clock ?? (() => performance.now())
  const t0 = clock()
  if (!client) return { ok: false, reason: 'UNAVAILABLE', model: null, latencyMs: 0 }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const raw = await Promise.race([
      client.ask(req),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), opts.timeoutMs)
      }),
    ])
    const latencyMs = clock() - t0
    if (raw === TIMEOUT) return { ok: false, reason: 'TIMEOUT', model: client.info, latencyMs }
    const answers = parseAnswers(raw)
    if (!answers) return { ok: false, reason: 'MALFORMED', model: client.info, latencyMs }
    return { ok: true, answers, model: client.info, latencyMs }
  } catch (e) {
    return { ok: false, reason: 'ERROR', model: client.info, latencyMs: clock() - t0, detail: e instanceof Error ? e.message.slice(0, 200) : 'error' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The client for "no model deployed": every call is UNAVAILABLE. */
export const OFFLINE: LayaClient | null = null
