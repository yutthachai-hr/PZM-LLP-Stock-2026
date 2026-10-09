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
  // G17: the System-1 message set lives beside v1, in its own folder, so v1's pinned hashes never move.
  const laya = await vite.ssrLoadModule('/src/agent/safety/layaDataset.ts')
  const rows = laya.layaRows()
  const messages = laya.layaJsonl(rows)
  const tally = (k) => rows.reduce((t, r) => ((t[r[k]] = (t[r[k]] ?? 0) + 1), t), {})
  const layaManifest = { version: laya.LAYA_DATASET_VERSION, seed: laya.LAYA_SEED, generator: 'src/agent/safety/layaDataset.ts', synthetic: true, total: rows.length, byLang: tally('lang'), byClass: tally('inputClass'), sha256: { 'messages.jsonl': sha(messages) } }
  files['../laya-v1/messages.jsonl'] = messages
  files['../laya-v1/manifest.json'] = JSON.stringify(layaManifest, null, 2) + '\n'
  if (check) {
    const stale = Object.entries(files).filter(([f, body]) => !existsSync(resolve(dir, f)) || readFileSync(resolve(dir, f), 'utf8') !== body)
    if (stale.length) {
      console.error(`agent-safety datasets out of date: ${stale.map(([f]) => f).join(', ')} — run npm run safety:dataset`)
      process.exitCode = 1
    } else console.log(`agent-safety/v1 + laya-v1 up to date (${manifest.scenarios.total} scenarios, ${manifest.attacks.total} attacks, ${rows.length} messages)`)
  } else {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(resolve(dir, f)), { recursive: true })
      writeFileSync(resolve(dir, f), body)
    }
    console.log(JSON.stringify({ v1: manifest, layaV1: layaManifest }, null, 2))
  }
} finally {
  await vite.close()
}
