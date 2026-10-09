import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { backfill } from '../../src/shadow/backfill'
import { checkParity, formatParity } from '../../src/shadow/parity'
import { pgliteClient } from '../../src/shadow/pglite'
import { freshDb } from './pg'

// Only where the owner's backup exists (PZM_BACKUP); prints the parity report.
const file = process.env.PZM_BACKUP
test.skipIf(!file || !existsSync(file))('backfill a real backup and check parity', async () => {
  const backup = JSON.parse(readFileSync(file!, 'utf8'))
  const pg = await freshDb()
  const db = pgliteClient(pg)
  const t0 = Date.now()
  const res = await backfill(db, backup, { runId: 'real-1' })
  const report = await checkParity(db, backup)
  console.log(`backfill ${Date.now() - t0} ms`, JSON.stringify(res.entities.map((e) => `${e.entity}:${e.done}`)))
  console.log(formatParity(report))
  await pg.close()
  expect(report.balances.length).toBe(2)
}, 600_000)
