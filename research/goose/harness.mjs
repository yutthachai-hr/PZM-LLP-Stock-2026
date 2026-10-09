#!/usr/bin/env node
// R&D (Goose evaluation, 8 Oct 2026). Isolated: reads no database, writes nothing outside
// the research folder (default C:\pzm-research, outside the repo and OneDrive).
//
//   node research/goose/harness.mjs build            goose compiler (pinned) → integrity.c → integrity.exe
//   node research/goose/harness.mjs diff [--n 500 --seed S]   TS reference vs Rust vs Goose
//   node research/goose/harness.mjs bench [--sizes 1000,10000,60000,250000,1000000]
//
// Toolchain (portable, SHA-256-checked; see docs/research/goose-feasibility.md):
//   C:\pzm-research\tools\cmake-4.4.4-windows-x86_64, llvm-mingw-20261006-ucrt-x86_64, ninja
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

export const GOOSE_SHA = '9ddd83ce45816dd95d624c3f5a35fb50167f1d6d'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const here = resolve(root, 'research/goose')
const R = process.env.PZM_RESEARCH ?? 'C:\\pzm-research'
const tools = join(R, 'tools')
const cmake = join(tools, 'cmake-4.4.4-windows-x86_64', 'bin', 'cmake.exe')
const llvm = join(tools, 'llvm-mingw-20261006-ucrt-x86_64', 'bin')
const ninja = join(tools, 'ninja')
const out = join(R, 'out')
const gooseSrc = join(R, 'goose')
const gooseBuild = join(R, 'goose-build')
const gooseExe = join(gooseBuild, 'goose.exe')
const integrityExe = join(out, 'integrity.exe')
const rustExe = resolve(root, 'crates/pzm-integrity/target/release/pzm-integrity.exe')
const env = { ...process.env, PATH: `${llvm};${ninja};${dirname(cmake)};${process.env.PATH}` }
const flag = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)

function run(cmd, args, opts = {}) {
  const t = performance.now()
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 1 << 30, ...opts })
  const ms = performance.now() - t
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
  return { ...r, ms }
}

async function withTs(fn) {
  const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const ref = await vite.ssrLoadModule('/src/agent/integrityReference.ts')
    const vec = await vite.ssrLoadModule('/src/agent/integrityVectors.ts')
    const flat = await vite.ssrLoadModule('/research/goose/flat.ts')
    return await fn({ ...ref, ...vec, ...flat })
  } finally {
    await vite.close()
  }
}

// ---------------------------------------------------------------- build ----
function build() {
  mkdirSync(out, { recursive: true })
  const head = run('git', ['-C', gooseSrc, 'rev-parse', 'HEAD']).stdout.trim()
  if (head !== GOOSE_SHA) throw new Error(`goose checkout is ${head}, pinned ${GOOSE_SHA}`)
  const timings = {}
  if (!existsSync(gooseExe)) {
    timings.configureMs = run(cmake, ['-S', gooseSrc, '-B', gooseBuild, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_COMPILER=clang', '-DCMAKE_CXX_COMPILER=clang++',
      '-DGOOSE_GFX=OFF', '-DGOOSE_AUDIO=OFF', '-DGOOSE_PHYSICS=OFF', '-DGOOSE_UI=OFF', '-DGOOSE_LIBTCC=OFF']).ms
    timings.compilerBuildMs = run(cmake, ['--build', gooseBuild]).ms
  }
  const gen = run(gooseExe, ['--standalone', '--include', join(here, 'bits.h'), '-o', join(out, 'integrity.c'), join(here, 'integrity.goose')], { cwd: gooseSrc })
  timings.gooseToCMs = gen.ms
  timings.cToExeMs = run('clang', ['-O2', '-o', integrityExe, join(out, 'integrity.c'), '-lm']).ms
  const sizes = { gooseCompilerBytes: statSync(gooseExe).size, generatedCBytes: statSync(join(out, 'integrity.c')).size, integrityExeBytes: statSync(integrityExe).size, rustExeBytes: existsSync(rustExe) ? statSync(rustExe).size : null }
  const res = { goose: GOOSE_SHA, timings, sizes, clang: run('clang', ['--version']).stdout.split('\n')[0] }
  writeFileSync(join(out, 'build.json'), JSON.stringify(res, null, 2))
  console.log(JSON.stringify(res, null, 2))
}

