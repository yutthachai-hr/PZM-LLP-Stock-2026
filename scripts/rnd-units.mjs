#!/usr/bin/env node
// R&D units (owner decision 4, 9 Oct 2026). All 228 R&D catalogue products have no unit; no
// stock entry may use them until an owner states one. This tool NEVER fills in a unit and NEVER
// writes the database:
//
//   node scripts/rnd-units.mjs template [--out docs/ops/rnd-units-template]
//        → .csv and .xlsx with every R&D product; the unit columns left BLANK
//   node scripts/rnd-units.mjs validate <filled.csv|.xlsx> [--report <dir>]
//        → a dry run: each row's status and the exact product change it WOULD make;
//          exit 1 if any row is in error. Nothing is written anywhere but the report.
//
// Units (owner, 9 Oct 2026): the same list Pizza Mania and Le Lapin use — KG, EA, Pack — with
// Carton in place of Bottle. Anything else is refused, so a typo cannot become a new unit.
//
// Columns (the owner fills the three in the middle):
//   productId, SKU, productName, supplierId, currentUnit,
//   suggestedUnit, suggestedFrom — ONLY where the same product exists in Pizza Mania or Le Lapin
//                   (same name, supplier brackets aside) with one unit; a hint to confirm, never
//                   applied by itself
//   proposedUnit  — the unit the product is bought and counted in: KG, EA, Pack or Carton
//   baseUnit      — the stock unit balances are kept in; blank = the same as proposedUnit
//   conversionFactor — how many baseUnit in ONE proposedUnit; required only when they differ
//   validationStatus — written by `validate`, ignored on input
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import XLSX from 'xlsx'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COLS = ['productId', 'SKU', 'productName', 'supplierId', 'currentUnit', 'suggestedUnit', 'suggestedFrom', 'proposedUnit', 'baseUnit', 'conversionFactor', 'validationStatus']
/** The only units R&D may use, spelled as the other brands spell them (owner: Carton, not Bottle). */
export const ALLOWED_UNITS = ['KG', 'EA', 'Pack', 'Carton']
const canonical = (u) => ALLOWED_UNITS.find((a) => a.toLowerCase() === u.toLowerCase()) ?? null

const SRC = () => readFileSync(resolve(root, 'src/seed/catalog.generated.ts'), 'utf8')
const ROW = /\{\s*"?sku"?:\s*"([^"]+)",\s*"?name"?:\s*"((?:[^"\\]|\\.)*)",\s*"?category"?:\s*"([^"]*)",\s*"?unit"?:\s*"([^"]*)",\s*"?unitType"?:\s*"([^"]*)"/g

/** One brand's catalogue as committed (seeded products use the SKU as their document id). */
function brandRows(name, s = SRC()) {
  const i = s.indexOf(`export const ${name}`)
  if (i < 0) return []
  const j = s.indexOf('export const', i + 10)
  return [...s.slice(i, j < 0 ? undefined : j).matchAll(ROW)].map((m) => ({ sku: m[1], name: JSON.parse(`"${m[2]}"`), category: m[3], unit: m[4], unitType: m[5] }))
}
const catalogue = () => brandRows('RND_PRODUCTS')

const norm = (x) => x.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const bare = (x) => norm(x.replace(/\([^)]*\)/g, ' '))

/** The unit the same product has in Pizza Mania / Le Lapin: exact name first, then the name without its supplier brackets. One unit or nothing. */
export function suggestions() {
  const s = SRC()
  const others = [...brandRows('PZM_PRODUCTS', s).map((r) => ({ ...r, brand: 'Pizza Mania' })), ...brandRows('LLP_PRODUCTS', s).map((r) => ({ ...r, brand: 'Le Lapin' }))]
  const out = new Map()
  for (const p of catalogue()) {
    let m = others.filter((o) => norm(o.name) === norm(p.name))
    if (!m.length) m = others.filter((o) => bare(o.name) && bare(o.name) === bare(p.name))
    const units = [...new Set(m.map((o) => canonical(o.unitType) ?? o.unitType))]
    if (units.length === 1 && canonical(units[0])) out.set(p.sku, { unit: canonical(units[0]), from: m.map((o) => `${o.brand} ${o.sku}`).join('; ') })
  }
  return out
}

function readRows(file) {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
  const ws = wb.Sheets['units'] ?? wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
}

