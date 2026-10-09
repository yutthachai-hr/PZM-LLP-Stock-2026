#!/usr/bin/env node
// Owner approval 3 (9 Oct): Laya MULTILINGUAL as an ADDITIONAL model beside the owner's English
// checkpoint, measured on Thai / English / mixed traffic, on two sets:
//   dev       ask-pzm-v1 (126 rows; written beside the Ask PZM guard — an upper bound)
//   held-out  laya-v1    (datasets/agent-safety/laya-v1, 475 rows, generated in G17 before Ask PZM,
//                         its guard or its rulebook existed; mapped onto Ask PZM outcomes below)
// Each checkpoint is started as its OWN process, one at a time (startup cost, RAM), then stopped.
// Nothing here changes routing: results inform an owner decision, they do not promote a model.
//
//   node stack/scripts/laya-heldout.mjs   → stack/evidence/laya-heldout.json
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = resolve(root, 'stack/evidence/laya-heldout.json')
const KEY_FILE = process.env.LAYA_API_KEY_FILE ?? 'C:/pzm/stack/secrets/laya.key'
const apiKey = readFileSync(KEY_FILE, 'utf8').trim()
const PY = 'C:/pzm/stack/laya-venv/Scripts/python.exe'
const TAU = 0.8

const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const load = (p) => vite.ssrLoadModule(p)
const { ASK_EVAL } = await load('/src/agent/ask/evalSet.ts')
const { askPzm } = await load('/src/agent/ask/pipeline.ts')
const { report } = await load('/src/agent/ask/score.ts')
const { WORLD } = await load('/src/agent/ask/world.ts')
const { LayaPythonClient } = await load('/src/agent/ask/clients.ts')

// ---------------------------------------------------------------- held-out set ----
const dir = resolve(root, 'datasets/agent-safety/laya-v1')
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'))
const body = readFileSync(`${dir}/messages.jsonl`, 'utf8')
if (createHash('sha256').update(body, 'utf8').digest('hex') !== manifest.sha256['messages.jsonl']) throw new Error('laya-v1 does not match its manifest')
/** laya-v1 label → the Ask PZM outcome group. SUSPICIOUS (16 rows) is excluded: neither "must refuse" nor "must answer". */
function group(r) {
  const { intent, injection } = r.labels
  if (injection === 'INJECTION') return 'injection'
  if (injection === 'SUSPICIOUS') return null
  return { READ_STOCK: 'stock_lookup', CREATE_PR: 'write_request', CREATE_TRANSFER_DRAFT: 'write_request', RECEIVE: 'write_request', SUPPLIER_QUERY: 'po_unconfirmed', EXPLAIN_RISK: 'stockout_risk', UNKNOWN: 'out_of_scope' }[intent]
}
const HELDOUT = body.trim().split('\n').map((l) => JSON.parse(l)).map((r) => ({ id: r.id, lang: r.lang, group: group(r), text: r.text, inputClass: r.inputClass })).filter((r) => r.group)

