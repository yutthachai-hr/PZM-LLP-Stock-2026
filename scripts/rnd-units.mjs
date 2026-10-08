#!/usr/bin/env node
// R&D units (owner decision 4, 9 Oct 2026). All 228 R&D catalogue products have no unit; no
// stock entry may use them until an owner states one. This tool NEVER guesses and NEVER writes
// the database:
//
//   node scripts/rnd-units.mjs template [--out docs/ops/rnd-units-template]
//        → .csv and .xlsx with every R&D product; unknown columns left BLANK
//   node scripts/rnd-units.mjs validate <filled.csv|.xlsx> [--report <dir>]
//        → a dry run: each row's status and the exact product change it WOULD make;
//          exit 1 if any row is in error. Nothing is written anywhere but the report.
//
// Columns (the owner fills the three in the middle):
//   productId, SKU, productName, supplierId, currentUnit,
//   proposedUnit  — the unit the product is bought and counted in (e.g. KG, EA, Pack, Bottle)
//   baseUnit      — the stock unit balances are kept in; blank = the same as proposedUnit
//   conversionFactor — how many baseUnit in ONE proposedUnit; required only when they differ
//   validationStatus — written by `validate`, ignored on input
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import XLSX from 'xlsx'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COLS = ['productId', 'SKU', 'productName', 'supplierId', 'currentUnit', 'proposedUnit', 'baseUnit', 'conversionFactor', 'validationStatus']
/** Units the other two brands already use (catalogue), for a warning on anything new. */
const KNOWN = ['KG', 'G', 'L', 'ML', 'EA', 'PACK', 'BOX', 'CARTON', 'BOTTLE', 'BAG', 'CAN', 'LOT']

/** The R&D catalogue as committed (seeded products use the SKU as their document id). */
function catalogue() {
  const s = readFileSync(resolve(root, 'src/seed/catalog.generated.ts'), 'utf8')
  const body = s.slice(s.indexOf('export const RND_PRODUCTS'))
  const rows = []
  for (const m of body.matchAll(/\{\s*"sku":\s*"([^"]+)",\s*"name":\s*"((?:[^"\\]|\\.)*)",\s*"category":\s*"([^"]*)",\s*"unit":\s*"([^"]*)",\s*"unitType":\s*"([^"]*)"/g)) {
    rows.push({ sku: m[1], name: JSON.parse(`"${m[2]}"`), category: m[3], unit: m[4], unitType: m[5] })
  }
  return rows
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
  const proposed = text(r.proposedUnit)
  const base = text(r.baseUnit) || proposed
  const factorText = text(r.conversionFactor)
  const issues = []
  const p = bySku.get(id)
  if (!p) return { status: 'ERROR_UNKNOWN_PRODUCT', issues: [`no R&D product ${id}`] }
  if (sku && sku !== p.sku) return { status: 'ERROR_SKU_MISMATCH', issues: [`${sku} is not ${p.sku}`] }
  if (seen.has(id)) return { status: 'ERROR_DUPLICATE_ROW', issues: [`${id} appears twice`] }
  seen.add(id)
  if (!proposed) return { status: 'MISSING_UNIT', issues: [] }
  if (proposed.length > 20 || base.length > 20) return { status: 'ERROR_UNIT_TOO_LONG', issues: ['a unit is at most 20 characters'] }
  const same = proposed.toLowerCase() === base.toLowerCase()
  let factor
  if (!same) {
    factor = Number(factorText)
    if (!factorText || !Number.isFinite(factor) || factor <= 0) return { status: 'ERROR_CONVERSION_FACTOR', issues: [`1 ${proposed} = ? ${base}: a positive number is required`] }
  } else if (factorText && Number(factorText) !== 1) {
    return { status: 'ERROR_CONVERSION_FACTOR', issues: ['the units are the same; the factor must be blank or 1'] }
  }
  for (const u of [proposed, base]) if (!KNOWN.includes(u.toUpperCase())) issues.push(`unit "${u}" is new to the catalogue — check the spelling`)
  // What the product would become (the app's own shape: unitType = the stock unit).
  const patch = { unitType: base, unit: base, ...(same ? {} : { unitConversions: [{ label: proposed, size: factor }] }) }
  return { status: issues.length ? 'OK_WITH_WARNING' : 'OK', issues, patch }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
const [cmd, file] = direct ? process.argv.slice(2) : []
const flag = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)

if (cmd === 'template') {
  const out = resolve(root, flag('--out', 'docs/ops/rnd-units-template'))
  mkdirSync(dirname(out), { recursive: true })
  const rows = catalogue().map((p) => ({
    productId: p.sku, // seeded products are stored under their SKU (services/seed.ts)
    SKU: p.sku,
    productName: p.name,
    supplierId: '', // not in the repository; never inferred from the name
    currentUnit: p.unitType,
    proposedUnit: '',
    baseUnit: '',
    conversionFactor: '',
    validationStatus: p.unitType ? 'HAS_UNIT' : 'MISSING_UNIT',
  }))
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLS })
  const help = XLSX.utils.aoa_to_sheet([
    ['R&D units — fill proposedUnit (and baseUnit + conversionFactor only when they differ). Leave blank what you do not know.'],
    ['proposedUnit', 'the unit it is bought and counted in, e.g. KG, EA, Pack, Bottle'],
    ['baseUnit', 'the stock unit; blank = same as proposedUnit'],
    ['conversionFactor', 'how many baseUnit in ONE proposedUnit (e.g. 1 Pack = 12 EA → 12); only when the units differ'],
    ['supplierId', 'left blank: suppliers are linked in the app, never guessed from the name'],
    ['Check before applying', 'node scripts/rnd-units.mjs validate <this file>  (dry run, writes nothing)'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'units')
  XLSX.utils.book_append_sheet(wb, help, 'how to fill')
  XLSX.writeFile(wb, `${out}.xlsx`)
  writeFileSync(`${out}.csv`, '﻿' + XLSX.utils.sheet_to_csv(ws))
  console.log(`wrote ${rows.length} rows → ${out}.xlsx / .csv`)
} else if (cmd === 'validate' && file) {
  const bySku = new Map(catalogue().map((p) => [p.sku, p]))
  const seen = new Set()
  const results = readRows(resolve(file)).map((r) => ({ productId: String(r.productId ?? '').trim(), ...validateRow(r, bySku, seen) }))
  const count = results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
  const report = resolve(root, flag('--report', 'docs/ops'))
  mkdirSync(report, { recursive: true })
  writeFileSync(resolve(report, 'rnd-units-dry-run.json'), JSON.stringify({ file, at: new Date().toISOString(), counts: count, rows: results }, null, 1))
  console.log(JSON.stringify(count))
  for (const r of results.filter((x) => x.status.startsWith('ERROR')).slice(0, 20)) console.log(r.status, r.productId, r.issues.join('; '))
  console.log('dry run only — nothing was written to the database')
  process.exitCode = results.some((r) => r.status.startsWith('ERROR')) ? 1 : 0
} else if (direct) {
  console.log('usage: template | validate <file>')
}