export { catalogue }
export function validateRow(r, bySku, seen) {
  const text = (v) => String(v ?? '').trim()
  const id = text(r.productId)
  const sku = text(r.SKU)
  const proposedIn = text(r.proposedUnit)
  const baseIn = text(r.baseUnit) || proposedIn
  const factorText = text(r.conversionFactor)
  const p = bySku.get(id)
  if (!p) return { status: 'ERROR_UNKNOWN_PRODUCT', issues: [`no R&D product ${id}`] }
  if (sku && sku !== p.sku) return { status: 'ERROR_SKU_MISMATCH', issues: [`${sku} is not ${p.sku}`] }
  if (seen.has(id)) return { status: 'ERROR_DUPLICATE_ROW', issues: [`${id} appears twice`] }
  seen.add(id)
  // A suggestion alone is not a decision: only proposedUnit counts.
  if (!proposedIn) return { status: 'MISSING_UNIT', issues: [] }
  const proposed = canonical(proposedIn)
  const base = canonical(baseIn)
  const bad = [proposedIn, baseIn].filter((u) => !canonical(u))
  if (bad.length) return { status: 'ERROR_UNIT_NOT_ALLOWED', issues: [`${bad.map((u) => `"${u}"`).join(', ')} — use ${ALLOWED_UNITS.join(', ')}`] }
  const same = proposed === base
  let factor
  if (!same) {
    factor = Number(factorText)
    if (!factorText || !Number.isFinite(factor) || factor <= 0) return { status: 'ERROR_CONVERSION_FACTOR', issues: [`1 ${proposed} = ? ${base}: a positive number is required`] }
  } else if (factorText && Number(factorText) !== 1) {
    return { status: 'ERROR_CONVERSION_FACTOR', issues: ['the units are the same; the factor must be blank or 1'] }
  }
  // What the product would become (the app's own shape: unitType = the stock unit).
  const patch = { unitType: base, unit: base, ...(same ? {} : { unitConversions: [{ label: proposed, size: factor }] }) }
  return { status: 'OK', issues: [], patch }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
const [cmd, file] = direct ? process.argv.slice(2) : []
const flag = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)

if (cmd === 'template') {
  const out = resolve(root, flag('--out', 'docs/ops/rnd-units-template'))
  mkdirSync(dirname(out), { recursive: true })
  const hint = suggestions()
  const rows = catalogue().map((p) => ({
    productId: p.sku, // seeded products are stored under their SKU (services/seed.ts)
    SKU: p.sku,
    productName: p.name,
    supplierId: '', // not in the repository; never inferred from the name
    currentUnit: p.unitType,
    suggestedUnit: hint.get(p.sku)?.unit ?? '',
    suggestedFrom: hint.get(p.sku)?.from ?? '',
    proposedUnit: '',
    baseUnit: '',
    conversionFactor: '',
    validationStatus: p.unitType ? 'HAS_UNIT' : 'MISSING_UNIT',
  }))
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLS })
  const help = XLSX.utils.aoa_to_sheet([
    ['R&D units — fill proposedUnit (and baseUnit + conversionFactor only when they differ). Leave blank what you do not know.'],
    ['Allowed units', `${ALLOWED_UNITS.join(', ')} — the same as Pizza Mania and Le Lapin, with Carton instead of Bottle`],
    ['suggestedUnit', 'the unit the SAME product has in Pizza Mania / Le Lapin (suggestedFrom says which). Copy it to proposedUnit only if it is right; it is never applied by itself'],
    ['proposedUnit', 'the unit it is bought and counted in'],
    ['baseUnit', 'the stock unit; blank = same as proposedUnit'],
    ['conversionFactor', 'how many baseUnit in ONE proposedUnit (e.g. 1 Carton = 12 EA → 12); only when the units differ'],
    ['supplierId', 'left blank: suppliers are linked in the app, never guessed from the name'],
    ['Check before applying', 'node scripts/rnd-units.mjs validate <this file>  (dry run, writes nothing)'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'units')
  XLSX.utils.book_append_sheet(wb, help, 'how to fill')
  XLSX.writeFile(wb, `${out}.xlsx`)
  writeFileSync(`${out}.csv`, '﻿' + XLSX.utils.sheet_to_csv(ws))
  console.log(`wrote ${rows.length} rows (${hint.size} with a suggestion) → ${out}.xlsx / .csv`)
} else if (cmd === 'validate' && file) {
  const bySku = new Map(catalogue().map((p) => [p.sku, p]))
  const seen = new Set()
  const results = readRows(resolve(file)).map((r) => ({ productId: String(r.productId ?? '').trim(), ...validateRow(r, bySku, seen) }))
  const count = results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
  const report = resolve(root, flag('--report', 'docs/ops'))
  mkdirSync(report, { recursive: true })
  writeFileSync(resolve(report, 'rnd-units-dry-run.json'), JSON.stringify({ file, at: new Date().toISOString(), allowed: ALLOWED_UNITS, counts: count, rows: results }, null, 1))
  console.log(JSON.stringify(count))
  for (const r of results.filter((x) => x.status.startsWith('ERROR')).slice(0, 20)) console.log(r.status, r.productId, r.issues.join('; '))
  console.log('dry run only — nothing was written to the database')
  process.exitCode = results.some((r) => r.status.startsWith('ERROR')) ? 1 : 0
} else if (direct) {
  console.log('usage: template | validate <file>')
}
