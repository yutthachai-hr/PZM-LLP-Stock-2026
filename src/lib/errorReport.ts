/**
 * E4 — client error reports (owner approved 6 Oct 2026: NOT stored in Firestore).
 *
 * The pure half, shared by the browser (src/services/errorReporter.ts) and the endpoint
 * (functions/api/client-error.ts), so the server re-applies exactly the checks the client
 * made: what may be sent is decided here and nowhere else.
 *
 * A report says WHERE something broke and HOW, never WHAT the person was working on:
 * build, route shape, role, browser, error type, a scrubbed message and a hash of the
 * stack. Document contents, names, numbers, e-mails, ids and query strings never leave.
 */

export interface ErrorReport {
  buildId: string
  /** The route's shape: `/products/:id/card`, never the id. */
  route: string
  role: 'admin' | 'manager' | 'staff' | 'none'
  /** Browser family and major version, plus platform class: `chrome-128/android`. */
  browser: string
  /** `prod`, `e2e`, `dev`, and whether the device thought it was online. */
  env: string
  /** Error, TypeError, FirebaseError, unhandledrejection… */
  errorType: string
  /** Scrubbed, at most MESSAGE_MAX characters. */
  message: string
  /** FNV-1a of the stack's function names and file names, without line numbers. */
  stackHash: string
  /** Where it was caught: window, promise, render, listener. */
  source: 'window' | 'promise' | 'render' | 'listener'
  ts: number
}

export const MESSAGE_MAX = 160
export const BODY_MAX = 2_048
const ROLES = ['admin', 'manager', 'staff', 'none'] as const
const SOURCES = ['window', 'promise', 'render', 'listener'] as const

/**
 * Take out anything that could identify a person, a document or a quantity. Order matters:
 * the broad patterns run after the specific ones, so an e-mail is not half-eaten by the
 * number rule first.
 */
