#!/usr/bin/env node
// Staging AI Gateway (owner approval 5, 9 Oct 2026). Runs on the model host, bound to 127.0.0.1
// ONLY; the sole way in is a Cloudflare Tunnel (cloudflared) whose hostname is protected by a
// Cloudflare Access application that admits one SERVICE TOKEN — the staging Pages project's.
// No open localhost tunnel, no public unauthenticated API.
//
// Defence in depth: Access already authenticates at the edge; this process verifies Access's
// signed JWT (`Cf-Access-Jwt-Assertion`, RS256, team certs, audience tag) again, so a request that
// reaches the port any other way is refused.
//
// It forwards only what Ask PZM needs, rebuilt from allowed fields (never the raw body):
//   POST /laya/v1/systemone      → Laya English   (the owner's checkpoint; API key added HERE)
//   POST /laya-ml/v1/systemone   → Laya multilingual (only when configured; an addition)
//   POST /reflex/decide          → Reflex, modelless lane only (shadow)
//   GET  /healthz                → upstream health, authenticated
// Limits: body bytes, text length, questions, concurrency, per-upstream timeout and breaker.
// Logs: one line per request — route, status, ms, request id. Never the text or the answer.
//
//   GATEWAY_CONFIG=stack/gateway/config.staging.json node stack/gateway/gateway.mjs
import { createPublicKey, createVerify, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LIMITS = { maxBodyBytes: 16_384, maxTextChars: 300, maxQuestions: 3, maxConcurrent: 4, upstreamTimeoutMs: 2000, failuresToOpen: 3, coolDownMs: 60_000 }

// ---------------------------------------------------------------- Access JWT ----
/** Verify a Cloudflare Access JWT against the team's JWKS. Returns the claims, or null. */
export function verifyAccessJwt(token, { jwks, aud, issuer, now = Date.now() }) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header, claims
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (header.alg !== 'RS256') return null
  const jwk = jwks.keys?.find((k) => k.kid === header.kid)
  if (!jwk) return null
  const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))
  if (!ok) return null
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(aud) : claims.aud === aud
  if (!audOk || claims.iss !== issuer) return null
  const t = Math.floor(now / 1000)
  if (typeof claims.exp !== 'number' || claims.exp < t || (typeof claims.nbf === 'number' && claims.nbf > t + 60)) return null
  // A service token's JWT carries `common_name` (its Client ID) and no email.
  return claims
}

// ---------------------------------------------------------------- request shaping ----
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
/** Rebuild a Laya body from allowed fields; null = refuse. The checkpoint is set by the ROUTE. */
export function shapeLaya(body, checkpoint, limits) {
  if (!body || typeof body !== 'object' || !isStr(body.state, limits.maxTextChars)) return null
  const qs = body.questions
  if (!qs || typeof qs !== 'object' || Array.isArray(qs)) return null
  const keys = Object.keys(qs)
  if (!keys.length || keys.length > limits.maxQuestions) return null
  const questions = {}
  for (const k of keys) {
    const q = qs[k]
    if (!/^[a-z_]{1,32}$/.test(k) || !q || !['choice', 'score', 'noul'].includes(q.type) || !isStr(q.instructions, 300)) return null
    const crit = q.criteria
    if (crit !== undefined && crit !== null) {
      const entries = Array.isArray(crit) ? crit.map((v) => [v, v]) : Object.entries(crit)
      if (entries.length > 12 || entries.some(([a, b]) => !isStr(String(a), 40) || (b !== null && !isStr(String(b), 200)))) return null
    }
    questions[k] = { type: q.type, instructions: q.instructions, ...(crit !== undefined ? { criteria: crit } : {}) }
  }
  return { state: body.state, model: checkpoint, questions }
}
export function shapeReflex(body, limits) {
  if (!body || typeof body !== 'object' || !isStr(body.state, limits.maxTextChars) || !Array.isArray(body.questions)) return null
  if (!body.questions.length || body.questions.length > limits.maxQuestions) return null
  const questions = []
  for (const q of body.questions) {
    if (!q || !isStr(q.id, 32) || !['choice', 'score', 'noul'].includes(q.kind) || !isStr(q.prompt, 300) || !Array.isArray(q.options) || q.options.length > 12 || !q.options.every((o) => isStr(o, 40))) return null
    questions.push({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, criteria: null })
  }
  return { state: body.state, questions }
}

// ---------------------------------------------------------------- breaker ----
export class Breaker {
  constructor(limits) {
    this.limits = limits
    this.failures = 0
    this.openUntil = 0
  }
  open(now) {
    return now < this.openUntil
  }
  record(ok, now) {
    if (ok) this.failures = 0
    else if (++this.failures >= this.limits.failuresToOpen) {
      this.openUntil = now + this.limits.coolDownMs
      this.failures = 0
    }
  }
}

// ---------------------------------------------------------------- server ----
/**
 * @param cfg {{ auth: { mode: 'access', jwks, aud, issuer } | { mode: 'dev', token },
 *               upstreams: { laya?: { url, apiKey }, layaMl?: { url, apiKey }, reflex?: { url } },
 *               limits?: object, log?: (line: object) => void, now?: () => number }}
 */
