import { BODY_MAX, createLimiter, validateReport, type ErrorReport } from '../../src/lib/errorReport'

/**
 * E4 — the server half of error reporting (owner, 6 Oct 2026: not in Firestore). A report
 * is checked against the shared shape (src/lib/errorReport.ts), its message scrubbed again,
 * and — if this isolate has not already logged the same failure this minute and the
 * isolate's budget is not spent — written as one JSON line to the Workers log, where
 * `wrangler pages deployment tail` and the dashboard's Logs show it.
 *
 * Nothing is stored and nothing is read: no database, no KV, no outgoing request. The
 * answer is 204 whether the report was logged, deduplicated or sampled away, so a page
 * cannot learn anything from it; only a malformed or oversized body gets a 4xx.
 */

const limiter = createLimiter({ max: 60, windowMs: 60_000, sample: 0.2 })

export interface HandleResult {
  status: 204 | 400 | 405 | 413 | 415
  logged: ErrorReport | null
}

export async function handleClientError(
  request: Request,
  log: (line: string) => void = (l) => console.log(l),
  now = Date.now(),
): Promise<HandleResult> {
  if (request.method !== 'POST') return { status: 405, logged: null }
  const type = request.headers.get('content-type') ?? ''
  // sendBeacon with a Blob sends the Blob's type; anything else is not from the app.
  if (!type.startsWith('application/json') && !type.startsWith('text/plain')) return { status: 415, logged: null }
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > BODY_MAX) return { status: 413, logged: null }
  let text: string
  try {
    text = await request.text()
  } catch {
    return { status: 400, logged: null }
  }
  if (text.length > BODY_MAX) return { status: 413, logged: null }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { status: 400, logged: null }
  }
  const report = validateReport(body, now)
  if (!report) return { status: 400, logged: null }
  if (!limiter.admit(`${report.buildId}|${report.stackHash}`, now)) return { status: 204, logged: null }
  try {
    log(JSON.stringify({ kind: 'client-error', ...report, receivedAt: now }))
  } catch {
    /* a log that cannot be written is not the caller's problem */
  }
  return { status: 204, logged: report }
}
