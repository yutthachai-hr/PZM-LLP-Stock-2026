// E4: client error reports — nothing personal or business leaves the browser, the same
// failure is not sent twice, the endpoint re-checks everything and writes only a log line,
// and a reporting failure can never break the app.
//
//   npm test

import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { browserOf, createLimiter, normaliseRoute, scrubMessage, stackHash, validateReport } from '../src/lib/errorReport'
import { handleClientError } from '../functions/_lib/clientError'

const NOW = Date.UTC(2026, 9, 7, 3)
const good = {
  buildId: 'abc123def456', route: '/products/:id/card', role: 'staff', browser: 'chrome-128/android', env: 'prod-online',
  errorType: 'TypeError', message: 'x is undefined', stackHash: '0a1b2c3d', source: 'window', ts: NOW,
}

describe('nothing personal or business leaves', () => {
  test.each([
    ['Cannot save user somchai@pizzamania.com', 'Cannot save user <email>'],
    ['qty 12.5 of 300 rejected', 'qty <n> of <n> rejected'],
    ['PO-2026-0042 already received', '<doc> already received'],
    ['product "MOZZARELLA 2KG" missing', 'product <text> missing'],
    ['ไม่พบสินค้า มอสซาเรลล่า', '<th> <th>'],
    ['doc XyZ8aB3kLmNoPqRsTuVw1234 not found', 'doc <id> not found'],
    ['token eyJhbGciOi.eyJzdWIiOiIx.sig leaked', 'token <token> leaked'],
    ['fetch https://pzm.pages.dev/products/p123/card?sku=ABC failed', 'fetch https://pzm.pages.dev/products/:id/card failed'],
  ])('%s', (raw, want) => {
    expect(scrubMessage(raw)).toBe(want)
  })

  test('long messages are cut', () => {
    expect(scrubMessage('a '.repeat(500)).length).toBeLessThanOrEqual(160)
  })

  test('routes keep their shape, never an id or a query', () => {
    expect(normaliseRoute('/products/p_9f8e7d/card?x=1#y')).toBe('/products/:id/card')
    expect(normaliseRoute('/a/7f3k2j9x8w')).toBe('/a/:id')
    expect(normaliseRoute('/settings/audit')).toBe('/settings/audit')
    expect(normaliseRoute('/orders/PO-2026-0001')).toBe('/orders/:id')
  })

  test('the browser is a family, a major version and a platform', () => {
    expect(browserOf('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36')).toBe('chrome-128/android')
    expect(browserOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('safari-17/ios')
  })

  test('the same failure hashes the same across builds and lines; a different one does not', () => {
    const a = 'TypeError: x\n    at save (https://pzm.pages.dev/assets/Orders-AbC123xy.js:10:20)\n    at click (https://pzm.pages.dev/assets/index-Zz9Yy8Xx.js:1:2)'
    const b = 'TypeError: x\n    at save (https://other.dev/assets/Orders-QwErTy12.js:99:1)\n    at click (https://other.dev/assets/index-Pp0Oo9Ii.js:5:6)'
    const c = 'TypeError: x\n    at load (https://pzm.pages.dev/assets/Orders-AbC123xy.js:10:20)'
    expect(stackHash('TypeError', a)).toBe(stackHash('TypeError', b))
    expect(stackHash('TypeError', a)).not.toBe(stackHash('TypeError', c))
    expect(stackHash('TypeError', a)).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('the server trusts nothing it is sent', () => {
  test('a good report passes, its message scrubbed again', () => {
    expect(validateReport({ ...good, message: 'bad for a@b.co' }, NOW)?.message).toBe('bad for <email>')
  })
  test.each([
    ['an extra field', { ...good, lines: [{ qty: 3 }] }],
    ['an unknown role', { ...good, role: 'owner' }],
    ['a bad hash', { ...good, stackHash: 'zz' }],
    ['a strange build id', { ...good, buildId: '<script>' }],
    ['no route', { ...good, route: 'products' }],
    ['not an object', [good]],
  ])('refused: %s', (_n, body) => {
    expect(validateReport(body, NOW)).toBeNull()
  })
  test('a route with an id in it is reshaped on the server too', () => {
    expect(validateReport({ ...good, route: '/products/p123/card' }, NOW)?.route).toBe('/products/:id/card')
  })
})

describe('sampling, rate limiting and deduplication', () => {
  test('the same failure once per window; at most `max` in all; new failures never sampled away', () => {
    const l = createLimiter({ max: 3, windowMs: 60_000, sample: 0, random: () => 0.5 })
    expect(l.admit('a', 0)).toBe(true)
    expect(l.admit('a', 10)).toBe(false)
    expect(l.admit('b', 20)).toBe(true)
    expect(l.admit('c', 30)).toBe(true)
    expect(l.admit('d', 40)).toBe(false) // budget spent
    expect(l.admit('a', 61_000)).toBe(false) // a repeat in a new window, sample 0
    expect(l.admit('e', 61_000)).toBe(true) // new, never sampled
  })
})

describe('the endpoint', () => {
  const req = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }, method = 'POST') =>
    new Request('https://x/api/client-error', { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined })

  test('a good report is one JSON log line, answered 204; the same again is deduplicated, still 204', async () => {
    const lines: string[] = []
    const r1 = await handleClientError(req({ ...good, stackHash: '11112222' }), (l) => lines.push(l), NOW)
    const r2 = await handleClientError(req({ ...good, stackHash: '11112222' }), (l) => lines.push(l), NOW + 5)
    expect([r1.status, r2.status]).toEqual([204, 204])
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ kind: 'client-error', route: '/products/:id/card', stackHash: '11112222' })
  })

  test('malformed, oversized, wrong type or wrong method are refused and log nothing', async () => {
    const lines: string[] = []
    const log = (l: string) => lines.push(l)
    expect((await handleClientError(req('{not json'), log, NOW)).status).toBe(400)
    expect((await handleClientError(req({ ...good, extra: 1 }), log, NOW)).status).toBe(400)
    expect((await handleClientError(req({ ...good, message: 'x'.repeat(5000) }), log, NOW)).status).toBe(413)
    expect((await handleClientError(req(good, { 'content-type': 'multipart/form-data' }), log, NOW)).status).toBe(415)
    expect((await handleClientError(req(null, {}, 'GET'), log, NOW)).status).toBe(405)
    expect(lines).toHaveLength(0)
  })

  test('a log that throws does not turn into an error response', async () => {
    const r = await handleClientError(req({ ...good, stackHash: '33334444' }), () => { throw new Error('log down') }, NOW)
    expect(r.status).toBe(204)
  })

  test('never Firestore: the endpoint and the shared code import no database at all', () => {
    for (const f of ['functions/_lib/clientError.ts', 'functions/api/client-error.ts', 'src/lib/errorReport.ts', 'src/services/errorReporter.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/from ['"][^'"]*(firebase|firestore|serverStore|backend)[^'"]*['"]/)
      expect(src, f).not.toMatch(/firestore\.googleapis/)
    }
  })
})

describe('the browser reporter', () => {
  test('never throws, even when sending throws; never sends twice for the same failure', async () => {
    vi.resetModules()
    const sent: string[] = []
    const { installErrorReporter, reportError, setReporterRole } = await import('../src/services/errorReporter')
    let fail = true
    installErrorReporter({
      force: true,
      send: (b) => {
        if (fail) throw new Error('network gone')
        sent.push(b)
      },
    })
    setReporterRole('manager')
    const err = new TypeError('cannot read qty of 12 for somchai@x.com')
    expect(() => reportError(err, 'window')).not.toThrow()
    fail = false
    reportError(new RangeError('other'), 'render')
    reportError(new RangeError('other'), 'render')
    expect(sent).toHaveLength(1)
    const body = JSON.parse(sent[0])
    expect(body).toMatchObject({ role: 'manager', errorType: 'RangeError', source: 'render', message: 'other' })
    expect(Object.keys(body).sort()).toEqual(['browser', 'buildId', 'env', 'errorType', 'message', 'role', 'route', 'source', 'stackHash', 'ts'])
    expect(validateReport(body, body.ts)).not.toBeNull()
  })

  test('off unless installed (dev, e2e and tests send nothing)', async () => {
    vi.resetModules()
    const { reportError } = await import('../src/services/errorReporter')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    reportError(new Error('x'), 'window')
    expect(spy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
