// Converts the company's official item-code workbooks into src/seed/catalog.generated.ts.
//
//   npm run import-items -- --pzm "<path to Pizza Mania Items.xls>" \
//                           --llp "<path to Le Lapin Items.xls>"
//
// or set PZM_ITEMS_XLS and LLP_ITEMS_XLS in the environment. The paths used to be one
// developer's OneDrive folder written into the source, so the documented command could not
// work on anyone else's machine.
//
// SKU and name are copied verbatim from columns A/B (trimmed at the ends only) — they must
// stay byte-identical to the Cost of Goods workbooks, because the company's accounts are
// reconciled against them. Category/unit are derived from the SKU prefix; the script
// cross-checks every derived category against the section heading above the row and aborts
// on any mismatch or unknown prefix. A SKU listed twice with identical details is kept
// once; a SKU shared by two DIFFERENT products aborts, because nothing downstream can
// tell which one a stock movement meant.

import XLSX from 'xlsx'
import { writeFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/seed/catalog.generated.ts')

/** Read `--name value` from the command line. */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Resolve a workbook path and fail with something actionable if it is not usable. */
function workbookPath(label, flagName, envName) {
  const given = flag(flagName) ?? process.env[envName]
  if (!given) {
    console.error(
      `Missing the ${label} workbook.\n` +
        `  npm run import-items -- --${flagName} "<path to the .xls>"\n` +
        `  or set ${envName} in the environment.`,
    )
    process.exit(1)
  }
  const full = resolve(given)
  if (!existsSync(full) || !statSync(full).isFile()) {
    console.error(`The ${label} workbook is not a file: ${full}`)
    process.exit(1)
  }
  return full
}

const SOURCES = [
  {
    brand: 'PZM',
    export: 'PZM_PRODUCTS',
    label: 'Pizza Mania',
    file: workbookPath('Pizza Mania', 'pzm', 'PZM_ITEMS_XLS'),
  },
  {
    brand: 'LLP',
    export: 'LLP_PRODUCTS',
    label: 'Le Lapin',
    file: workbookPath('Le Lapin', 'llp', 'LLP_ITEMS_XLS'),
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

    const item = { sku, name, category, unit: def.unit, unitType: def.unitType, minStock: 0 }

    // A SKU is the product's identity, so the same one twice is either the same row written
    // twice — which the workbooks do contain — or two different products fighting over one
    // code, which nothing downstream can resolve. Collapse the first, refuse the second.
    // Nothing here rewrites a SKU or a name: both stay exactly as the workbook has them.
    const prev = seen.get(sku)
    if (prev) {
      if (JSON.stringify(prev.item) === JSON.stringify(item)) {
        console.warn(`  ! ${sku} is listed twice (rows ${prev.line} and ${line}) — identical, keeping one`)
      } else {
        errors.push(
          `${src.brand} row ${line}: ${sku} is already used by a DIFFERENT product on row ${prev.line} ` +
            `("${prev.item.name}" vs "${name}") — one of them needs its own code in the workbook`,
        )
      }
      return
    }
    seen.set(sku, { line, item })

    items.push(item)
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
