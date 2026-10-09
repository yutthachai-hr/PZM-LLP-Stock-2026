import { browserOf, BODY_MAX, createLimiter, normaliseRoute, scrubMessage, stackHash, type ErrorReport } from '../lib/errorReport'

/**
 * E4 — the browser half of error reporting (see src/lib/errorReport.ts for what a report
 * may hold). Errors go to /api/client-error, a Pages Function that writes them to the
 * Workers log — never to Firestore.
 *
 * Everything here is best-effort and silent: reporting runs inside try/catch, sends with
 * sendBeacon (or a keepalive fetch) and never awaits, so a failure to report can never
 * break, slow or surface in the app. Per tab: each failure once per 10 minutes, at most 10
 * reports per 10 minutes, repeats sampled at 1 in 4.
 */

declare const __BUILD_ID__: string

export const ERROR_ENDPOINT = '/api/client-error'
const limiter = createLimiter({ max: 10, windowMs: 10 * 60_000, sample: 0.25 })

let role: ErrorReport['role'] = 'none'
let enabled = false
let send: (body: string) => void = defaultSend

export function setReporterRole(r: string | null | undefined): void {
  role = r === 'admin' || r === 'manager' || r === 'staff' ? r : 'none'
}

function buildId(): string {
  try {
    return typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'unknown'
  } catch {
    return 'unknown'
  }
}

function defaultSend(body: string): void {
  try {
    const blob = new Blob([body], { type: 'application/json' })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon?.(ERROR_ENDPOINT, blob)) return
    void fetch(ERROR_ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
  } catch {
    /* nowhere to send it: drop */
  }
}

/** The report as it would be sent, or null when it is not admitted. Exported for tests. */
export function makeReport(error: unknown, source: ErrorReport['source'], now = Date.now()): ErrorReport | null {
  const err = error instanceof Error ? error : null
  const errorType = (err?.name || (source === 'promise' ? 'unhandledrejection' : 'Error')).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'Error'
  const hash = stackHash(errorType, err?.stack ?? String(error))
  if (!limiter.admit(hash, now)) return null
  const online = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'
  return {
    buildId: buildId(),
    route: normaliseRoute(typeof location !== 'undefined' ? location.pathname : '/'),
    role,
    browser: browserOf(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    env: `${import.meta.env.MODE === 'production' ? 'prod' : import.meta.env.MODE}-${online}`.replace(/[^a-z0-9_./:-]/gi, '').slice(0, 80),
    errorType,
    message: scrubMessage(err ? err.message : error),
    stackHash: hash,
    source,
    ts: now,
  }
}

/** Report one error. Never throws, never waits. */
export function reportError(error: unknown, source: ErrorReport['source']): void {
  if (!enabled) return
  try {
    const report = makeReport(error, source)
    if (!report) return
    const body = JSON.stringify(report)
    if (body.length <= BODY_MAX) send(body)
  } catch {
    /* reporting must never be the thing that fails */
  }
}

/**
 * Listen for what nothing else caught. On in production builds only — a dev server or
 * the e2e emulators have no endpoint to send to. `opts` is for tests.
 */
export function installErrorReporter(opts: { force?: boolean; send?: (body: string) => void } = {}): void {
  if (enabled) return
  if (!opts.force && !(import.meta.env.PROD && import.meta.env.VITE_USE_EMULATOR !== '1')) return
  enabled = true
  if (opts.send) send = opts.send
  try {
    window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'))
    window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'))
  } catch {
    /* no window: nothing to listen to */
  }
}