export function scrubMessage(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '')
  s = s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/https?:\/\/[^\s"')]+/g, (u) => {
      try {
        const url = new URL(u)
        return `${url.origin}${normaliseRoute(url.pathname)}`
      } catch {
        return '<url>'
      }
    })
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<token>')
    .replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '<text>')
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, '<id>')
    .replace(/[\u0E00-\u0E7F]+/g, '<th>')
    .replace(/\b[A-Z]{1,6}-?\d{2,}[-\d]*\b/g, '<doc>')
    .replace(/\d+([.,]\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > MESSAGE_MAX ? s.slice(0, MESSAGE_MAX - 1) + '…' : s
}

/** `/products/p123/card?x=1` → `/products/:id/card`: the route's shape, not what was open. */
export function normaliseRoute(path: string): string {
  const clean = (path.split(/[?#]/)[0] || '/').slice(0, 200)
  const KNOWN = /^(products|receive|orders|movements|suppliers|performance|calendar|inbox|settings|card|requests|transfers|count|counts|import|dashboard|reports|po|a|supplier|new|edit|batch|api|stock|purchase|issue|adjust|messages|notifications|automation|shadow|audit|users|locations|backup|maintenance)$/
  return (
    '/' +
    clean
      .split('/')
      .filter(Boolean)
      .slice(0, 6)
      .map((seg) => (KNOWN.test(seg) ? seg : /^[a-z][a-zA-Z]{2,30}$/.test(seg) ? seg : ':id'))
      .join('/')
  )
}

/** Chrome 128 on Android → `chrome-128/android`. Nothing finer than that. */
export function browserOf(ua: string): string {
  const m =
    /Edg\/(\d+)/.exec(ua)?.slice(1).map((v) => `edge-${v}`) ??
    /SamsungBrowser\/(\d+)/.exec(ua)?.slice(1).map((v) => `samsung-${v}`) ??
    /(?:Chrome|CriOS)\/(\d+)/.exec(ua)?.slice(1).map((v) => `chrome-${v}`) ??
    /(?:Firefox|FxiOS)\/(\d+)/.exec(ua)?.slice(1).map((v) => `firefox-${v}`) ??
    /Version\/(\d+).*Safari/.exec(ua)?.slice(1).map((v) => `safari-${v}`)
  const family = m?.[0] ?? 'other'
  const platform = /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Mac OS X/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'other'
  return `${family}/${platform}`
}

/** FNV-1a (32-bit, hex) — small, stable, and enough to group the same failure. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * The stack without what changes between builds or devices: line and column numbers,
 * hashes in chunk names, origins. Two people hitting the same bug get the same hash.
 */
export function stackHash(errorType: string, stack: string | undefined): string {
  const frames = (stack ?? '')
    .split('\n')
    .slice(0, 12)
    .map((l) =>
      l
        .trim()
        .replace(/https?:\/\/[^/\s)]+/g, '')
        .replace(/:\d+(:\d+)?\)?$/g, '')
        .replace(/-[A-Za-z0-9_-]{6,}\.js/g, '.js')
        .replace(/\?[^\s)]*/g, ''),
    )
    .filter((l) => l && !/^(Error|TypeError|RangeError|FirebaseError)\b/.test(l))
  return fnv1a(`${errorType}|${frames.join('|')}`)
}

const TYPE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/
const SAFE_RE = /^[a-z0-9_./:-]{1,80}$/i

/**
 * Accept or refuse a report as received. Refuses anything with a field the shape does not
 * have, and re-scrubs the message — the server trusts nothing the browser says it did.
 */
export function validateReport(input: unknown, now: number): ErrorReport | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const r = input as Record<string, unknown>
  const keys = ['buildId', 'route', 'role', 'browser', 'env', 'errorType', 'message', 'stackHash', 'source', 'ts']
  if (Object.keys(r).some((k) => !keys.includes(k))) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const buildId = str(r.buildId)
  const route = str(r.route)
  const browser = str(r.browser)
  const env = str(r.env)
  const errorType = str(r.errorType)
  const stack = str(r.stackHash)
  if (!buildId || !SAFE_RE.test(buildId)) return null
  if (!route || !route.startsWith('/')) return null
  if (!browser || !SAFE_RE.test(browser)) return null
  if (!env || !SAFE_RE.test(env)) return null
  if (!errorType || !TYPE_RE.test(errorType)) return null
  if (!stack || !/^[0-9a-f]{8}$/.test(stack)) return null
  if (!(ROLES as readonly unknown[]).includes(r.role)) return null
  if (!(SOURCES as readonly unknown[]).includes(r.source)) return null
  const ts = typeof r.ts === 'number' && Number.isFinite(r.ts) && Math.abs(r.ts - now) < 24 * 3_600_000 ? r.ts : now
  return {
    buildId,
    route: normaliseRoute(route),
    role: r.role as ErrorReport['role'],
    browser,
    env,
    errorType,
    message: scrubMessage(r.message),
    stackHash: stack,
    source: r.source as ErrorReport['source'],
    ts,
  }
}

/**
 * Who gets through: the first of each failure, then at most one per `windowMs` per
 * failure, and at most `max` of everything per window. Used on both sides — per tab in the
 * browser, per isolate on the server (best-effort: Workers isolates come and go).
 */
export function createLimiter(opts: { max: number; windowMs: number; sample?: number; random?: () => number }) {
  const seen = new Map<string, number>()
  // Every failure met so far (bounded), so a repeat in a later window is still a repeat.
  const known = new Set<string>()
  let windowStart = 0
  let count = 0
  return {
    admit(key: string, now: number): boolean {
      if (now - windowStart >= opts.windowMs) {
        windowStart = now
        count = 0
        for (const [k, at] of seen) if (now - at >= opts.windowMs) seen.delete(k)
      }
      const last = seen.get(key)
      if (last !== undefined && now - last < opts.windowMs) return false
      if (count >= opts.max) return false
      // Sampling applies after the first time a failure is seen in the window, so a new
      // kind of failure is never sampled away.
      if (known.has(key) && opts.sample !== undefined && (opts.random ?? Math.random)() >= opts.sample) return false
      if (known.size >= 1_000) known.clear()
      known.add(key)
      seen.set(key, now)
      count++
      return true
    },
  }
}
