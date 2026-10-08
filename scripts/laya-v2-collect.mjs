#!/usr/bin/env node
// G17 / laya-v2 — turn exported real PZM messages into anonymised, unlabelled dataset rows.
//
//   npm run laya:collect -- --in exports/ --names names.json
//
// Input: a folder of text exports, one file per source, named by source:
//   line-*.txt, chat-*.txt         one message per line
//   ocr-*.txt, invoice-*.txt       one document per blank-line-separated block
//   supplier_note-*.txt            one note per line
// names.json (kept OUTSIDE the repo): { "PERSON": [...], "SUPPLIER": [...], "SITE": [...] }
//
// Output: datasets/agent-safety/laya-v2/unreviewed.jsonl — anonymised text, language, a first
// guess at the input class, EMPTY labels, `reviewed: false`. A person then:
//   1. reads every row and removes anything the anonymiser missed (an unlisted name);
//   2. fills the labels (intent, completeness, risk, injection, route, escalation);
//   3. moves the row to labelled.jsonl with `reviewed: true`.
// Only reviewed rows are used by npm run laya:bench. Raw exports never enter the repo.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined)
const inDir = arg('--in')
const namesFile = arg('--names')
if (!inDir || !existsSync(inDir)) {
  console.error('usage: npm run laya:collect -- --in <folder of exports> [--names names.json]')
  process.exit(2)
}
if (namesFile && resolve(namesFile).startsWith(root)) {
  console.error('names.json must live outside the repository — it holds the real names')
  process.exit(2)
}
const names = namesFile ? JSON.parse(readFileSync(namesFile, 'utf8')) : {}
const SOURCES = ['line', 'chat', 'ocr', 'invoice', 'supplier_note', 'document']

const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { anonymise, langOf, guessClass } = await vite.ssrLoadModule('/src/agent/safety/anonymise.ts')
  const rows = []
  const totals = {}
  for (const f of readdirSync(inDir).filter((x) => x.endsWith('.txt')).sort()) {
    const source = SOURCES.find((s) => basename(f).startsWith(`${s}-`))
    if (!source) {
      console.warn(`skipped ${f}: name it <source>-*.txt, source one of ${SOURCES.join(', ')}`)
      continue
    }
    const raw = readFileSync(join(inDir, f), 'utf8').replace(/\r\n/g, '\n')
    const items = (source === 'ocr' || source === 'invoice' || source === 'document' ? raw.split(/\n\s*\n/) : raw.split('\n')).map((s) => s.trim()).filter(Boolean)
    for (const item of items) {
      const { text, replaced } = anonymise(item, { names })
      for (const [k, n] of Object.entries(replaced)) totals[k] = (totals[k] ?? 0) + n
      // The id is a hash of the ANONYMISED text: stable across runs, and it carries nothing of the original.
      const id = 'R-' + createHash('sha256').update(text).digest('hex').slice(0, 12)
      rows.push({ id, lang: langOf(text), inputClass: guessClass(text, source), source, text, labels: null, reviewed: false })
    }
  }
  const seen = new Set()
  const unique = rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
  const out = resolve(root, 'datasets/agent-safety/laya-v2')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'unreviewed.jsonl'), unique.map((r) => JSON.stringify(r)).join('\n') + (unique.length ? '\n' : ''))
  const by = (k) => unique.reduce((t, r) => ((t[r[k]] = (t[r[k]] ?? 0) + 1), t), {})
  console.log(JSON.stringify({ rows: unique.length, duplicatesDropped: rows.length - unique.length, byLang: by('lang'), byClassGuess: by('inputClass'), replaced: totals }, null, 2))
  console.log('Next: review every row (anonymiser misses unlisted names), label, then move to labelled.jsonl with reviewed: true.')
} finally {
  await vite.close()
}