// ---------------------------------------------------------------- extra edges ----
/** Cases aimed at a THIRD implementation's weak spots: string keys, escaping, absent vs empty. */
function extraCases(base) {
  const c = (name, f) => { const s = structuredClone(base); f(s); return [name, s] }
  const mv = (o) => ({ id: 'mx', productId: 'p_mozz', qty: 1, date: Date.UTC(2026, 8, 10), createdAt: Date.UTC(2026, 8, 10), ...o })
  return [
    c('key-collision', (s) => { s.locations.push({ id: 'a__b' }, { id: 'a' }); s.products.push({ id: 'c', unitType: 'KG' }, { id: 'b__c', unitType: 'KG' }); s.movements.push(mv({ id: 'k1', productId: 'c', toLocationId: 'a__b', qty: 2 }), mv({ id: 'k2', productId: 'b__c', toLocationId: 'a', qty: 3 })) }),
    c('transfer-id-with-slash', (s) => { s.transfers.push({ id: 'tr/x', status: 'completed', fromLocationId: 'loc_suk', toLocationId: 'loc_onnut' }); s.movements.push(mv({ id: 't1', toLocationId: 'transit', fromLocationId: 'loc_suk', transferId: 'tr/x', qty: 4 })) }),
    c('empty-vs-absent-po', (s) => { s.orders.push({ id: '', status: 'received', locationId: 'loc_suk', lines: [{ productId: 'p_mozz', receivedQty: 5 }] }); s.movements.push(mv({ id: 'e1', toLocationId: 'loc_suk', poId: '', qty: 5 }), mv({ id: 'e2', toLocationId: 'loc_suk', qty: 7 })) }),
    c('duplicate-level-last-wins', (s) => { const l = s.levels[0]; s.levels.push({ ...l, qty: l.qty + 9 }) }),
    c('duplicate-transfer-last-wins', (s) => { s.transfers.push({ id: 'tdup', status: 'inTransit', fromLocationId: 'loc_suk', toLocationId: 'loc_onnut' }, { id: 'tdup', status: 'completed', fromLocationId: 'loc_suk', toLocationId: 'loc_onnut' }); s.movements.push(mv({ id: 'td', fromLocationId: 'loc_suk', toLocationId: 'transit', transferId: 'tdup', qty: 1 })) }),
    c('duplicate-closed-period-last-wins', (s) => { s.closedPeriods.push({ locationId: 'loc_suk', month: '2026-09', postedAt: Date.UTC(2026, 8, 30) }, { locationId: 'loc_suk', month: '2026-09', postedAt: Date.UTC(2026, 8, 1) }); s.movements.push(mv({ id: 'pl', toLocationId: 'loc_suk', createdAt: Date.UTC(2026, 8, 15) })) }),
    c('lock-override-whitespace', (s) => { s.closedPeriods.push({ locationId: 'loc_suk', month: '2026-09', postedAt: Date.UTC(2026, 8, 1) }); s.movements.push(mv({ id: 'w1', toLocationId: 'loc_suk', lockOverride: '  \t ' }), mv({ id: 'w2', toLocationId: 'loc_suk', lockOverride: ' reason ' })) }),
    c('escaping-in-ids', (s) => { s.movements.push(mv({ id: 'q"\\\t\n\u0000x', productId: 'nope"\\', toLocationId: 'loc\tX' })) }),
    c('thai-and-case-units', (s) => { s.products.push({ id: 'pth', unitType: ' กก. ', unitConversions: [{ label: 'ถุง', size: 500, of: 'กรัม' }, { label: 'BOX', size: 2, of: 'box' }, { label: 'Crate', size: 3, of: 'CASE' }] }) }),
    c('empty-string-locations', (s) => { s.movements.push(mv({ id: 'z1', fromLocationId: '', toLocationId: '' }), mv({ id: 'z2', operationId: '', transferId: '' })) }),
    c('nan-per', (s) => { s.products[0].unitConversions = [{ label: 'X', size: 2, per: Number.NaN }] }),
    c('rounding-boundaries', (s) => { for (const [i, q] of [0.0005, 0.0015, 0.0025, -0.0005, 1.0005, 2.675, 1e-4, 0.1 + 0.2].entries()) s.movements.push(mv({ id: `r${i}`, toLocationId: 'loc_suk', qty: q })) }),
    c('concurrent-same-op', (s) => { for (const id of ['c3', 'c1', 'c2']) s.movements.push(mv({ id, toLocationId: 'loc_suk', operationId: 'op-race', poId: 'po_x' })) }),
  ]
}

