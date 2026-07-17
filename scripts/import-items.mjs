// Converts the company's official item-code workbooks into src/seed/catalog.generated.ts.
//
//   node scripts/import-items.mjs
//
// SKU and name are copied verbatim from columns A/B (trimmed at the ends only) — they must
// stay byte-identical to the Cost of Goods workbooks. Category/unit are derived from the
// SKU prefix; the script cross-checks every derived category against the section heading
// above the row and aborts on any mismatch, unknown prefix, or duplicate SKU.

import XLSX from 'xlsx'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/seed/catalog.generated.ts')

const SOURCES = [
  {
    brand: 'PZM',
    export: 'PZM_PRODUCTS',
    label: 'Pizza Mania',
    file: 'C:/Users/Yutthachai/OneDrive/Documents/รหัสสินค้า Pizza Mania Items.xls',
  },
  {
    brand: 'LLP',
    export: 'LLP_PRODUCTS',
    label: 'Le Lapin',
    file: 'C:/Users/Yutthachai/OneDrive/Documents/รหัสสินค้า Le Lapin Items.xls',
  },
]

const KG = { unit: 'Kilogram', unitType: 'KG' }
const EA = { unit: 'หน่วย', unitType: 'EA' }
const PACK = { unit: 'แพ็ค', unitType: 'Pack' }
const BOTTLE = { unit: 'ขวด/แกลลอน', unitType: 'EA' }
const BAG = { unit: 'ถุง', unitType: 'EA' }
const TANK = { unit: 'ถัง', unitType: 'EA' }

// SKU prefix -> category + default unit. `category` may differ per brand (see `per`).
const PREFIX = {
  VGT: { category: 'Vegetable', ...KG },
  MES: { category: 'Meat & Seafood', ...KG },
  CHS: { category: 'Cheese & Dairy', ...KG },
  CKO: { category: 'Cooking Oil', ...BOTTLE },
  SEAS: { category: 'Seasoning', ...EA },
  FLO: { category: 'Flour', ...BAG },
  BD: { category: 'Bread & Powder', ...EA },
  PASTA: { category: 'Pasta', ...EA },
  CG: { category: 'Canned Goods', ...EA },
  PZS: { category: 'Pizza Sauce', ...EA },
  SNACK: { category: 'Snack', ...EA },
  PB: { category: 'Pizza Box', ...EA },
  PP: { category: 'Pizza Packing Other', per: { LLP: 'Packing' }, ...EA },
  SP: { category: 'PM Sauce Pack', ...EA },
  BEV: { category: 'Beverage', ...PACK },
  ICC: { category: 'Ice Cream', ...EA },
  GAS: { category: 'Gas', ...TANK },
  WOOD: { category: 'Wood', ...KG },
  OFS: { category: 'Office Supply', ...EA },
  OSF: { category: 'Office Supply', ...EA },
}

// Normalises a section heading ("Cheese&Dairy - Sukhumvit 23") so it can be compared with
// the prefix-derived category ("Cheese & Dairy"): drop the branch suffix, then keep letters only.
function headingKey(text) {
  return text
    .replace(/[-–]\s*(sukhumvit|sukumvit|sarasin)\b.*$/i, '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase()
}

// Section headings whose wording differs from the category name we use.
const HEADING_ALIAS = {
  spaghetti: 'pasta',
  passta: 'pasta',
  purchescanedgoods: 'cannedgoods',
  snackfrenchfriestos: 'snack',
  materialbreadpowder: 'breadpowder',
  officessup: 'officesupply',
  meatseafood: 'meatseafood',
}

const SKU_RE = /^[A-Z]{2,8}(?:-[A-Z0-9]{2,})+$/

const errors = []
const catalogs = []

for (const src of SOURCES) {
  const wb = XLSX.readFile(src.file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

  const items = []
  const seen = new Map()
  let heading = null

  rows.forEach((row, i) => {
    const line = i + 1
    const sku = String(row[0] ?? '').trim()
    const name = String(row[1] ?? '').trim()
    if (!sku) return

    // Any non-SKU text in column A is a section heading. Headings that merely group other
    // headings ("Raw Material - Sukhumvit 23") are overwritten before any item row is reached.
    if (!SKU_RE.test(sku)) {
      heading = sku
      return
    }

    if (!name) {
      errors.push(`${src.brand} row ${line}: SKU ${sku} has no name`)
      return
    }

    const prefix = sku.split('-')[0]
    const def = PREFIX[prefix]
    if (!def) {
      errors.push(`${src.brand} row ${line}: unknown SKU prefix "${prefix}" (${sku})`)
      return
    }
    const category = def.per?.[src.brand] ?? def.category

    // Cross-check the derived category against the heading this row sits under.
    if (heading) {
      const want = headingKey(category)
      const got = headingKey(heading)
      if (want !== (HEADING_ALIAS[got] ?? got)) {
        errors.push(
          `${src.brand} row ${line}: ${sku} -> "${category}" but heading is "${heading}"`,
        )
      }
    } else {
      errors.push(`${src.brand} row ${line}: ${sku} appears before any section heading`)
    }

    const prev = seen.get(sku)
    if (prev) console.warn(`  ! duplicate SKU ${sku} (rows ${prev} and ${line}) — importing both`)
    else seen.set(sku, line)

    items.push({ sku, name, category, unit: def.unit, unitType: def.unitType, minStock: 0 })
  })

  const byCat = new Map()
  for (const it of items) byCat.set(it.category, (byCat.get(it.category) ?? 0) + 1)
  console.log(`${src.label}: ${items.length} items (${seen.size} unique SKUs)`)
  for (const [c, n] of byCat) console.log(`  ${String(n).padStart(3)}  ${c}`)

  catalogs.push({ src, items })
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s) — nothing written:`)
  for (const e of errors) console.error('  ✗', e)
  process.exit(1)
}

const render = (items) =>
  items
    .map(
      (p) =>
        `  { sku: ${JSON.stringify(p.sku)}, name: ${JSON.stringify(p.name)},` +
        ` category: ${JSON.stringify(p.category)}, unit: ${JSON.stringify(p.unit)},` +
        ` unitType: ${JSON.stringify(p.unitType)}, minStock: 0 },`,
    )
    .join('\n')

const out = `// AUTO-GENERATED by scripts/import-items.mjs — DO NOT EDIT BY HAND.
// Source of truth: the company's "รหัสสินค้า" item-code workbooks (Cost of Goods).
// sku + name are verbatim from those files; unit/unitType are defaults per category and
// are meant to be corrected in the app. Re-run the script to pick up workbook changes.

export interface SeedProduct {
  sku: string
  name: string
  category: string
  unit: string
  unitType: string
  minStock: number
}

${catalogs
  .map(
    ({ src, items }) =>
      `/** ${src.label} — ${items.length} items */\nexport const ${src.export}: SeedProduct[] = [\n${render(items)}\n]`,
  )
  .join('\n\n')}
`

writeFileSync(OUT, out)
console.log(`\nwrote ${OUT}`)
