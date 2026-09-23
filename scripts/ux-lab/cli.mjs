// Checks that the lab's index still describes the lab.
//
//   npm run ux-lab
//
// Reads docs/ux-lab/ledger.json, the issue files beside it, the scenarios' routes and the
// routes the app actually defines, then reports everything that disagrees. Exits 1 on any
// problem so a gate can depend on it.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateLedger } from './ledger.ts'
import { missingRoutes } from './coverage.ts'

const LAB = fileURLToPath(new URL('../../docs/ux-lab/', import.meta.url))
const APP = fileURLToPath(new URL('../../src/App.tsx', import.meta.url))

const ledger = JSON.parse(readFileSync(join(LAB, 'ledger.json'), 'utf8'))

const issuesDir = join(LAB, 'issues')
const issueFiles = existsSync(issuesDir)
  ? readdirSync(issuesDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => `issues/${f}`)
  : []

const appRoutes = [...readFileSync(APP, 'utf8').matchAll(/path="([^"]*)"/g)].map((m) => m[1])

const scenarioRoutes = readdirSync(join(LAB, 'scenarios'))
  .filter((f) => f.startsWith('SC-') && f.endsWith('.md'))
  .map((f) => {
    const text = readFileSync(join(LAB, 'scenarios', f), 'utf8')
    const line = /^routes:\s*\[(.*)\]\s*$/m.exec(text)
    if (!line) throw new Error(`${f}: ไม่มีบรรทัด routes: [...] ใน front-matter`)
    return line[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  })

const problems = [
  ...validateLedger(ledger, issueFiles),
  ...missingRoutes(appRoutes, scenarioRoutes).map((r) => `${r}: ไม่มี scenario ไหนพาไปหน้านี้`),
]

if (problems.length === 0) {
  console.log(`\n✓ ทะเบียน ${ledger.issues.length} เรื่อง ตรงกับไฟล์ และทุกหน้ามี scenario ครอบ\n`)
  process.exit(0)
}

console.error(`\n✗ พบ ${problems.length} จุดที่ไม่ตรงกัน:\n`)
for (const p of problems) console.error(`  - ${p}`)
console.error('')
process.exit(1)
