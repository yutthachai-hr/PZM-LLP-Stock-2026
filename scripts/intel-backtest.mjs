#!/usr/bin/env node
// Phase G8 — run the time-correct backtest on a backup file. Read-only, zero Firestore reads.
//
//   npm run intel:backtest -- <backup.json> [--json report.json] [--days 120]
//
// The backup is the one Settings → สำรองข้อมูล downloads. Without a file it runs on the
// seeded synthetic history (src/intel/synthetic.ts), which is what CI and the evidence use
// when no production backup is at hand.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const file = args.find((a, i) => !a.startsWith('--') && !['--json', '--days'].includes(args[i - 1]))
const flag = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const bt = await vite.ssrLoadModule('/src/intel/backtest.ts')
  const { syntheticHistory } = await vite.ssrLoadModule('/src/intel/synthetic.ts')
  let data
  let label
  if (file) {
    const backup = JSON.parse(readFileSync(resolve(file), 'utf8'))
    if (backup.format !== 'pzm-stock-backup') throw new Error('not a PZM Stock backup file')
    const d = backup.data ?? {}
    data = { products: d.products ?? [], locations: d.locations ?? [], suppliers: d.suppliers ?? [], orders: d.purchaseOrders ?? [], transfers: d.transfers ?? [], movements: d.stockMovements ?? [] }
    label = `${backup.brandName} backup of ${new Date(backup.createdAt).toISOString()}`
  } else {
    data = syntheticHistory({ seed: 42 })
    label = 'synthetic history (seed 42, 150 days)'
  }
  const dates = data.movements.map((m) => m.date).sort((a, b) => a - b)
  const end = dates[dates.length - 1] ?? Date.now()
  const days = Number(flag('--days') ?? 120)
  const from = Math.max(dates[0] ?? end, end - days * 86_400_000) + 30 * 86_400_000
  const report = { source: label, generatedAt: new Date().toISOString() }
  for (const point of ['atPlacement', 'dayBeforeDue']) for (const th of ['MEDIUM', 'HIGH']) report[`delivery.${point}.${th}`] = bt.evaluateDeliveryRisk(data, point, th)
  report.stockout = bt.evaluateStockout(data, { from, to: end, stepDays: 2 })
  report.deterioration = bt.evaluateDeterioration(data, Array.from({ length: 12 }, (_, i) => from + i * 5 * 86_400_000).filter((t) => t < end - 30 * 86_400_000))
  const m = (x) => `n ${x.n} · coverage ${x.coverage} · precision ${x.precision} · recall ${x.recall} · false-warning ${x.falseWarningRate} · miss ${x.missRate}`
  console.log(`\nPhase G backtest — ${label}`)
  for (const [k, v] of Object.entries(report)) {
    if (k.startsWith('delivery.')) console.log(`${k}: ${m(v.metrics)} · ROC-AUC ${v.rocAuc} · PR-AUC ${v.prAuc}`)
  }
  console.log(`stockout (7 days): ${m(report.stockout.metrics)}`)
  console.log(`quantity: n ${report.stockout.quantity.n} · MAE ${report.stockout.quantity.mae} · bias ${report.stockout.quantity.bias} · within ±25% ${report.stockout.quantity.within25}`)
  console.log(`transfer safety: ${report.stockout.transferSafety.violations} unsafe of ${report.stockout.transferSafety.n}`)
  console.log(`supplier deterioration: ${m(report.deterioration)}`)
  if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(report, null, 1))
} finally {
  await vite.close()
}
