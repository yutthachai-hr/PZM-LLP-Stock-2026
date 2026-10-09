#!/usr/bin/env node
// Release gate (owner, 9 Oct 2026): run BOTH integrity engines on real backup files — the
// TypeScript reference (src/agent/integrityReference.ts) and the independent Rust engine
// (crates/pzm-integrity) — and require that they agree. Reads only the files; no database.
//
//   node scripts/integrity-backup.mjs <backup.json> [more.json ...]
//   exit 0 = both engines agree and neither reports FAIL
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = resolve(root, 'crates/pzm-integrity')
const files = process.argv.slice(2)
if (!files.length) throw new Error('usage: integrity-backup.mjs <backup.json> ...')
const win = process.platform === 'win32'
const cargo = [join(homedir(), '.cargo', 'bin', win ? 'cargo.exe' : 'cargo'), 'cargo'].find((c) => c === 'cargo' || existsSync(c))
if (spawnSync(cargo, ['build', '--release', '--quiet'], { cwd: crate, stdio: 'inherit' }).status !== 0) throw new Error('cargo build failed')
const exe = resolve(crate, 'target/release', win ? 'pzm-integrity.exe' : 'pzm-integrity')

const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { checkIntegrity, INTEGRITY_SCHEMA } = await vite.ssrLoadModule('/src/agent/integrityReference.ts')

/** A backup file as the engines' snapshot. Base balances only, as the reference defines. */
function snapshotOf(b) {
  const d = b.data
  return {
    schema: INTEGRITY_SCHEMA,
    products: (d.products ?? []).map((p) => ({ id: p.id, unitType: p.unitType ?? '', ...(p.unitConversions ? { unitConversions: p.unitConversions } : {}) })),
    locations: [...(d.locations ?? []).map((l) => ({ id: l.id })), { id: 'transit' }],
    levels: (d.stockLevels ?? []).filter((l) => !String(l.id).includes('#')).map((l) => ({ id: l.id, qty: Number(l.qty ?? 0), ...(l.reserved ? { reserved: l.reserved } : {}) })),
    movements: (d.stockMovements ?? []).map((m) => ({
      id: m.id, productId: m.productId, qty: Number(m.qty ?? 0), date: m.date, createdAt: m.createdAt ?? m.date,
      ...(m.fromLocationId ? { fromLocationId: m.fromLocationId } : {}), ...(m.toLocationId ? { toLocationId: m.toLocationId } : {}),
      ...(m.voided ? { voided: true } : {}), ...(m.operationId ? { operationId: m.operationId } : {}),
      ...(m.poId ? { poId: m.poId } : {}), ...(m.transferId ? { transferId: m.transferId } : {}), ...(m.lockOverride ? { lockOverride: m.lockOverride } : {}),
    })),
    orders: (d.purchaseOrders ?? []).map((o) => ({ id: o.id, status: o.status, locationId: o.locationId, lines: (o.lines ?? []).map((l) => ({ productId: l.productId, receivedQty: Number(l.receivedQty ?? 0) })) })),
    transfers: (d.transfers ?? []).map((t) => ({ id: t.id, status: t.status, fromLocationId: t.fromLocationId, toLocationId: t.toLocationId })),
    closedPeriods: (d.monthlyCounts ?? []).filter((c) => c.status === 'posted').map((c) => ({ locationId: c.locationId, month: c.month, postedAt: c.postedAt ?? c.updatedAt ?? 0 })),
  }
}

let bad = 0
for (const f of files) {
  const snap = snapshotOf(JSON.parse(readFileSync(f, 'utf8')))
  const ts = checkIntegrity(snap)
  const run = spawnSync(exe, ['-'], { input: JSON.stringify(snap), encoding: 'utf8', maxBuffer: 1 << 30 })
  const rs = JSON.parse(run.stdout)
  const agree = isDeepStrictEqual(JSON.parse(JSON.stringify(ts)), rs)
  const crit = (r) => (r.findings ?? Object.values(r.groups ?? {}).flat()).filter((x) => x.severity === 'critical').length
  console.log(`${f.split(/[\\/]/).pop()}: movements ${snap.movements.length} levels ${snap.levels.length} | TS ${ts.status} · Rust ${rs.status} (exit ${run.status}) | agree ${agree}`)
  if (!agree || ts.status === 'FAIL') {
    bad++
    if (!agree) console.log('  TS  ', JSON.stringify(ts).slice(0, 400), '\n  Rust', JSON.stringify(rs).slice(0, 400))
  }
  if (ts.status !== 'PASS') console.log('  findings:', JSON.stringify(ts).match(/"ruleId":"[^"]+"/g)?.slice(0, 10).join(' '), 'critical', crit(ts))
}
await vite.close()
process.exitCode = bad ? 1 : 0
