#!/usr/bin/env node
// R&D brand data-quality report (release hardening, 8 Oct 2026) — reads the committed
// catalogue (src/seed/catalog.generated.ts, main 476fa35) only. No database, no guesses:
// a supplier named in brackets is LISTED, never assigned; a missing unit is REPORTED, never filled.
//
//   node scripts/rnd-catalog-report.mjs            → docs/evidence/data/rnd-catalog-report.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { PZM_PRODUCTS, LLP_PRODUCTS, RND_PRODUCTS } = await vite.ssrLoadModule('/src/seed/catalog.generated.ts')
  const { bracketOf } = await vite.ssrLoadModule('/src/lib/productMatch.ts')
  const { isOtherPlaceholder } = await vite.ssrLoadModule('/src/lib/otherItem.ts')
  const rnd = RND_PRODUCTS
  const dupWithin = Object.entries(rnd.reduce((m, p) => ((m[p.sku] = (m[p.sku] ?? 0) + 1), m), {})).filter(([, n]) => n > 1)
  const otherSkus = new Set([...PZM_PRODUCTS, ...LLP_PRODUCTS].map((p) => p.sku))
  const crossBrand = rnd.filter((p) => otherSkus.has(p.sku)).map((p) => p.sku)
  const noUnit = rnd.filter((p) => !p.unit?.trim() || !p.unitType?.trim())
  const byCategory = rnd.reduce((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {})
  const bracketed = rnd.filter((p) => bracketOf(p.name))
  const placeholders = rnd.filter((p) => isOtherPlaceholder(p))
  const report = {
    generatedFrom: 'src/seed/catalog.generated.ts (RND_PRODUCTS)',
    products: rnd.length,
    categories: byCategory,
    skuPattern: { matchingCAT_02_GG_NNN: rnd.filter((p) => /^[A-Z]{2,4}-02-\d{2}-\d{3}$/.test(p.sku)).length },
    duplicateSkusWithinRnd: dupWithin,
    skusAlsoUsedByPizzaOrLeLapin: crossBrand,
    missingUnitOrUnitType: { count: noUnit.length, skus: noUnit.map((p) => p.sku) },
    otherPlaceholders: placeholders.map((p) => ({ sku: p.sku, name: p.name })),
    namesWithBracketedText: { count: bracketed.length, note: 'listed only — a bracket is NOT taken as the supplier', sample: bracketed.slice(0, 10).map((p) => ({ sku: p.sku, name: p.name, bracket: bracketOf(p.name) })) },
    minStockSet: rnd.filter((p) => p.minStock > 0).length,
  }
  mkdirSync(resolve(root, 'docs/evidence/data'), { recursive: true })
  writeFileSync(resolve(root, 'docs/evidence/data/rnd-catalog-report.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify({ ...report, missingUnitOrUnitType: { count: noUnit.length }, namesWithBracketedText: { count: bracketed.length } }, null, 1))
} finally {
  await vite.close()
}
