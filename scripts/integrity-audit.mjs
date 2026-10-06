#!/usr/bin/env node
// Integrity audit of a backup file — read-only, zero Firestore reads (Phase 0, 6 Oct 2026).
//
//   npm run audit:integrity -- <backup.json> [--json report.json]
//
// The backup is the one Settings → สำรองข้อมูล downloads. Nothing is written anywhere except
// the optional report file; nothing found is repaired. The checks are src/lib/integrityAudit.ts,
// loaded through Vite so the script runs the very code the app does.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
if (!file) {
  console.error('usage: npm run audit:integrity -- <backup.json> [--json report.json]')
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
  const { auditIntegrity, AUDIT_CATEGORIES } = await vite.ssrLoadModule('/src/lib/integrityAudit.ts')
  const d = backup.data ?? {}
  const report = auditIntegrity({
    products: d.products ?? [],
    locations: d.locations ?? [],
    // Present in current backups; a file without them skips that one check and says so.
    stockLevels: d.stockLevels,
    movements: d.stockMovements ?? [],
    purchaseOrders: d.purchaseOrders ?? [],
    purchaseRequests: d.purchaseRequests ?? [],
    transfers: d.transfers ?? [],
  })

  const when = new Date(backup.createdAt).toISOString()
  console.log(`\nPZM Stock integrity audit — ${backup.brandName} (${backup.brand}), backup of ${when}, format v${backup.version}`)
  console.log('scanned:', Object.entries(report.scanned).map(([k, v]) => `${k} ${v}`).join(' · '))
  if (backup.integrity) {
    console.log(
      `backup's own check: ${backup.integrity.drift} cached balance(s) disagreed with the ledger when it was taken` +
        (backup.integrity.consistent === false ? ' — stock was recorded while it was being written' : ''),
    )
  }
  if (report.skipped.length) console.log('skipped (not in this data):', report.skipped.join(', '))

  console.log('\ncategory     critical  warning  info')
  for (const c of AUDIT_CATEGORIES) {
    const s = report.summary[c]
    console.log(`${c.padEnd(12)} ${String(s.critical).padStart(8)} ${String(s.warning).padStart(8)} ${String(s.info).padStart(5)}`)
  }

  const show = report.findings.filter((f) => f.severity !== 'info')
  if (show.length) console.log(`\n${show.length} finding(s) to look at (info rows are in the JSON report):`)
  for (const f of show.slice(0, 200)) {
    const label = f.ref.label ? ` ${f.ref.label}` : ''
    const detail = Object.entries(f.detail).map(([k, v]) => `${k}=${v}`).join(' ')
    console.log(`  [${f.severity}] ${f.category}/${f.code}  ${f.ref.collection}/${f.ref.id}${label}  ${detail}`)
  }
  if (show.length > 200) console.log(`  … and ${show.length - 200} more in the JSON report`)

  if (jsonOut) {
    writeFileSync(resolve(jsonOut), JSON.stringify({ brand: backup.brand, backupCreatedAt: backup.createdAt, auditedAt: Date.now(), ...report }, null, 2))
    console.log(`\nreport written to ${jsonOut}`)
  }
  const critical = AUDIT_CATEGORIES.reduce((n, c) => n + report.summary[c].critical, 0)
  console.log(critical ? `\n${critical} critical mismatch(es). Nothing was changed — each needs a person to decide.` : '\nNo critical mismatches.')
  process.exitCode = critical ? 1 : 0
} finally {
  await vite.close()
}
