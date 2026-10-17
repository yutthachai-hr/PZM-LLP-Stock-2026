// Reports Thai UI text that would still render untranslated, and dictionary entries that
// no longer match anything in the code.
//
//   npm run i18n:check
//
// Two failure modes it catches:
//   1. A Thai string that never passes through t()  -> stays Thai in English mode.
//   2. A t('...') key with no entry in en.ts        -> falls back to Thai silently.
//
// Product names, SKUs and other stored data are not UI copy, so their files are skipped.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EN } from '../src/i18n/en.ts'
import { dictionaryProblems, translationCalls } from './i18n-audit.mjs'

// Reviewed Thai data within English copy: exact accepted spreadsheet headings and the
// native language name. Match the whole value so new Thai copy cannot inherit an exemption.
const THAI_DATA_VALUES = {
  'ไฟล์ .xlsx / .xls ที่มีคอลัมน์ ชื่อวัตถุดิบ · หน่วย · จำนวนสั่ง': 'An .xlsx / .xls with the columns ชื่อวัตถุดิบ · หน่วย · จำนวนสั่ง',
  'ไฟล์ต้องมีคอลัมน์ SKU (หรือ "รหัสสินค้า") และ Barcode (หรือ "บาร์โค้ด") — SKU ยังเป็นกุญแจหลัก ไม่มีการสร้างสินค้าใหม่': 'The file needs an SKU column (or "รหัสสินค้า") and a Barcode column (or "บาร์โค้ด"). SKU stays the key — no product is created.',
  'ไทย': 'ไทย',
}

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const SKIP = /catalog\.generated|sarabunFont|[\\/]i18n[\\/]/
// Files that legitimately hold Thai as data or as translation keys, not as rendered copy.
// lib/orderSheet.ts holds the Thai column headings of the company's own order workbook
// (lib/sheetLines.ts the header words of any plain sheet):
// data it reads, never copy it shows. lib/siteTone.ts matches the sites' own Thai names;
// lib/inventoryRules/uom.ts the Thai spellings of gram / kilogram / litre it accepts;
// lib/productMatch.ts the Thai unit words it ignores when ranking names.
// seed/wip.ts is the work-in-process catalogue: names and units as the workbook writes them.
const DATA_ONLY = /types\.ts$|[\\/]services[\\/]|[\\/]seed[\\/](products|wip)\.ts$|[\\/]lib[\\/](orderSheet|sheetLines|productSuggest|productMatch|siteTone)\.ts$|[\\/]inventoryRules[\\/]uom\.ts$/

const THAI = /[฀-๿]/

// Keys the services write into stored records and that screens translate through a
// variable — t(note), t(title). No literal t('…') exists for them to be found by.
const DYNAMIC = new Set(['ตั้งยอดคงเหลือ', '(ไม่มีหัวข้อ)'])

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p) && !SKIP.test(p)) out.push(p)
  }
  return out
}

const untranslated = []
const usedKeys = new Set()
const auditProblems = dictionaryProblems(EN, THAI_DATA_VALUES)

for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(file.indexOf('src'))

  // Every key that reaches the dictionary, so unused entries can be spotted. Three routes:
  // a direct t(), an AppError thrown by a service, and constant tables whose Thai is
  // marked `i18n-key` and translated wherever it is rendered.
  const calls = translationCalls(src, rel)
  for (const key of calls.keys) usedKeys.add(key)
  auditProblems.push(...calls.problems)
  for (const line of src.split('\n')) {
    if (!line.includes('i18n-key')) continue
    for (const m of line.matchAll(/'([^'\n]*[฀-๿][^'\n]*)'/g)) usedKeys.add(m[1])
  }
  if (DATA_ONLY.test(file)) continue

  // Blank out handled calls across the whole file first: a t(...) argument list may span
  // lines, and its string may contain the other quote character. Newlines are preserved so
  // line numbers still line up with the original.
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  const handled = src
    .replace(/\bt\(\s*'(?:[^'\\]|\\.)*'(?:\s*,\s*\{[\s\S]*?\})?\s*\)/g, blank)
    .replace(/\bt\(\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*\{[\s\S]*?\})?\s*\)/g, blank)
    .replace(/new AppError\(\s*'(?:[^'\\]|\\.)*'(?:\s*,\s*\{[\s\S]*?\})?\s*\)/g, blank)
    .replace(/\bt\(\s*`(?:[^`\\$]|\\.)*`(?:\s*,\s*\{[\s\S]*?\})?\s*\)/g, blank)

  const origLines = src.split('\n')
  handled.split('\n').forEach((line, i) => {
    if (!THAI.test(line)) return
    const orig = origLines[i]
    if (orig.trim().startsWith('//') || orig.trim().startsWith('*')) return
    // `// i18n-key` marks Thai that is a lookup key in a constant table and gets passed
    // through t() where it is rendered, rather than copy that renders from here.
    if (orig.includes('i18n-key')) return
    untranslated.push(`${rel}:${i + 1}  ${orig.trim()}`)
  })
}

const missing = [...usedKeys].filter((k) => THAI.test(k) && !(k in EN))
const unused = Object.keys(EN).filter((k) => !usedKeys.has(k) && !DYNAMIC.has(k))

if (untranslated.length) {
  console.log(`\n✗ ${untranslated.length} line(s) with Thai that never reaches t():`)
  for (const u of untranslated) console.log('  ' + u)
}
if (missing.length) {
  console.log(`\n✗ ${missing.length} key(s) used by t() but absent from en.ts:`)
  for (const m of missing) console.log('  ' + JSON.stringify(m))
}
if (unused.length) {
  console.log(`\n⚠ ${unused.length} entry/entries in en.ts that nothing uses:`)
  for (const u of unused) console.log('  ' + JSON.stringify(u))
}
if (auditProblems.length) {
  console.log(`\n✗ ${auditProblems.length} dictionary / translation-call audit problem(s):`)
  for (const problem of auditProblems) console.log('  ' + problem)
}
if (!untranslated.length && !missing.length && !auditProblems.length) {
  console.log(`\n✓ UI copy checks passed (${usedKeys.size} keys; ${Object.keys(EN).length} English entries).`)
  console.log('  Includes placeholder parity, English-copy leakage and literal/template keys; stored data and marked dynamic keys still require review.')
}

process.exit(untranslated.length || missing.length || auditProblems.length ? 1 : 0)
