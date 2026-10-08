#!/usr/bin/env node
// Step 2: validate a RUNNING Reflex (gist-rs/reflex release binary) on loopback with SYNTHETIC
// data only. Every response is checked against the katgpt-rs decision wire (decision_wire.rs
// validate_against, ported below). Writes a JSON report; exit 1 on any failed check.
//
//   node stack/scripts/reflex-validate.mjs [--url http://127.0.0.1:7331] [--out stack/evidence/reflex-validate.json]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import net from 'node:net'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const URL_ = arg('--url', 'http://127.0.0.1:7331')
const OUT = arg('--out', 'stack/evidence/reflex-validate.json')
const u = new URL(URL_)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('loopback only')

const INTENTS = ['out_of_scope', 'po_unconfirmed', 'stock_lookup', 'stockout_risk', 'transfer_status', 'write_request']

/** decision_wire.rs DecisionResponse::validate_against, in JS. Returns an error string or null. */
export function wireError(req, resp) {
  if (!resp || !Array.isArray(resp.answers)) return 'no answers array'
  if (resp.answers.length !== req.questions.length) return `answers ${resp.answers.length} ≠ questions ${req.questions.length}`
  if (!resp.routing || typeof resp.routing.lane !== 'string') return 'no routing.lane'
  if (!resp.calibration || typeof resp.calibration.method !== 'string') return 'no calibration'
  for (const [i, a] of resp.answers.entries()) {
    const q = req.questions[i]
    if (a.question_id !== q.id) return `answer ${i} id mismatch`
    if (!Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) return `answer ${i} confidence ${a.confidence}`
    const arity = q.kind === 'noul' ? 1 : q.options.length
    if (a.outcome) {
      const [k, v] = Object.entries(a.outcome)[0]
      if (k !== q.kind) return `answer ${i} outcome kind ${k} ≠ ${q.kind}`
      if (k === 'choice' && !(v.index >= 0 && v.index < q.options.length)) return `answer ${i} index out of range`
      if (k === 'score' && !(v.level >= 0 && v.level < q.options.length)) return `answer ${i} level out of range`
      if (k === 'noul' && typeof v.yes !== 'boolean') return `answer ${i} noul not boolean`
    }
    if (a.outcome || a.probabilities.length) {
      if (a.probabilities.length !== arity) return `answer ${i} arity ${a.probabilities.length} ≠ ${arity}`
      if (a.probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) return `answer ${i} probability out of range`
    }
  }
  return null
}

async function post(path, body, { timeoutMs = 5000, raw = false, headers = {} } = {}) {
  const t0 = performance.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(URL_ + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw ? body : JSON.stringify(body), signal: ctl.signal })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, json, text: text.slice(0, 300), ms: performance.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

const q = {
  intent: { id: 'intent', kind: 'choice', prompt: 'Which Ask PZM intent is this?', options: INTENTS, criteria: null },
  urgency: { id: 'urgency', kind: 'score', prompt: 'How urgent is it?', options: ['low', 'medium', 'high'], criteria: null },
  write: { id: 'write', kind: 'noul', prompt: 'Does the message ask to change data?', options: [], criteria: null },
}
const decide = (state, questions = [q.intent]) => ({ state, questions })

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '') }

// health
const h = await fetch(URL_ + '/healthz').then((r) => r.json())
check('healthz ok, modelless ready', h.status === 'ok' && h.lanes?.modelless === 'ready', JSON.stringify(h.lanes))
check('corpus is the PZM rulebook', JSON.stringify(h.corpus?.domains) === JSON.stringify(INTENTS), JSON.stringify(h.corpus))

// all three kinds in one call, schema-valid
const all = decide('synthetic: how much mozzarella is left at Sukhumvit?', [q.intent, q.urgency, q.write])
const r1 = await post('/decide', all)
check('choice + score + noul answered in one call', r1.status === 200 && r1.json?.answers?.length === 3, `status ${r1.status}`)
check('response satisfies the decision wire', wireError(all, r1.json) === null, wireError(all, r1.json))
check('routing discloses the modelless lane', r1.json?.routing?.lane === 'modelless', r1.json?.routing?.reason?.slice(0, 120))
check('calibration disclosed (none = honest raw)', r1.json?.calibration?.method === 'none', JSON.stringify(r1.json?.calibration))

// abstention: off-corpus nonsense must abstain
const off = decide('zzqx 9931 lorem ipsum ¤¤ qwerty asdf')
const r2 = await post('/decide', off)
check('off-corpus input abstains (outcome null)', r2.json?.answers?.[0]?.outcome === null, JSON.stringify(r2.json?.answers?.[0]))

