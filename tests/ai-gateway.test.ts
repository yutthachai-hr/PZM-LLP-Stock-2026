// Staging AI Gateway (owner approval 5): authenticated, loopback-bound, shapes every request, keeps
// business text out of its logs, and degrades to clean errors when a model is down.
//
//   npm test
import { createSign, generateKeyPairSync } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error — plain ESM module without types (stack/ is not part of the app build)
import { createGateway, verifyAccessJwt } from '../stack/gateway/gateway.mjs'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const ISS = 'https://pzm.cloudflareaccess.com'
const AUD = 'aud-staging-gateway'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(claims: Record<string, unknown>, kid = 'k1', key = privateKey) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' })
  const body = b64({ iss: ISS, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 300, common_name: 'svc.access', ...claims })
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url')
  return `${head}.${body}.${sig}`
}

let upstreamSeen: { path: string; auth?: string; lane?: string; body: unknown }[] = []
let upstreamMode: 'ok' | 'fail' | 'hang' = 'ok'
const lines: Record<string, unknown>[] = []
let upstream: http.Server
let gw: http.Server
let base = ''

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    upstreamSeen.push({ path: req.url!, auth: req.headers.authorization, lane: req.headers['x-reflex-lane'] as string, body: raw ? JSON.parse(raw) : null })
    if (upstreamMode === 'hang') return // never answers
    res.writeHead(upstreamMode === 'ok' ? 200 : 500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  const u = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const g = createGateway({
    auth: { mode: 'access', jwks: { keys: [jwk] }, aud: AUD, issuer: ISS },
    upstreams: { laya: { url: u, apiKey: 'laya-key-held-by-the-gateway' }, reflex: { url: u } },
    limits: { upstreamTimeoutMs: 300, failuresToOpen: 2, coolDownMs: 60_000, maxConcurrent: 2 },
    log: (l: Record<string, unknown>) => lines.push(l),
  })
  gw = g.server
  await new Promise<void>((r) => gw.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(gw.address() as AddressInfo).port}`
})
afterAll(() => {
  gw?.close()
  upstream?.close()
})

const laya = { state: 'ซัพตอบมายัง secret-business-text', model: 'multilingual', questions: { intent: { type: 'choice', instructions: 'Which?', criteria: { a: 'x', b: 'y' } } }, extra: { uid: 'mgr', brand: 'pizza' } }
const post = (path: string, body: unknown, token: string | null = jwt({})) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'cf-access-jwt-assertion': token } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('authentication', () => {
  test('no token, forged, wrong audience, wrong issuer, expired, unknown key → 401', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    for (const t of [null, 'abc.def.ghi', jwt({ aud: ['other'] }), jwt({ iss: 'https://evil.cloudflareaccess.com' }), jwt({ exp: 1 }), jwt({}, 'k2'), jwt({}, 'k1', other)]) {
      expect((await post('/laya/v1/systemone', laya, t)).status, String(t).slice(0, 20)).toBe(401)
    }
    expect(upstreamSeen).toHaveLength(0)
  })
  test('the verifier refuses alg none', () => {
    const none = `${b64({ alg: 'none', kid: 'k1' })}.${b64({ iss: ISS, aud: [AUD], exp: 9e9 })}.`
    expect(verifyAccessJwt(none, { jwks: { keys: [jwk] }, aud: AUD, issuer: ISS })).toBeNull()
  })
})

describe('forwarding', () => {
  test('Laya: rebuilt from allowed fields, English forced by the route, key added here', async () => {
    upstreamSeen = []
    const r = await post('/laya/v1/systemone', laya)
    expect(r.status).toBe(200)
    expect(upstreamSeen[0]).toMatchObject({ path: '/v1/systemone', auth: 'Bearer laya-key-held-by-the-gateway' })
    expect(upstreamSeen[0].body).toEqual({ state: laya.state, model: 'english', questions: laya.questions })
  })
  test('Reflex: modelless lane only, whatever the caller asks', async () => {
    upstreamSeen = []
    await post('/reflex/decide', { state: 'x', questions: [{ id: 'intent', kind: 'choice', prompt: 'p', options: ['a', 'b'], criteria: 'ignored' }] })
    expect(upstreamSeen[0]).toMatchObject({ path: '/decide', lane: 'modelless' })
  })
  test('unconfigured multilingual route → 404; unknown route → 404', async () => {
    expect((await post('/laya-ml/v1/systemone', laya)).status).toBe(404)
    expect((await post('/admin', laya)).status).toBe(404)
  })
  test('limits: oversize body 413, long text 400, too many questions 400, bad JSON 400', async () => {
    expect((await post('/laya/v1/systemone', 'x'.repeat(20_000))).status).toBe(413)
    expect((await post('/laya/v1/systemone', { ...laya, state: 'x'.repeat(301) })).status).toBe(400)
    const many = Object.fromEntries(['a', 'b', 'c', 'd'].map((k) => [k, { type: 'noul', instructions: 'q' }]))
    expect((await post('/laya/v1/systemone', { state: 'x', questions: many })).status).toBe(400)
    expect((await post('/laya/v1/systemone', '{nope')).status).toBe(400)
  })
  test('logs carry route, status and time — never the text', () => {
    expect(lines.length).toBeGreaterThan(5)
    expect(JSON.stringify(lines)).not.toContain('secret-business-text')
    expect(Object.keys(lines[0]).sort()).toEqual(['at', 'id', 'ms', 'route', 'status'])
  })
})

describe('failure handling', () => {
  test('upstream timeout → 504; repeated failures open the breaker → 503 without calling', async () => {
    upstreamMode = 'hang'
    expect((await post('/reflex/decide', { state: 'x', questions: [{ id: 'q', kind: 'noul', prompt: 'p', options: [] }] })).status).toBe(504)
    upstreamMode = 'fail'
    expect((await post('/reflex/decide', { state: 'x', questions: [{ id: 'q', kind: 'noul', prompt: 'p', options: [] }] })).status).toBe(502)
    upstreamSeen = []
    expect((await post('/reflex/decide', { state: 'x', questions: [{ id: 'q', kind: 'noul', prompt: 'p', options: [] }] })).status).toBe(503)
    expect(upstreamSeen).toHaveLength(0)
    upstreamMode = 'ok'
    // Laya has its own breaker: still served.
    expect((await post('/laya/v1/systemone', laya)).status).toBe(200)
  })
  test('health is authenticated and reports each upstream and its breaker', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(401)
    const h = await (await fetch(`${base}/healthz`, { headers: { 'cf-access-jwt-assertion': jwt({}) } })).json()
    expect(h).toMatchObject({ status: 'ok', upstreams: { laya: { ok: true, breakerOpen: false }, reflex: { breakerOpen: true } } })
  })
})
