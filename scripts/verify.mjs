#!/usr/bin/env node
// G14 — the mechanical gates in one command (docs/engineering/pstack-workflow.md).
//
//   npm run verify            fast gates: types, lint, unit tests, i18n, dataset/vector
//                             freshness, safety bench, Rust (when cargo is installed)
//   npm run verify -- --full  also the production build and the bundle budget
//
// The rules suite runs when Java is present (the Firestore emulator needs it). e2e and flaky runs are listed, not run: they
// stay with CI / the release gate (docs/evidence/release-gate.md).
//
// Exits non-zero if any gate fails. A gate that cannot run here (no cargo) is SKIPPED and
// said so — never counted as a pass.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const full = process.argv.includes('--full')
const win = process.platform === 'win32'
const npx = win ? 'npx.cmd' : 'npx'
const npm = win ? 'npm.cmd' : 'npm'

function cargoBin() {
  const local = join(homedir(), '.cargo', 'bin', win ? 'cargo.exe' : 'cargo')
  if (existsSync(local)) return local
  const probe = spawnSync(win ? 'where' : 'which', ['cargo'], { encoding: 'utf8' })
  return probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() : null
}
const cargo = cargoBin()

/** [name, command, args, cwd?] — or a reason string when the gate cannot run here. */
const gates = [
  ['types: app', npx, ['tsc', '-p', 'tsconfig.app.json', '--noEmit']],
  ['types: functions', npx, ['tsc', '-p', 'functions/tsconfig.json', '--noEmit']],
  ['types: worker', npx, ['tsc', '-p', 'worker/tsconfig.json', '--noEmit']],
  ['types: e2e', npx, ['tsc', '-p', 'e2e/tsconfig.json', '--noEmit']],
  ['lint', npx, ['oxlint']],
  ['unit tests', npx, ['vitest', 'run']],
  ['i18n', npm, ['run', '-s', 'i18n:check']],
  ['safety dataset fresh', npm, ['run', '-s', 'safety:dataset', '--', '--check']],
  ['integrity vectors fresh', npm, ['run', '-s', 'integrity:vectors', '--', '--check']],
  ['safety bench (unsafe-allow = 0)', npm, ['run', '-s', 'safety:bench', '--', '--no-write']],
  cargo ? ['rust: cargo test', cargo, ['test', '--release', '--quiet'], 'crates/pzm-integrity'] : ['rust: cargo test', 'cargo not installed here — run on a machine with Rust (see pstack-workflow.md)'],
  // G21: TS and Rust on fresh random snapshots (a new seed each run, printed); any disagreement fails.
  cargo ? ['differential TS ↔ Rust', npm, ['run', '-s', 'integrity:diff']] : ['differential TS ↔ Rust', 'cargo not installed here'],
  // The rules suite needs the Firestore emulator, which needs Java.
  spawnSync('java', ['-version']).status === 0 ? ['rules (emulator)', npm, ['run', '-s', 'test:rules']] : ['rules (emulator)', 'no Java here — run npm run test:rules where the emulator can start'],
  ...(full ? [['build', npm, ['run', '-s', 'build']], ['bundle budget', npm, ['run', '-s', 'check:bundle']]] : []),
]

const results = []
for (const [name, cmd, args, cwd] of gates) {
  if (typeof cmd === 'string' && !args) {
    results.push({ name, status: 'SKIPPED', ms: 0, note: cmd })
    console.log(`\n▶ ${name}: SKIPPED — ${cmd}`)
    continue
  }
  console.log(`\n▶ ${name}`)
  const t = Date.now()
  // npm/npx are .cmd scripts on Windows and need a shell; the arguments are this file's own constants.
  const viaShell = win && !cmd.endsWith('.exe')
  const r = viaShell
    ? spawnSync([cmd, ...args].join(' '), { cwd: resolve(root, cwd ?? '.'), stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { cwd: resolve(root, cwd ?? '.'), stdio: 'inherit' })
  results.push({ name, status: r.status === 0 ? 'PASS' : 'FAIL', ms: Date.now() - t })
}

console.log('\n─── verify ' + (full ? '(full) ' : '') + '───')
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name.padEnd(34)} ${r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''}${r.note ? ` ${r.note}` : ''}`)
console.log('Not run here: npm run test:e2e · flaky runs — see docs/evidence/release-gate.md')
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1
