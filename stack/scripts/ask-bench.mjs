#!/usr/bin/env node
// Steps 4, 6, 7, 9 against the REAL processes on loopback:
//   Laya (laya 0.4.0, English checkpoint)    http://127.0.0.1:7340  (API key from LAYA_API_KEY_FILE)
//   Reflex 0.2.4 (modelless + laya lanes)    http://127.0.0.1:7331
//
//   LAYA_API_KEY_FILE=C:/pzm/stack/secrets/laya.key node stack/scripts/ask-bench.mjs
//     → stack/evidence/ask-bench.json
//
// Arms on ask-pzm-v1 (126 synthetic rows), reported by language and by group:
//   A guard baseline (guard + keyword router, no model)        E guard + router + Laya-python
//   B Laya-python alone (no guard, no router)                   F guard + router + Reflex modelless
//   C Reflex modelless alone                                    G guard + router + Laya-python + Reflex (must agree)
//   D Reflex Laya-Rust alone
// Then: B vs D parity on identical inputs (same checkpoint — NOT independent models), a
// services-dead pass (every client pointed at a closed port must reproduce arm A exactly), and
// process memory / CPU per runtime.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = resolve(root, 'stack/evidence/ask-bench.json')
const LAYA = 'http://127.0.0.1:7340'
const REFLEX = 'http://127.0.0.1:7331'
const apiKey = readFileSync(process.env.LAYA_API_KEY_FILE ?? 'C:/pzm/stack/secrets/laya.key', 'utf8').trim()
const TAU = 0.8 // a priori threshold for the guarded arms (E, G); B–D are measured raw (τ = 0)

const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const load = (p) => vite.ssrLoadModule(p)
const { ASK_EVAL, ASK_EVAL_VERSION } = await load('/src/agent/ask/evalSet.ts')
const { askPzm } = await load('/src/agent/ask/pipeline.ts')
const { report } = await load('/src/agent/ask/score.ts')
const { WORLD } = await load('/src/agent/ask/world.ts')
const { ASK_INTENTS } = await load('/src/agent/ask/intents.ts')
const { LayaPythonClient, ReflexModellessClient, ReflexLayaRustClient } = await load('/src/agent/ask/clients.ts')

/** The one place a network call happens: loopback only. */
const transport = async (url, body, headers, timeoutMs) => {
  const u = new URL(url)
  if (u.hostname !== '127.0.0.1') throw new Error('loopback only')
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal })
    return { status: r.status, body: await r.json().catch(() => null) }
  } finally {
    clearTimeout(t)
  }
}

// ---------------------------------------------------------------- processes ----
const pidOn = (port) => {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess | Select-Object -First 1`], { encoding: 'utf8' }).trim()
  return Number(out) || null
}
const proc = (pid) => {
  const o = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pid} | Select-Object Id,ProcessName,WorkingSet64,PeakWorkingSet64,PrivateMemorySize64,CPU,Threads | ConvertTo-Json -Compress -Depth 1`], { encoding: 'utf8' }))
  const mb = (b) => Math.round(b / 2 ** 20)
  return { pid, name: o.ProcessName, rssMb: mb(o.WorkingSet64), peakRssMb: mb(o.PeakWorkingSet64), privateMb: mb(o.PrivateMemorySize64), cpuSec: Math.round(o.CPU * 100) / 100, threads: o.Threads?.length ?? o.Threads?.Count ?? null }
}
const pids = { laya: pidOn(7340), reflex: pidOn(7331) }
if (!pids.laya || !pids.reflex) throw new Error(`services not running: ${JSON.stringify(pids)}`)
const health = {
  laya: await fetch(`${LAYA}/health`, { headers: { authorization: `Bearer ${apiKey}` } }).then((r) => r.json()),
  reflex: await fetch(`${REFLEX}/healthz`).then((r) => r.json()),
}
if (health.reflex.lanes?.laya !== 'ready') throw new Error('reflex laya lane not ready')
const before = { laya: proc(pids.laya), reflex: proc(pids.reflex) }

// ---------------------------------------------------------------- arms ----
const o = (baseUrl, extra = {}) => ({ baseUrl, transport, timeoutMs: 5000, apiKey, ...extra })
const raw = { laya: new LayaPythonClient(o(LAYA)), modelless: new ReflexModellessClient(o(REFLEX)), rust: new ReflexLayaRustClient(o(REFLEX)) }
const tau = { laya: new LayaPythonClient(o(LAYA, { minConfidence: TAU })), modelless: new ReflexModellessClient(o(REFLEX)) }
const ARMS = {
  A: { name: 'guard baseline (guard + keyword router)', cfg: { guard: true, router: true, models: [] } },
  B: { name: 'Laya-python alone (English checkpoint)', cfg: { guard: false, router: false, models: [raw.laya] } },
  C: { name: 'Reflex modelless alone (PZM rulebook)', cfg: { guard: false, router: false, models: [raw.modelless] } },
  D: { name: 'Reflex Laya-Rust alone (same checkpoint)', cfg: { guard: false, router: false, models: [raw.rust] } },
  E: { name: `guard + router + Laya-python (τ=${TAU})`, cfg: { guard: true, router: true, models: [tau.laya] } },
  F: { name: 'guard + router + Reflex modelless', cfg: { guard: true, router: true, models: [tau.modelless] } },
  G: { name: `guard + router + Laya-python (τ=${TAU}) + Reflex modelless, must agree`, cfg: { guard: true, router: true, models: [tau.laya, tau.modelless] } },
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100
}
// Warm both runtimes so the first measured row is not a cold start.
for (let i = 0; i < 3; i++) for (const c of Object.values(raw)) await c.classify('warm-up: how much flour is left?')

