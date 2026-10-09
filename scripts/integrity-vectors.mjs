#!/usr/bin/env node
// G13 — write crates/pzm-integrity/vectors from the TypeScript reference (src/agent/integrityReference.ts).
//
//   npm run integrity:vectors            regenerate
//   npm run integrity:vectors -- --check fail if the files on disk differ from a fresh build
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'crates/pzm-integrity/vectors')
const check = process.argv.includes('--check')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { vectors, vectorFile } = await vite.ssrLoadModule('/src/agent/integrityVectors.ts')
  const files = Object.fromEntries(vectors().map((v, i) => [`${String(i).padStart(3, '0')}-${v.name}.json`, vectorFile(v)]))
  if (check) {
    const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []
    const bad = [...Object.keys(files).filter((f) => !existsSync(resolve(dir, f)) || readFileSync(resolve(dir, f), 'utf8') !== files[f]), ...onDisk.filter((f) => !(f in files))]
    if (bad.length) {
      console.error(`integrity vectors out of date: ${bad.join(', ')} — run npm run integrity:vectors`)
      process.exitCode = 1
    } else console.log(`integrity vectors up to date (${onDisk.length})`)
  } else {
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(resolve(dir, f))
    mkdirSync(dir, { recursive: true })
    for (const [f, body] of Object.entries(files)) writeFileSync(resolve(dir, f), body)
    console.log(`wrote ${Object.keys(files).length} vectors to crates/pzm-integrity/vectors`)
  }
} finally {
  await vite.close()
}