// ---------------------------------------------------------------- diff ----
async function diff() {
  const N = Number(flag('--n', '500'))
  const SEED = Number(flag('--seed', String(Date.now() % 2 ** 31)))
  await withTs(async ({ checkIntegrity, handCases, randomCases, cleanWorld, flatten }) => {
    const vectors = readdirSync(resolve(root, 'crates/pzm-integrity/vectors')).filter((f) => f.endsWith('.json')).sort()
      .map((f) => { const v = JSON.parse(readFileSync(resolve(root, 'crates/pzm-integrity/vectors', f), 'utf8')); return [`vector:${v.name}`, v.input, v.expected] })
    const base = (handCases().find(([n]) => n === 'clean') ?? [null, cleanWorld?.()])[1]
    const cases = [...vectors, ...handCases().map(([n, s]) => [`hand:${n}`, s]), ...extraCases(base).map(([n, s]) => [`extra:${n}`, s]), ...randomCases(N, SEED).map(([n, s]) => [`random:${n}`, s])]
    // As the Rust CLI is handed: JSON. A NaN rate travels as null, read back as NaN.
    const inputs = cases.map(([, s]) => JSON.parse(JSON.stringify(s)))
    const ts = cases.map(([, s]) => checkIntegrity(s))
    const rs = run(rustExe, ['--batch'], { input: inputs.map((s) => JSON.stringify(s)).join('\n') + '\n' }).stdout.trim().split('\n').map((l) => JSON.parse(l))
    const flats = []
    const refused = []
    for (let i = 0; i < cases.length; i++) {
      try { flats.push(flatten(cases[i][1])) } catch (e) { flats.push('S\nE\n'); refused.push(cases[i][0] + ': ' + e.message) }
    }
    const g = run(integrityExe, ['--batch'], { input: flats.join('') })
    const gs = g.stdout.trim().split('\n').map((l) => JSON.parse(l))
    const rows = []
    let tsRust = 0, tsGoose = 0, goldenMiss = 0
    for (let i = 0; i < cases.length; i++) {
      const [name, , golden] = cases[i]
      // The reference: a golden vector's committed report (generated from the in-memory world,
      // what `cargo test` checks); otherwise the TS reference on the original object.
      const ref = golden ?? ts[i]
      if (golden && vectorTsMismatch(ts[i], golden)) goldenMiss++
      const a = isDeepStrictEqual(ref, rs[i])
      const b = isDeepStrictEqual(ref, gs[i])
      if (!a) tsRust++
      if (!b) tsGoose++
      if (!a || !b) rows.push({ case: name, rustAgrees: a, gooseAgrees: b, reference: ref, rust: a ? '=' : rs[i], goose: b ? '=' : gs[i] })
    }
    const findings = ts.reduce((n, r) => n + r.findings.length, 0)
    const res = { referenceRule: 'golden vector report, else TS reference on the original object', seed: SEED, cases: cases.length, vectors: vectors.length, findings, goldenMismatches: goldenMiss, tsVsRust: tsRust, tsVsGoose: tsGoose, refusedByFlat: refused, disagreements: rows.slice(0, 20) }
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `diff-${SEED}.json`), JSON.stringify(res, null, 1))
    console.log(`three-way diff: seed ${SEED}, ${cases.length} cases (${vectors.length} golden vectors, ${findings} findings) — TS vs golden (non-NaN) ${goldenMiss}, reference≠Rust ${tsRust}, reference≠Goose ${tsGoose}, refused by contract ${refused.length}`)
    for (const r of rows.slice(0, 5)) console.log(JSON.stringify(r).slice(0, 1500))
    if (goldenMiss || tsRust || tsGoose) process.exitCode = 1
  })
}

// ---------------------------------------------------------------- bench ----
/** TS on a vector's JSON round-trip can differ from its golden report only where JSON turned NaN into null. */
const vectorTsMismatch = (ts, golden) => !isDeepStrictEqual(ts, golden) && !JSON.stringify(golden).includes('NaN')
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))].toFixed(3) }

