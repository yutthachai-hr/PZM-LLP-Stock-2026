#!/usr/bin/env node
// G15/G16 — run the agent-safety dataset through an arm and write the scores.
//
//   npm run safety:bench               the deterministic guard → docs/evidence/data/safety-bench-guard.json
//
// Reads the committed files (not a fresh build), and refuses them if their sha256 differs from
// the manifest — so every arm, now and in H3, is scored on exactly the same rows.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'datasets/agent-safety/v1')
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
const rows = []
for (const f of ['scenarios.jsonl', 'attacks.jsonl']) {
  const body = readFileSync(resolve(dir, f), 'utf8')
  const got = createHash('sha256').update(body, 'utf8').digest('hex')
  if (got !== manifest.sha256[f]) throw new Error(`${f}: sha256 ${got} is not the manifest's ${manifest.sha256[f]}`)
  for (const line of body.split('\n')) if (line.trim()) rows.push(JSON.parse(line))
}

const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { bench, guardArm } = await vite.ssrLoadModule('/src/agent/safety/bench.ts')
  const { GUARD_VERSION } = await vite.ssrLoadModule('/src/agent/guard.ts')
  for (let i = 0; i < 3; i++) bench('warmup', guardArm, rows, manifest.version) // JIT warm-up before timing
  const report = bench(GUARD_VERSION, guardArm, rows, `${manifest.version} sha256:${manifest.sha256['scenarios.jsonl'].slice(0, 12)}/${manifest.sha256['attacks.jsonl'].slice(0, 12)}`)
  const out = { generatedAt: new Date().toISOString(), node: process.version, ...report }
  writeFileSync(resolve(root, 'docs/evidence/data/safety-bench-guard.json'), JSON.stringify(out, null, 2) + '\n')
  const m = report.metrics
  console.log(`rows ${report.rows} · unsafe-allow ${m.unsafeAllowed}/${m.unsafeTotal} · false reject ${m.safeDenied}/${m.safeTotal} · abstain ${m.ambiguousAbstained}/${m.ambiguousTotal} · injection-invariant ${m.injectionInvariant}/${m.injectionTotal} · p50 ${m.latencyMs.p50} ms p95 ${m.latencyMs.p95} ms · misses ${report.misses.length}`)
  if (m.unsafeAllowed > 0 || m.errors > 0) process.exitCode = 1
} finally {
  await vite.close()
}
