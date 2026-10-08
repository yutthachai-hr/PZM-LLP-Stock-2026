/**
 * G18 — correlation ids (owner, 7 Oct 2026), shared by the app, the Pages Functions and the
 * cron Worker. Pure: Web Crypto only, no app or backend imports.
 *
 *   traceId      one workflow, end to end: a receipt from the first tap to the Supabase row
 *   requestId    one hop: a single call to the API, a single AI question
 *   operationId  one business operation, idempotent (already on stock commands and the audit log)
 *
 * Telemetry is ids, stages and outcomes — never business payloads. `traceLine` builds the one
 * structured log line everything writes, from an allow-list of keys; anything else is dropped.
 */

export const TRACE_HEADER = 'x-pzm-trace'
export const REQUEST_HEADER = 'x-pzm-request'

const TRACE_RE = /^[0-9a-f]{32}$/
const REQUEST_RE = /^[0-9a-f]{16}$/
const OPERATION_RE = /^[A-Za-z0-9_-]{6,64}$/

function hex(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export const newTraceId = () => hex(16)
export const newRequestId = () => hex(8)
export const isTraceId = (v: unknown): v is string => typeof v === 'string' && TRACE_RE.test(v)
export const isRequestId = (v: unknown): v is string => typeof v === 'string' && REQUEST_RE.test(v)
export const isOperationId = (v: unknown): v is string => typeof v === 'string' && OPERATION_RE.test(v)

export interface TraceContext {
  traceId: string
  requestId: string
  operationId?: string
  /**
   * The app build that sent the call (vite's __BUILD_ID__: a commit prefix, or "dev"). The
   * release runbook counts commands per build to see that old PWA tabs are gone before the
   * strict G25 rules go live — without a single Firestore read.
   */
  build?: string
}

export const BUILD_HEADER = 'x-pzm-build'
/** A build id as vite writes it: hex commit prefix or "dev"; anything else is dropped. */
export const isBuildId = (v: unknown): v is string => typeof v === 'string' && /^([0-9a-f]{7,40}|dev|unknown)$/.test(v)

/** The ids a hop arrives with, checked; anything malformed is replaced, never trusted or echoed. */
export function fromHeaders(get: (name: string) => string | null, operationId?: unknown): TraceContext & { inherited: boolean } {
  const t = get(TRACE_HEADER)
  const r = get(REQUEST_HEADER)
  return {
    traceId: isTraceId(t) ? t : newTraceId(),
    requestId: isRequestId(r) ? r : newRequestId(),
    ...(isOperationId(operationId) ? { operationId } : {}),
    ...(isBuildId(get(BUILD_HEADER)) ? { build: get(BUILD_HEADER) as string } : {}),
    inherited: isTraceId(t),
  }
}

export function traceHeaders(ctx: Pick<TraceContext, 'traceId' | 'requestId'>): Record<string, string> {
  return { [TRACE_HEADER]: ctx.traceId, [REQUEST_HEADER]: ctx.requestId }
}

// ---------------------------------------------------------------- the active workflow (browser) ----

let active: string | null = null

/** A screen starts a workflow (opening a receipt for review); every call and audit entry after it carries its traceId. */
export function beginWorkflow(): string {
  active = newTraceId()
  return active
}
export function endWorkflow(): void {
  active = null
}
/** The workflow in progress, or a fresh one for a lone call. */
export function activeTraceId(): string {
  return active ?? newTraceId()
}
export function currentWorkflow(): string | null {
  return active
}

// ---------------------------------------------------------------- telemetry ----

/** Where a line was written. */
export type Stage = 'app.call' | 'api.command' | 'api.supplier' | 'tx.commit' | 'outbox.write' | 'worker.shadow' | 'worker.job' | 'ai.laya' | 'ai.guard' | 'notification' | 'audit'

export interface TraceFields extends Partial<TraceContext> {
  stage: Stage
  outcome: 'ok' | 'refused' | 'conflict' | 'error' | 'skipped'
  /** Command / job / question name — a code, not data. */
  name?: string
  ms?: number
  /** An HTTP status or an error key, never a message with figures in it. */
  code?: string | number
  brand?: 'pizza' | 'lelapin' | 'rnd'
  /** Counts only (events applied, rows written). */
  count?: number
  /** The calling app's build (see TraceContext.build). */
  build?: string
}

const ALLOWED: readonly (keyof TraceFields)[] = ['traceId', 'requestId', 'operationId', 'stage', 'outcome', 'name', 'ms', 'code', 'brand', 'count', 'build']

/**
 * The one log line: `{"kind":"pzm.trace","at":…,…}`. Only allow-listed keys survive, strings are
 * capped, and an id that is not id-shaped is dropped — so a payload can never ride along.
 */
export function traceLine(f: TraceFields, at = Date.now()): string {
  const out: Record<string, unknown> = { kind: 'pzm.trace', at }
  for (const k of ALLOWED) {
    const v = (f as unknown as Record<string, unknown>)[k]
    if (v === undefined || v === null) continue
    if (k === 'traceId' && !isTraceId(v)) continue
    if (k === 'requestId' && !isRequestId(v)) continue
    if (k === 'operationId' && !isOperationId(v)) continue
    if (k === 'build' && !isBuildId(v)) continue
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null
    else if (typeof v === 'string') out[k] = v.slice(0, 80)
  }
  return JSON.stringify(out)
}

/** Write a trace line to the platform log (Workers / Pages logs, the browser console in dev). */
export function emit(f: TraceFields): void {
  console.log(traceLine(f))
}