/** Peak working set (MB) and wall time of one process run, sampled by PowerShell while it runs. */
function peak(exe, args, inputFile) {
  const ps1 = `$p = New-Object System.Diagnostics.Process; $p.StartInfo.FileName = '${exe}'; $p.StartInfo.Arguments = '${args.join(' ')}'; $p.StartInfo.UseShellExecute = $false; $p.StartInfo.RedirectStandardInput = $true; $p.StartInfo.RedirectStandardOutput = $true; $sw = [Diagnostics.Stopwatch]::StartNew(); [void]$p.Start(); $o = $p.StandardOutput.ReadToEndAsync(); $bytes = [IO.File]::ReadAllBytes('${inputFile}'); $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.Close(); $peak = 0; $cpu = 0; while (-not $p.HasExited) { try { $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 }; $cpu = $p.TotalProcessorTime.TotalMilliseconds } catch {}; Start-Sleep -Milliseconds 2 }; [void]$o.Result; $sw.Stop(); "$([math]::Round($peak / 1MB, 1)) $($sw.Elapsed.TotalMilliseconds) $cpu"`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps1], { encoding: 'utf8' })
  const [mb, wall, cpu] = r.stdout.trim().split(/\s+/).map(Number)
  return { peakMb: mb || null, wallMs: wall, cpuMs: cpu || null }
}

async function bench() {
  const sizes = flag('--sizes', '1000,10000,60000,250000,1000000').split(',').map(Number)
  const RUNS = Number(flag('--runs', '15'))
  await withTs(async ({ checkIntegrity, largeSnapshot, flatten }) => {
    const results = []
    for (const n of sizes) {
      const snap = largeSnapshot(n)
      const json = JSON.stringify(snap)
      const tFlat = performance.now(); const flat = flatten(snap); const flatMs = performance.now() - tFlat
      const jf = join(out, `bench-${n}.json`); writeFileSync(jf, json + '\n')
      const ff = join(out, `bench-${n}.flat`); writeFileSync(ff, flat)
      // TypeScript, in process: parse once (serialization), then the check warm.
      let t = performance.now(); const parsed = JSON.parse(json); const tsParseMs = performance.now() - t
      t = performance.now(); const tsReport = checkIntegrity(parsed); const tsFirstMs = performance.now() - t
      const tsWarm = []; for (let i = 0; i < RUNS; i++) { t = performance.now(); checkIntegrity(snap); tsWarm.push(performance.now() - t) }
      // Rust and Goose: in-process timings from their own --bench, then whole-process runs.
      const rsBench = JSON.parse(run(rustExe, [jf, '--bench', String(RUNS)], { allowFail: true }).stderr.trim().split('\n').pop())
      const gBench = JSON.parse(run(integrityExe, ['--bench', String(RUNS)], { input: flat }).stderr.trim().split('\n').pop())
      const rsWall = [], gWall = []
      for (let i = 0; i < 5; i++) { rsWall.push(run(rustExe, ['--batch'], { input: json + '\n' }).ms); gWall.push(run(integrityExe, ['--batch'], { input: flat }).ms) }
      const rsOut = JSON.parse(run(rustExe, ['--batch'], { input: json + '\n' }).stdout.trim())
      const gOut = JSON.parse(run(integrityExe, ['--batch'], { input: flat }).stdout.trim())
      const rsPeak = peak(rustExe, ['--batch'], jf), gPeak = peak(integrityExe, ['--batch'], ff)
      const row = {
        movements: n, jsonBytes: json.length, flatBytes: flat.length, findings: tsReport.findings.length,
        sameReport: { rust: isDeepStrictEqual(tsReport, rsOut), goose: isDeepStrictEqual(tsReport, gOut) },
        ts: { parseMs: +tsParseMs.toFixed(2), firstCheckMs: +tsFirstMs.toFixed(2), warmP50: pct(tsWarm, 0.5), warmP95: pct(tsWarm, 0.95) },
        rust: { inProcess: rsBench, processWallP50: pct(rsWall, 0.5), peak: rsPeak },
        goose: { flattenMs: +flatMs.toFixed(2), inProcess: gBench, processWallP50: pct(gWall, 0.5), peak: gPeak },
      }
      results.push(row)
      console.log(JSON.stringify(row))
    }
    writeFileSync(join(out, 'bench.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, runs: RUNS, results }, null, 1))
  })
}

const cmd = process.argv[2]
if (cmd === 'build') build()
else if (cmd === 'diff') await diff()
else if (cmd === 'bench') await bench()
else console.log('usage: build | diff | bench')
