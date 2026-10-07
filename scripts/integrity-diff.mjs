#!/usr/bin/env node
// G21 — differential test: the TypeScript reference and the Rust engine on fresh random
// snapshots, beyond the committed vectors. Any disagreement fails (exit 1) and is printed with
// its seed, so it can be turned into a vector.
//
//   npm run integrity:diff                       500 snapshots, a new seed each run (printed)
//   npm run integrity:diff -- --n 2000 --seed 42 reproduce a run
//
// Builds the release CLI first (cargo, from crates/pzm-integrity).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = resolve(root, 'crates/pzm-integrity')
const flag = (name, d) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : d)
const N = flag('--n', 500)
const SEED = flag('--seed', Date.now() % 2 ** 31)
const win = process.platform === 'win32'
const cargo = [join(homedir(), '.cargo', 'bin', win ? 'cargo.exe' : 'cargo'), 'cargo'].find((c) => c === 'cargo' || existsSync(c))

const built = spawnSync(cargo, ['build', '--release', '--quiet'], { cwd: crate, stdio: 'inherit' })
if (built.status !== 0) {
  console.error('cargo build failed')
  process.exit(1)
}
const exe = resolve(crate, 'target/release', win ? 'pzm-integrity.exe' : 'pzm-integrity')

const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { randomCases, handCases } = await vite.ssrLoadModule('/src/agent/integrityVectors.ts')
  const { checkIntegrity } = await vite.ssrLoadModule('/src/agent/integrityReference.ts')
  // Fresh random worlds from the run's seed, plus the hand-made edges (cheap, and they cover NaN rates).
  const cases = [...handCases(), ...randomCases(N, SEED)]
  // JSON carries what the Rust side reads: a NaN rate goes over as null, as in the vectors.
  const inputs = cases.map(([, s]) => JSON.parse(JSON.stringify(s)))
  const ts = cases.map(([, s]) => checkIntegrity(s))
  const run = spawnSync(exe, ['--batch'], { input: inputs.map((s) => JSON.stringify(s)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 30 })
  if (run.status !== 0) throw new Error(`rust --batch exited ${run.status}: ${run.stderr}`)
  const rs = run.stdout.trim().split('\n').map((l) => JSON.parse(l))
  if (rs.length !== ts.length) throw new Error(`rust answered ${rs.length} of ${ts.length}`)
  const diffs = []
  for (let i = 0; i < ts.length; i++) if (!isDeepStrictEqual(ts[i], rs[i])) diffs.push({ case: cases[i][0], ts: ts[i], rust: rs[i] })
  const findings = ts.reduce((n, r) => n + r.findings.length, 0)
  console.log(`integrity diff: seed ${SEED}, ${ts.length} snapshots (${findings} findings), ${diffs.length} disagreement(s)`)
  for (const d of diffs.slice(0, 5)) console.log(JSON.stringify(d, null, 1).slice(0, 3000))
  if (diffs.length) process.exitCode = 1
} finally {
  await vite.close()
}
