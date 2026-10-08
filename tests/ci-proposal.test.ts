// The proposed CI (docs/engineering/workflows, NOT active) stays consistent with the repo:
// every npm script it calls exists, every gate scripts/verify.mjs runs has a job, and every
// check branch protection would require is a job here. Owner turns it on (copy to .github).
//
//   npm test
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'

const wf = parse(readFileSync('docs/engineering/workflows/ci.yml', 'utf8')) as {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<string, { 'runs-on': string; 'timeout-minutes': number; steps: { uses?: string; run?: string; 'working-directory'?: string }[] }>
}
const protection = JSON.parse(readFileSync('docs/engineering/workflows/branch-protection.json', 'utf8')) as { required_status_checks: { contexts: string[] }; allow_force_pushes: boolean; allow_deletions: boolean }
const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts
const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run ?? '')).join('\n')

describe('proposed CI', () => {
  test('it is a proposal: nothing under .github/workflows yet', () => {
    expect(() => readFileSync('.github/workflows/ci.yml')).toThrow()
  })
  test('every job runs on a hosted runner with a timeout and read-only token', () => {
    expect(wf.permissions).toEqual({ contents: 'read' })
    for (const [name, j] of Object.entries(wf.jobs)) {
      expect(j['runs-on'], name).toBe('ubuntu-latest')
      expect(j['timeout-minutes'], name).toBeGreaterThan(0)
      expect(j.steps[0].uses, name).toMatch(/^actions\/checkout@/)
    }
  })
  test('every npm script it calls exists', () => {
    const called = [...runs.matchAll(/npm run -s ([\w:-]+)/g)].map((m) => m[1])
    expect(called.length).toBeGreaterThan(5)
    for (const s of called) expect(scripts[s], s).toBeTruthy()
  })
  test('it covers every gate the local verify runs, plus e2e and secrets', () => {
    for (const must of ['tsconfig.app.json', 'functions/tsconfig.json', 'worker/tsconfig.json', 'e2e/tsconfig.json', 'oxlint', 'i18n:check', 'vitest run', 'safety:dataset', 'integrity:vectors', 'safety:bench', 'cargo test', 'integrity:diff', 'test:rules', 'rules-transition.mjs --check', 'build', 'check:bundle', 'test:e2e']) {
      expect(runs, must).toContain(must)
    }
    expect(Object.values(wf.jobs).some((j) => j.steps.some((s) => s.uses?.startsWith('gitleaks/')))).toBe(true)
  })
  test('branch protection requires exactly the jobs that exist, and blocks force pushes and deletion', () => {
    expect(protection.required_status_checks.contexts.sort()).toEqual(Object.keys(wf.jobs).sort())
    expect(protection.allow_force_pushes).toBe(false)
    expect(protection.allow_deletions).toBe(false)
  })
})
