// Release gate (owner, 9 Oct 2026): restore rehearsal with REAL backups of all three brands, in
// isolation. The app's own restore code (services/backup.ts) writes into the in-memory backend —
// no Firebase project, no network — then the app's own backup reads it back, and the two are
// compared collection by collection. Each re-export is also written out for the integrity audit.
//
// Runs only when pointed at real backups (they hold business data and never enter the repo):
//
//   PZM_RESTORE_DIR=C:/pzm/backups npx vitest run tests/restore-rehearsal.test.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const DIR = process.env.PZM_RESTORE_DIR
const { resetMemory } = await import('./helpers/memory-backend')
const { buildBackup, parseBackup, restoreBackup, RESTORE_MODES } = await import('../src/services/backup')
const { setActiveBrand } = await import('../src/brand/brand')
type Brand = Parameters<typeof setActiveBrand>[0]

const files = DIR ? readdirSync(DIR).filter((f) => /^pzm-stock-(pizza|lelapin|rnd)-\d{8}-\d{4}\.json$/.test(f)) : []
/** What restore itself writes or derives, so not part of the comparison: its audit trail, counters and cache epoch. */
const DERIVED = new Set(['auditLog', 'counters', 'meta', 'notifications'])
const byId = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.id), r]))

describe.skipIf(!files.length)('restore rehearsal with the owner\'s backups (isolated, in memory)', () => {
  test.each(files.map((f) => [f]))('%s restores, re-exports identically, and keeps its ledger', async (f) => {
    const original = parseBackup(readFileSync(join(DIR!, f), 'utf8'))
    const brand = original.brand as Brand
    // A file of one brand must never land in another brand's namespace.
    const other = (['pizza', 'lelapin', 'rnd'] as const).find((b) => b !== brand)!
    setActiveBrand(other)
    resetMemory()
    await expect(restoreBackup(original, RESTORE_MODES.overwrite)).rejects.toThrow()

    setActiveBrand(brand)
    resetMemory()
    const result = await restoreBackup(original, RESTORE_MODES.overwrite)
    expect(result.written).toBeGreaterThan(0)
    const again = await buildBackup('restore-rehearsal')
    writeFileSync(join(DIR!, `restored-${f}`), JSON.stringify(again))

    const diffs: string[] = []
    for (const [name, rows] of Object.entries(original.data)) {
      if (DERIVED.has(name)) continue
      const want = byId(rows as Record<string, unknown>[])
      const got = byId((again.data[name] ?? []) as Record<string, unknown>[])
      // Restore REBUILDS balances from the ledger (by design): a balance is restamped, and an
      // empty one (qty 0 — e.g. a legacy "#unit" balance the unit migration zeroed) is not
      // recreated. Anything else missing, extra or changed is a real difference.
      const rebuilt = name === 'stockLevels'
      for (const [id, doc] of want) if (!got.has(id) && !(rebuilt && Math.abs(Number(doc.qty ?? 0)) < 0.0005)) diffs.push(`${name}/${id} missing`)
      for (const id of got.keys()) if (!want.has(id)) diffs.push(`${name}/${id} extra`)
      for (const [id, doc] of want) {
        const back = got.get(id)
        if (!back) continue
        for (const [k, v] of Object.entries(doc)) {
          if (rebuilt && (k === 'updatedAt' || k === 'updatedBy')) continue
          if (JSON.stringify(back[k]) !== JSON.stringify(v)) diffs.push(`${name}/${id}.${k} changed`)
        }
      }
    }
    if (diffs.length) {
      const kinds = new Map<string, number>()
      for (const d of diffs) {
        const k = d.replace(/\/[^/.]+(\.|\s)/, '/*$1')
        kinds.set(k, (kinds.get(k) ?? 0) + 1)
      }
      console.log(f, [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 15))
    }
    expect(diffs.slice(0, 20), `${diffs.length} difference(s)`).toEqual([])
    // The ledger and the cached balances agree after the restore exactly as before it.
    expect(again.integrity.drift).toBe(original.integrity.drift)
    expect(again.integrity.ledgerStamp).toBe(original.integrity.ledgerStamp)
  }, 120_000)
})
