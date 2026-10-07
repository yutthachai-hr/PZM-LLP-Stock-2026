#!/usr/bin/env node
// G13 — latency and memory of the Rust CLI against the TypeScript reference, on one large snapshot.
//
//   npm run integrity:bench [-- --movements 60000]   → docs/evidence/data/integrity-bench.json
//
// Needs a release build: (cd crates/pzm-integrity && cargo build --release)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flag = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d)
const N = flag('--movements', 60_000)
const RUNS = flag('--runs', 30)
const exe = resolve(root, 'crates/pzm-integrity/target/release', process.platform === 'win32' ? 'pzm-integrity.exe' : 'pzm-integrity')
if (!existsSync(exe)) throw new Error(`build the CLI first: cargo build --release --manifest-path crates/pzm-integrity/Cargo.toml (${exe})`)

const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))].toFixed(3) }
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { largeSnapshot } = await vite.ssrLoadModule('/src/agent/integrityVectors.ts')
  const { checkIntegrity } = await vite.ssrLoadModule('/src/agent/integrityReference.ts')
  const snap = largeSnapshot(N)
  const body = JSON.stringify(snap)
  const file = join(mkdtempSync(join(tmpdir(), 'pzm-int-')), 'snapshot.json')
  writeFileSync(file, body)

  // TypeScript: parse + check once (cold-ish), then the check alone, warm.
  global.gc?.()
  const heap0 = process.memoryUsage().heapUsed
  let t = performance.now()
  const tsReport = checkIntegrity(JSON.parse(body))
  const tsFirst = performance.now() - t
  const tsHeapMb = (process.memoryUsage().heapUsed - heap0) / 2 ** 20
  const tsTimes = []
  for (let i = 0; i < RUNS; i++) { t = performance.now(); checkIntegrity(snap); tsTimes.push(performance.now() - t) }

  // Rust: whole process wall time (cold start included), then in-process timings from --bench.
  const walls = []
  let rs
  for (let i = 0; i < 5; i++) { t = performance.now(); rs = spawnSync(exe, [file], { encoding: 'utf8', maxBuffer: 1 << 30 }); walls.push(performance.now() - t) }
  const rsReport = JSON.parse(rs.stdout)
  const benchRun = spawnSync(exe, [file, '--bench', String(RUNS)], { encoding: 'utf8', maxBuffer: 1 << 30 })
  const rsBench = JSON.parse(benchRun.stderr.trim().split('\n').pop())

  // Peak memory of the CLI process (Windows: PeakWorkingSet64; elsewhere: GNU time if present).
  let rsPeakMb = null
  if (process.platform === 'win32') {
    // Poll the process's own peak working set while it runs (Start-Process redirection drops it on exit).
    const ps1 = `$p = New-Object System.Diagnostics.Process; $p.StartInfo.FileName = '${exe}'; $p.StartInfo.Arguments = '"${file}"'; $p.StartInfo.UseShellExecute = $false; $p.StartInfo.RedirectStandardOutput = $true; [void]$p.Start(); $peak = 0; $t = $p.StandardOutput.ReadToEndAsync(); while (-not $p.HasExited) { try { $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 } } catch {}; Start-Sleep -Milliseconds 5 }; [void]$t.Result; [math]::Round($peak / 1MB, 1)`
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', ps1], { encoding: 'utf8' })
    rsPeakMb = Number(ps.stdout.trim()) || null
  } else {
    const gt = spawnSync('/usr/bin/time', ['-f', '%M', exe, file], { encoding: 'utf8', maxBuffer: 1 << 30 })
    rsPeakMb = gt.status !== null ? Math.round(Number(gt.stderr.trim().split('\n').pop()) / 102.4) / 10 : null
  }

  const out = {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    snapshot: { movements: N, products: snap.products.length, levels: snap.levels.length, bytes: body.length },
    sameReport: JSON.stringify(tsReport) === JSON.stringify(rsReport),
    findings: tsReport.findings.length,
    typescript: { firstMsIncludingParse: +tsFirst.toFixed(3), warmP50Ms: pct(tsTimes, 0.5), warmP95Ms: pct(tsTimes, 0.95), heapDeltaMb: +tsHeapMb.toFixed(1), note: global.gc ? 'in-process, after a forced GC' : 'in-process; approximate (run with --expose-gc)' },
    rust: { processWallP50Ms: pct(walls, 0.5), processWallMaxMs: pct(walls, 1), firstMsIncludingParse: rsBench.firstMs, warmP50Ms: rsBench.p50Ms, warmP95Ms: rsBench.p95Ms, peakWorkingSetMb: rsPeakMb },
  }
  writeFileSync(resolve(root, 'docs/evidence/data/integrity-bench.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(JSON.stringify(out, null, 2))
  if (!out.sameReport) process.exitCode = 1
} finally {
  await vite.close()
}