export function createGateway(cfg) {
  const limits = { ...DEFAULT_LIMITS, ...(cfg.limits ?? {}) }
  const now = cfg.now ?? (() => Date.now())
  const log = cfg.log ?? ((l) => console.log(JSON.stringify(l)))
  const breakers = { laya: new Breaker(limits), layaMl: new Breaker(limits), reflex: new Breaker(limits) }
  let inFlight = 0

  const authorised = (req) => {
    if (cfg.auth.mode === 'dev') return typeof cfg.auth.token === 'string' && cfg.auth.token.length >= 32 && req.headers['x-gateway-dev-token'] === cfg.auth.token
    return !!verifyAccessJwt(req.headers['cf-access-jwt-assertion'], { ...cfg.auth, now: now() })
  }

  async function forward(name, path, payload, headers) {
    const up = cfg.upstreams[name]
    if (!up) return { status: 404, body: { error: 'not_configured' } }
    if (breakers[name].open(now())) return { status: 503, body: { error: 'circuit_open' } }
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), limits.upstreamTimeoutMs)
    try {
      const r = await fetch(up.url + path, { method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(up.apiKey ? { authorization: `Bearer ${up.apiKey}` } : {}), ...headers }, body: payload ? JSON.stringify(payload) : undefined, signal: ctl.signal })
      const body = await r.json().catch(() => null)
      breakers[name].record(r.ok, now())
      return { status: r.ok ? 200 : 502, body: r.ok ? body : { error: 'upstream_error' } }
    } catch {
      breakers[name].record(false, now())
      return { status: 504, body: { error: 'upstream_timeout' } }
    } finally {
      clearTimeout(t)
    }
  }

  const server = http.createServer(async (req, res) => {
    const id = randomUUID()
    const t0 = now()
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-request-id': id })
      res.end(JSON.stringify(body))
      log({ at: new Date(t0).toISOString(), id, route: `${req.method} ${req.url?.split('?')[0]}`, status, ms: now() - t0 })
    }
    if (!authorised(req)) return send(401, { error: 'unauthorized' })
    if (req.method === 'GET' && req.url === '/healthz') {
      const out = {}
      for (const [name, path] of [['laya', '/health'], ['layaMl', '/health'], ['reflex', '/healthz']]) {
        if (!cfg.upstreams[name]) continue
        const r = await forward(name, path, null, {})
        out[name] = { ok: r.status === 200, breakerOpen: breakers[name].open(now()) }
      }
      return send(200, { status: 'ok', upstreams: out })
    }
    const route = { '/laya/v1/systemone': ['laya', '/v1/systemone'], '/laya-ml/v1/systemone': ['layaMl', '/v1/systemone'], '/reflex/decide': ['reflex', '/decide'] }[req.url ?? '']
    if (req.method !== 'POST' || !route) return send(404, { error: 'not_found' })
    if (inFlight >= limits.maxConcurrent) return send(503, { error: 'busy' })
    inFlight++
    try {
      const chunks = []
      let size = 0
      for await (const c of req) {
        size += c.length
        if (size > limits.maxBodyBytes) return send(413, { error: 'too_large' })
        chunks.push(c)
      }
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { error: 'bad_json' })
      }
      const [name, path] = route
      const payload = name === 'reflex' ? shapeReflex(body, limits) : shapeLaya(body, name === 'laya' ? 'english' : 'multilingual', limits)
      if (!payload) return send(400, { error: 'bad_request' })
      const r = await forward(name, path, payload, name === 'reflex' ? { 'x-reflex-lane': 'modelless' } : {})
      return send(r.status, r.body)
    } finally {
      inFlight--
    }
  })
  return { server, breakers, limits }
}

// ---------------------------------------------------------------- main ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.GATEWAY_CONFIG
  if (!file) throw new Error('GATEWAY_CONFIG must name the config file')
  const c = JSON.parse(readFileSync(file, 'utf8'))
  const secret = (p) => (p ? readFileSync(p, 'utf8').trim() : undefined)
  const auth = c.auth.mode === 'access' ? { mode: 'access', jwks: await fetch(`https://${c.auth.teamDomain}/cdn-cgi/access/certs`).then((r) => r.json()), aud: c.auth.aud, issuer: `https://${c.auth.teamDomain}` } : { mode: 'dev', token: secret(c.auth.tokenFile) }
  const upstreams = Object.fromEntries(Object.entries(c.upstreams).map(([k, v]) => [k, { url: v.url, apiKey: secret(v.apiKeyFile) }]))
  for (const u of Object.values(upstreams)) if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(u.url)) throw new Error('upstreams must be loopback')
  const { server } = createGateway({ auth, upstreams, limits: c.limits })
  // Loopback only: cloudflared runs on this host and connects here. Never 0.0.0.0.
  server.listen(c.port ?? 7350, '127.0.0.1', () => console.log(`[gateway] 127.0.0.1:${c.port ?? 7350} auth=${auth.mode}`))
}