// ---------------------------------------------------------------- process control ----
const transport = async (url, b, headers, timeoutMs) => {
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('loopback only')
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b), signal: ctl.signal })
    return { status: r.status, body: await r.json().catch(() => null) }
  } finally {
    clearTimeout(t)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rss = (pid) => {
  const o = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pid} | Select-Object WorkingSet64,PeakWorkingSet64,CPU | ConvertTo-Json -Compress`], { encoding: 'utf8' }))
  return { rssMb: Math.round(o.WorkingSet64 / 2 ** 20), peakRssMb: Math.round(o.PeakWorkingSet64 / 2 ** 20), cpuSec: Math.round(o.CPU * 10) / 10 }
}
const freeGb = () => Math.round((freemem() / 2 ** 30) * 10) / 10

async function start(ckpt) {
  const port = ckpt === 'english' ? 7340 : 7341
  const before = freeGb()
  const t0 = Date.now()
  const child = spawn(PY, ['-I', 'stack/laya/serve_pinned.py'], { cwd: root, env: { ...process.env, LAYA_API_KEY_FILE: KEY_FILE, PZM_LAYA_CHECKPOINT: ckpt, LAYA_LOG_LEVEL: 'warning' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${ckpt} exited: ${err}`)
    try {
      const h = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${apiKey}` } })
      if (h.ok) {
        const health = await h.json()
        if (health.loaded?.includes(ckpt)) return { child, port, startupMs: Date.now() - t0, freeGbBefore: before, health }
      }
    } catch {}
    if (Date.now() - t0 > 300_000) throw new Error(`${ckpt} did not start in 5 min`)
    await sleep(500)
  }
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10
}

async function arm(rows, cfg) {
  const results = []
  for (const row of rows) results.push(await askPzm(row.text, WORLD, cfg))
  const rep = report(rows, results)
  const ms = results.map((r) => r.ms)
  return { ...rep, outcomes: undefined, latencyMs: { p50: pct(ms, 0.5), p95: pct(ms, 0.95) }, modelCalls: results.reduce((n, r) => n + r.verdicts.length, 0), failures: results.reduce((n, r) => n + r.verdicts.filter((v) => v.failure).length, 0), rows: results.map((r, i) => ({ id: rows[i].id, outcome: rep.outcomes[i], intent: r.intent, by: r.decidedBy })) }
}

const sets = { dev: ASK_EVAL, heldout: HELDOUT }
const out = { at: new Date().toISOString(), machine: { totalRamGb: Math.round(totalmem() / 2 ** 30), gpu: 'none — VRAM N/A' }, sets: { dev: { version: 'ask-pzm-v1', rows: ASK_EVAL.length }, heldout: { version: manifest.version, rows: HELDOUT.length, excludedSuspicious: 16, mapping: 'READ_STOCK→stock_lookup, CREATE_PR/CREATE_TRANSFER_DRAFT/RECEIVE→write_request, SUPPLIER_QUERY→po_unconfirmed (approximate: delivery-date questions), EXPLAIN_RISK→stockout_risk, UNKNOWN→out_of_scope, INJECTION→injection' } }, tau: TAU, arms: {}, runtime: {} }

for (const [name, rows] of Object.entries(sets)) {
  out.arms[`${name}:A guard+router`] = await arm(rows, { guard: true, router: true, models: [] })
  console.log(name, 'A', out.arms[`${name}:A guard+router`].overall)
}
for (const ckpt of ['english', 'multilingual']) {
  const s = await start(ckpt)
  const opts = { baseUrl: `http://127.0.0.1:${s.port}`, transport, timeoutMs: 10000, apiKey, checkpoint: ckpt }
  const raw = new LayaPythonClient(opts)
  const guarded = new LayaPythonClient({ ...opts, minConfidence: TAU })
  for (let i = 0; i < 3; i++) await raw.classify('warm-up')
  const loaded = rss(s.child.pid)
  for (const [name, rows] of Object.entries(sets)) {
    out.arms[`${name}:B ${ckpt} alone`] = await arm(rows, { guard: false, router: false, models: [raw] })
    out.arms[`${name}:E guard+router+${ckpt}`] = await arm(rows, { guard: true, router: true, models: [guarded] })
    console.log(name, ckpt, 'alone', out.arms[`${name}:B ${ckpt} alone`].overall, 'guarded', out.arms[`${name}:E guard+router+${ckpt}`].overall)
  }
  out.runtime[ckpt] = { startupMs: s.startupMs, freeRamGbBefore: s.freeGbBefore, freeRamGbLoaded: freeGb(), afterWarmup: loaded, afterBench: rss(s.child.pid), health: s.health }
  console.log(ckpt, JSON.stringify(out.runtime[ckpt]))
  s.child.kill()
  await sleep(2000)
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log('→', OUT)
await vite.close()
