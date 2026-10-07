// G11 exit gate: there is no Agent → database path. Everything under src/agent is pure, and
// so is everything it imports, transitively: no backend, services, data layer, commands,
// Firebase or network. The same idea as suggest-only.test.ts for src/intel, but following
// imports, so a helper that later grows a backend import fails here too.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AGENT = join(ROOT, 'src', 'agent')

/** Directories under src/ that can write or talk to the outside. */
const FORBIDDEN_DIRS = ['backend', 'services', 'data', 'firebase', 'commands', 'auth', 'components', 'pages', 'supplier', 'pwa', 'share']
/** Package imports that can reach a database or the network. Agent code imports no packages. */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}

const imports = (src: string) => [...src.matchAll(IMPORT_RE)].map((m) => ({ spec: m[1] ?? m[2] ?? m[3], typeOnly: /^\s*(import|export)\s+type\s/.test(m[0]) }))
const specifiers = (src: string) => imports(src).map((i) => i.spec)

/** Every file reachable from src/agent through relative imports, with any bad edge found. */
function closure() {
  const seen = new Set<string>()
  const problems: string[] = []
  const queue = walk(AGENT)
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const rel = relative(ROOT, file).split(sep).join('/')
    const src = readFileSync(file, 'utf8')
    for (const { spec, typeOnly } of imports(src)) {
      if (!spec.startsWith('.')) {
        problems.push(`${rel} imports package ${spec}`)
        continue
      }
      const target = resolveImport(file, spec)
      if (!target) {
        problems.push(`${rel} imports unresolved ${spec}`)
        continue
      }
      const top = relative(join(ROOT, 'src'), target).split(sep)[0]
      if (FORBIDDEN_DIRS.includes(top)) problems.push(`${rel} imports ${relative(ROOT, target).split(sep).join('/')}`)
      // A type-only import is erased at build: its target never runs, so it is not followed.
      else if (!typeOnly) queue.push(target)
    }
    if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|indexedDB|localStorage|navigator\.sendBeacon/.test(src)) problems.push(`${rel} touches the network or storage`)
  }
  return { files: [...seen].map((f) => relative(ROOT, f).split(sep).join('/')).sort(), problems }
}

describe('G11: no Agent → database path', () => {
  test('src/agent exists and is not empty', () => {
    expect(walk(AGENT).length).toBeGreaterThan(0)
  })

  test('nothing reachable from src/agent can write, read Firestore or reach the network', () => {
    const { files, problems } = closure()
    expect(problems).toEqual([])
    expect(files.some((f) => f.startsWith('src/agent/'))).toBe(true)
  })

  test('the checker catches a backend import (so a pass means something)', () => {
    const src = "import { backend } from '../backend'\nexport * from \"../services/stock\"\nconst x = await import('firebase/firestore')"
    expect(specifiers(src)).toEqual(['../backend', '../services/stock', 'firebase/firestore'])
  })

  test('no forbidden action has a code path that performs it', () => {
    for (const f of walk(AGENT)) {
      const src = readFileSync(f, 'utf8')
      // Executing anything is Phase H. Names such as executeProposal / applyProposal must not appear.
      expect(src, f).not.toMatch(/\b(execute|apply|perform|run)(Proposal|Action)\b/)
    }
  })
})
