#!/usr/bin/env node
// G15/G16 — write the agent-safety dataset (datasets/agent-safety/v1). Seeded: the same bytes every run.
//
//   npm run safety:dataset            regenerate scenarios.jsonl, attacks.jsonl, manifest.json
//   npm run safety:dataset -- --check fail if the files on disk differ from a fresh build
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'datasets/agent-safety/v1')
const check = process.argv.includes('--check')
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { build } = await vite.ssrLoadModule('/src/agent/safety/dataset.ts')
  const b = build()
  const manifest = { ...b.manifest, sha256: { 'scenarios.jsonl': sha(b.scenarios), 'attacks.jsonl': sha(b.attacks) } }
  const files = { 'scenarios.jsonl': b.scenarios, 'attacks.jsonl': b.attacks, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' }
  if (check) {
    const stale = Object.entries(files).filter(([f, body]) => !existsSync(resolve(dir, f)) || readFileSync(resolve(dir, f), 'utf8') !== body)
    if (stale.length) {
      console.error(`agent-safety/v1 is out of date: ${stale.map(([f]) => f).join(', ')} — run npm run safety:dataset`)
      process.exitCode = 1
    } else console.log(`agent-safety/v1 up to date (${manifest.scenarios.total} scenarios, ${manifest.attacks.total} attacks)`)
  } else {
    mkdirSync(dir, { recursive: true })
    for (const [f, body] of Object.entries(files)) writeFileSync(resolve(dir, f), body)
    console.log(JSON.stringify(manifest, null, 2))
  }
} finally {
  await vite.close()
}
