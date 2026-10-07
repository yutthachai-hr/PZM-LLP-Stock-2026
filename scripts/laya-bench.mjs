#!/usr/bin/env node
// G17 — System-1 benchmark and the A–G arm table.
//
//   npm run laya:bench
//     → docs/evidence/data/laya-bench-<client>.json   (laya-v1, by language and input class)
//     → docs/evidence/data/safety-arms.json           (arms A–G on agent-safety/v1; missing components NOT_RUN)
//
// Clients available here: the R0 keyword baseline only. A real Laya / KatGPT-rs / Reflex adapter is
// registered in ADAPTERS below once supplied; nothing is scored for a component that is absent.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpus, totalmem, platform, arch, release } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

function pinned(dir, files) {
  const m = JSON.parse(read(`${dir}/manifest.json`))
  const rows = []
  for (const f of files) {
    const body = read(`${dir}/${f}`)
    if (sha(body) !== m.sha256[f]) throw new Error(`${dir}/${f} does not match its manifest sha256`)
    for (const l of body.split('\n')) if (l.trim()) rows.push(JSON.parse(l))
  }
  return { manifest: m, rows }
}

function machine() {
  const gpu = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader'], { encoding: 'utf8' })
  return {
    platform: `${platform()}-${arch()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    ramGb: Math.round(totalmem() / 2 ** 30),
    gpu: gpu.status === 0 ? gpu.stdout.trim() : 'none detected (nvidia-smi not available)',
    note: 'the development machine, not the production host',
  }
}

const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { benchLaya } = await vite.ssrLoadModule('/src/agent/laya/bench.ts')
  const { keywordBaseline } = await vite.ssrLoadModule('/src/agent/laya/baseline.ts')
  const { ARMS, buildArm } = await vite.ssrLoadModule('/src/agent/laya/arms.ts')
  const { bench } = await vite.ssrLoadModule('/src/agent/safety/bench.ts')

  // Adapters for components not in this repo. Leave empty until the owner supplies them.
  const ADAPTERS = { laya: undefined, kat: undefined, reflex: undefined }
  const SYSTEM1_CLIENTS = [keywordBaseline] // + a Laya client once supplied

  const laya = pinned('datasets/agent-safety/laya-v1', ['messages.jsonl'])
  for (const client of SYSTEM1_CLIENTS) {
    const report = await benchLaya(client, laya.rows, `${laya.manifest.version} sha256:${laya.manifest.sha256['messages.jsonl'].slice(0, 12)}`)
    const out = { generatedAt: new Date().toISOString(), machine: machine(), caveat: client.info.name === 'keyword-baseline' ? 'R0 keyword baseline written alongside the templates: its scores are inflated and are a harness check / floor, not evidence about real traffic.' : undefined, ...report }
    writeFileSync(resolve(root, `docs/evidence/data/laya-bench-${client.info.name}.json`), JSON.stringify(out, null, 2) + '\n')
    const o = report.overall
    console.log(`${client.info.name}: rows ${report.rows} · intent ${o.intent} · completeness ${o.completenessExact} · injection recall ${o.injectionRecall} fa ${o.injectionFalseAlarm} · ECE ${report.calibration.ece} · threshold ${report.calibration.threshold.threshold} · unsafe auto-routes ${report.routing.unsafeAutoRoutes}`)
    for (const [k, v] of Object.entries(report.byLang)) console.log(`  ${k.padEnd(6)} intent ${v.intent} route ${v.route}`)
  }

  const safety = pinned('datasets/agent-safety/v1', ['scenarios.jsonl', 'attacks.jsonl'])
  const arms = ARMS.map((spec) => {
    const b = buildArm(spec, ADAPTERS)
    if (b.status === 'NOT_RUN') return { id: b.id, name: b.name, status: 'NOT_RUN', reason: `not supplied: ${b.missing.join(', ')}` }
    const r = bench(b.id, b.arm, safety.rows, safety.manifest.version)
    return { id: b.id, name: b.name, status: 'RUN', models: b.models, metrics: r.metrics, misses: r.misses.length }
  })
  writeFileSync(resolve(root, 'docs/evidence/data/safety-arms.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dataset: safety.manifest.version, arms }, null, 2) + '\n')
  for (const a of arms) console.log(`arm ${a.id} ${a.name.padEnd(36)} ${a.status}${a.status === 'RUN' ? ` · unsafe-allow ${a.metrics.unsafeAllowed}/${a.metrics.unsafeTotal} · false reject ${a.metrics.safeDenied}/${a.metrics.safeTotal}` : ` · ${a.reason}`}`)
} finally {
  await vite.close()
}
