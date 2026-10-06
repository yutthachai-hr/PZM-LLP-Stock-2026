#!/usr/bin/env node
// Dry-run of the baseQty backfill for old order lines (plan A2) — on a backup file, read-only.
//
//   npm run backfill:po-baseqty -- <backup.json> [--json plan.json]
//
// Lists every open order line keyed in another unit that has no `baseQty`, with the value it
// would get at the product's rate today, and every line it could not work out (product gone,
// no rate). Nothing is written to any database: setting the values is a separate step the
// owner has to order. The plan is src/lib/poBaseQtyBackfill.ts, loaded through Vite.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
if (!file) {
  console.error('usage: npm run backfill:po-baseqty -- <backup.json> [--json plan.json]')
  process.exit(2)
}

const backup = JSON.parse(readFileSync(resolve(file), 'utf8'))
if (backup.format !== 'pzm-stock-backup') {
  console.error('not a PZM Stock backup file')
  process.exit(2)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { planPoBaseQtyBackfill } = await vite.ssrLoadModule('/src/lib/poBaseQtyBackfill.ts')
  const d = backup.data ?? {}
  const plan = planPoBaseQtyBackfill(d.purchaseOrders ?? [], d.products ?? [])
  console.log(`\nbaseQty backfill — DRY RUN — ${backup.brandName} (${backup.brand}), backup of ${new Date(backup.createdAt).toISOString()}`)
  console.log(`open orders scanned ${plan.ordersScanned} · lines scanned ${plan.linesScanned}`)
  console.log(`would set ${plan.set.length} line(s) · could not work out ${plan.gaps.length} line(s)`)
  for (const l of plan.set) {
    console.log(`  set  ${l.docNo} #${l.index + 1} ${l.productName}: ${l.orderedQty} ${l.entryUnit} × ${l.factor} = ${l.baseQty}`)
  }
  for (const g of plan.gaps) {
    console.log(`  GAP  ${g.docNo} #${g.index + 1} ${g.productName} (${g.entryUnit}): ${g.why}`)
  }
  if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify(plan, null, 2))
  process.exitCode = plan.gaps.length ? 1 : 0
} finally {
  await vite.close()
}