// determinism: same input → same bytes
const r3 = await post('/decide', all)
check('deterministic (same request → same answer)', JSON.stringify(r3.json?.answers) === JSON.stringify(r1.json?.answers))

// malformed inputs → 4xx, never 5xx, never a crash
const bad = [
  ['not JSON', '{nope', true],
  ['missing questions', JSON.stringify({ state: 'x' }), true],
  ['unknown kind', JSON.stringify({ state: 'x', questions: [{ id: 'a', kind: 'maybe', prompt: 'p', options: [], criteria: null }] }), true],
  ['wrong types', JSON.stringify({ state: 5, questions: 'all' }), true],
]
for (const [name, body] of bad) {
  const r = await post('/decide', body, { raw: true })
  check(`malformed (${name}) → 4xx`, r.status >= 400 && r.status < 500, `status ${r.status} ${r.text.slice(0, 80)}`)
}
// structurally invalid but parseable: noul with options, 1-option choice, duplicate ids
for (const [name, req] of [
  ['noul with options', decide('x', [{ ...q.write, options: ['yes', 'no'] }])],
  ['one-option choice', decide('x', [{ ...q.intent, options: ['stock_lookup'] }])],
  ['duplicate ids', decide('x', [q.intent, { ...q.urgency, id: 'intent' }])],
]) {
  const r = await post('/decide', req)
  check(`invalid wire (${name}) refused`, r.status >= 400 && r.status < 500, `status ${r.status} ${r.text.slice(0, 100)}`)
}
const lane = await post('/decide', all, { headers: { 'x-reflex-lane': 'nope' } })
check('unknown lane header → 400', lane.status === 400, lane.text.slice(0, 80))
const big = await post('/decide', JSON.stringify({ state: 'x'.repeat(5 * 1024 * 1024), questions: [q.intent] }), { raw: true, timeoutMs: 20000 }).catch((e) => ({ status: 0, text: String(e) }))
check('oversized body (5 MiB) refused', big.status === 413 || big.status === 0, `status ${big.status}`)
const notFound = await fetch(URL_ + '/admin').then((r) => r.status)
check('unknown route → 404', notFound === 404)

// laya lane is off in this run → explicit unavailability, never a silent modelless answer
const ll = await post('/decide', all, { headers: { 'x-reflex-lane': 'laya' } })
check('laya lane off → explicit 503-class refusal', ll.status >= 400, `status ${ll.status} ${ll.text.slice(0, 100)}`)

// feedback: synthetic only
const fb = await post('/feedback', { p: 0.9, outcome: true })
check('POST /feedback accepts {p, outcome}', fb.status === 200 && typeof fb.json?.refit === 'boolean', fb.text)
const fbBad = await post('/feedback', { p: 'high' })
check('malformed feedback → 400', fbBad.status === 400)

// timeout: a client that opens and never sends must not hold the server (READ_TIMEOUT 10 s)
const stuck = net.connect(Number(u.port), u.hostname)
await new Promise((r) => stuck.on('connect', r))
const during = await post('/decide', all)
check('server answers while another client is stuck', during.status === 200, `${Math.round(during.ms)} ms`)
const closedAt = await new Promise((resolve) => { const t0 = Date.now(); stuck.on('close', () => resolve(Date.now() - t0)); setTimeout(() => resolve(-1), 15000) })
check('stuck client dropped by the read timeout (≤ 12 s)', closedAt >= 0 && closedAt <= 12000, `${closedAt} ms`)

// concurrency: 64 parallel requests, all valid, all identical
const many = await Promise.all(Array.from({ length: 64 }, () => post('/decide', all)))
check('64 concurrent requests all 200 + wire-valid', many.every((r) => r.status === 200 && wireError(all, r.json) === null))
check('concurrent answers identical (no shared-state race)', new Set(many.map((r) => JSON.stringify(r.json.answers))).size === 1)

// latency
const lat = []
for (let i = 0; i < 200; i++) lat.push((await post('/decide', decide(`synthetic ${i}: stock of pizza flour at On Nut`))).ms)
lat.sort((a, b) => a - b)
const pct = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] * 100) / 100
const latency = { n: lat.length, p50: pct(0.5), p95: pct(0.95), max: Math.round(lat.at(-1) * 100) / 100 }
check('latency p95 < 50 ms (single question, loopback)', latency.p95 < 50, JSON.stringify(latency))

const failed = checks.filter((c) => !c.ok)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), url: URL_, health: h, latency, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1))
console.log(`\n${checks.length - failed.length}/${checks.length} passed → ${OUT}`)
process.exitCode = failed.length ? 1 : 0