const arms = {}
const perRow = {}
for (const [id, arm] of Object.entries(ARMS)) {
  const results = []
  for (const row of ASK_EVAL) results.push(await askPzm(row.text, WORLD, arm.cfg))
  const rep = report(ASK_EVAL, results)
  const ms = results.map((r) => r.ms)
  const modelCalls = results.reduce((n, r) => n + r.verdicts.length, 0)
  const failures = results.flatMap((r) => r.verdicts.filter((v) => v.failure).map((v) => v.failure))
  arms[id] = { name: arm.name, ...rep, outcomes: undefined, latencyMs: { p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: pct(ms, 1) }, modelCalls, failures: failures.length, decidedBy: Object.fromEntries(['guard', 'router', 'models', 'none'].map((k) => [k, results.filter((r) => r.decidedBy === k).length])) }
  perRow[id] = results.map((r, i) => ({ id: ASK_EVAL[i].id, outcome: rep.outcomes[i], intent: r.intent, decidedBy: r.decidedBy, verdicts: r.verdicts.map((v) => ({ model: v.model, intent: v.intent, conf: Math.round(v.confidence * 1e4) / 1e4, failure: v.failure })) }))
  console.log(id, arm.name.padEnd(62), `acc ${rep.overall.accuracy}  cov ${rep.overall.coverage}  unsafe ${rep.overall.unsafe}  p95 ${arms[id].latencyMs.p95} ms`)
}

// ---------------------------------------------------------------- Step 4 parity: Python vs Rust Laya ----
const parity = { rows: 0, argmaxAgree: 0, maxAbsDiff: 0, sumAbsDiff: 0, n: 0, py: [], rs: [], byLang: {} }
for (const row of ASK_EVAL) {
  const p = await raw.laya.classify(row.text)
  const r = await raw.rust.classify(row.text)
  if (!p.probabilities || !r.probabilities) continue
  parity.rows++
  const am = (xs) => xs.indexOf(Math.max(...xs))
  const agree = am(p.probabilities) === am(r.probabilities)
  parity.argmaxAgree += agree ? 1 : 0
  const L = (parity.byLang[row.lang] ??= { rows: 0, agree: 0 })
  L.rows++
  L.agree += agree ? 1 : 0
  p.probabilities.forEach((x, i) => {
    const d = Math.abs(x - r.probabilities[i])
    parity.maxAbsDiff = Math.max(parity.maxAbsDiff, d)
    parity.sumAbsDiff += d
    parity.n++
  })
  parity.py.push(p.latencyMs)
  parity.rs.push(r.latencyMs)
}
const parityOut = { rows: parity.rows, argmaxAgreement: Math.round((parity.argmaxAgree / parity.rows) * 1000) / 1000, byLang: parity.byLang, maxAbsProbDiff: Math.round(parity.maxAbsDiff * 1e5) / 1e5, meanAbsProbDiff: Math.round((parity.sumAbsDiff / parity.n) * 1e6) / 1e6, latencyMs: { python: { p50: pct(parity.py, 0.5), p95: pct(parity.py, 0.95) }, rust: { p50: pct(parity.rs, 0.5), p95: pct(parity.rs, 0.95) } }, note: 'same checkpoint, same inputs: agreement measures the PORT, not a second opinion' }
console.log('parity', JSON.stringify(parityOut))

// ---------------------------------------------------------------- services dead ----
const dead = { laya: new LayaPythonClient(o('http://127.0.0.1:9', { minConfidence: TAU })), modelless: new ReflexModellessClient(o('http://127.0.0.1:9')) }
const deadResults = []
for (const row of ASK_EVAL) deadResults.push(await askPzm(row.text, WORLD, { guard: true, router: true, models: [dead.laya, dead.modelless] }))
const deadRep = report(ASK_EVAL, deadResults)
const sameAsA = deadRep.outcomes.every((x, i) => x === perRow.A[i].outcome)
const offline = { overall: deadRep.overall, identicalToArmA: sameAsA, failures: [...new Set(deadResults.flatMap((r) => r.verdicts.map((v) => v.failure)))] }
console.log('services dead', JSON.stringify(offline))

// ---------------------------------------------------------------- owner examples, online ----
const examples = {}
for (const q of ['ดู Stock Feta ที่อ่อนนุช', 'PO ไหนผู้ขายยังไม่ยืนยัน', 'สินค้าอะไรเสี่ยงหมดใน 7 วัน']) {
  const r = await askPzm(q, WORLD, ARMS.G.cfg)
  examples[q] = { decidedBy: r.decidedBy, intent: r.intent, answer: r.answer }
}

const after = { laya: proc(pids.laya), reflex: proc(pids.reflex) }
const out = {
  at: new Date().toISOString(),
  dataset: { version: ASK_EVAL_VERSION, rows: ASK_EVAL.length, synthetic: true },
  machine: { cpu: cpus()[0]?.model, threads: cpus().length, ramGb: Math.round(totalmem() / 2 ** 30), gpu: 'none (no NVIDIA device; nvidia-smi absent) — VRAM N/A' },
  services: { health, pins: JSON.parse(readFileSync(resolve(root, 'stack/pins.json'), 'utf8')) },
  thresholds: { guardedArms: TAU, rawArms: 0 },
  arms,
  parity: parityOut,
  servicesDead: offline,
  ownerExamples: examples,
  resources: { before, after, cpuSecDuringBench: { laya: Math.round((after.laya.cpuSec - before.laya.cpuSec) * 100) / 100, reflex: Math.round((after.reflex.cpuSec - before.reflex.cpuSec) * 100) / 100 } },
  intents: ASK_INTENTS,
  perRow,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log('resources', JSON.stringify(out.resources))
console.log('→', OUT)
await vite.close()
