#!/usr/bin/env node
// Dry-run of the baseQty backfill for old order lines (plan A2) — on a backup file, read-only.
//
//   npm run backfill:po-baseqty -- <backup.json> [--json plan.json]
//
// Classifies EVERY order line (src/lib/poBaseQtyBackfill.ts classifyPoBaseQty): already
// valid, safe to backfill, ambiguous (needs review), invalid, or on a closed order — and how
// many lines the backfill would change (the safe ones only). Nothing is written to any database: setting the values is a separate step the
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
  const { classifyPoBaseQty } = await vite.ssrLoadModule('/src/lib/poBaseQtyBackfill.ts')
  const d = backup.data ?? {}
  const r = classifyPoBaseQty(d.purchaseOrders ?? [], d.products ?? [], d.stockMovements ?? [])
  const c = r.counts
  console.log(`\nbaseQty backfill — DRY RUN, nothing is written — ${backup.brandName} (${backup.brand}), backup of ${new Date(backup.createdAt).toISOString()}`)
  console.log(`orders ${(d.purchaseOrders ?? []).length} · total lines ${r.totalLines}`)
  console.log(`  already valid   ${c.valid}`)
  console.log(`  safe backfill   ${c.safe}`)
  console.log(`  AMBIGUOUS       ${c.ambiguous}   (need review — never written)`)
  console.log(`  INVALID         ${c.invalid}   (cannot be worked out)`)
  console.log(`  closed orders   ${c.closed}   (owe nothing — never written)`)
  console.log(`  would change    ${r.wouldChange}`)
  for (const l of r.lines.filter((x) => x.class !== 'closed')) {
    const why = Array.isArray(l.why) ? l.why.join('+') : (l.why ?? '')
    const rates = l.ledgerRates?.length ? ` ledger rates ${l.ledgerRates.map((x) => +x.toFixed(4)).join('/')}` : ''
    console.log(`  ${l.class.padEnd(9)} ${l.docNo} #${l.index + 1} ${l.productName}: ${l.orderedQty} ${l.entryUnit ?? ''}${l.baseQty !== null ? ` baseQty ${l.baseQty}` : ''}${l.proposed !== undefined ? ` → ${l.proposed}` : ''} ${why}${rates}`)
  }
  if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify(r, null, 2))
  // Non-zero while anything needs a person: the backfill may not be ordered until then.
  process.exitCode = c.ambiguous || c.invalid ? 1 : 0
} finally {
  await vite.close()
}
