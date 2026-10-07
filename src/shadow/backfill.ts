import { BACKUP_COLLECTION, ENTITY_ORDER, mapDoc, type Brand, type Entity } from './mapping'
import { applyPlan, type SqlClient } from './writer'

/**
 * Load a brand's backup file (Settings › สำรองข้อมูล) into the shadow database.
 *
 * Reads the FILE — never Firestore, so it costs no reads and cannot touch production.
 * Resumable: every chunk commits together with its checkpoint (migration_checkpoints), so a
 * run that dies part-way is started again with the same `runId` and carries on after the
 * last committed chunk. Re-running a finished run, or a different run over the same data,
 * changes nothing (upserts with version guards).
 */

export interface BackupLike {
  brand: string
  createdAt: number
  data: Record<string, Record<string, unknown>[]>
}

export interface BackfillResult {
  runId: string
  entities: { entity: Entity; total: number; done: number; skipped: boolean }[]
}

export function brandOf(backup: BackupLike): Brand {
  if (backup.brand === 'pizza' || backup.brand === 'lelapin') return backup.brand
  throw new Error(`unknown brand in backup: ${backup.brand}`)
}

export async function backfill(
  db: SqlClient,
  backup: BackupLike,
  opts: { runId: string; chunk?: number; entities?: readonly Entity[]; /** test hook: throw after this many docs */ failAfter?: number },
): Promise<BackfillResult> {
  const brand = brandOf(backup)
  const chunk = opts.chunk ?? 200
  const source = `backup:${brand}:${backup.createdAt}`
  const out: BackfillResult = { runId: opts.runId, entities: [] }
  let seen = 0

  for (const entity of opts.entities ?? ENTITY_ORDER) {
    const docs = (backup.data[BACKUP_COLLECTION[entity]] ?? []).filter((d) => d && d.id !== undefined && d.id !== '')
    const cp = (
      await db.query<{ done: number; status: string; source: string }>(
        `select done, status, source from shadow.migration_checkpoints where run_id = $1 and entity = $2`,
        [opts.runId, entity],
      )
    ).rows[0]
    if (cp && cp.source !== source) throw new Error(`run ${opts.runId} was started from ${cp.source}, not ${source} — use a new run id`)
    if (cp?.status === 'done') {
      out.entities.push({ entity, total: docs.length, done: cp.done, skipped: true })
      continue
    }
    if (!cp) {
      await db.query(`insert into shadow.migration_checkpoints (run_id, entity, source, total) values ($1, $2, $3, $4)`, [opts.runId, entity, source, docs.length])
    }
    let done = cp?.done ?? 0
    while (done < docs.length) {
      const slice = docs.slice(done, done + chunk)
      try {
        await db.transaction(async (tx) => {
          for (const d of slice) {
            if (opts.failAfter !== undefined && seen >= opts.failAfter) throw new Error('simulated failure')
            await applyPlan(tx, mapDoc(entity, brand, d))
            seen++
          }
          await tx.query(`update shadow.migration_checkpoints set done = $3, updated_at = now() where run_id = $1 and entity = $2`, [opts.runId, entity, done + slice.length])
        })
      } catch (e) {
        await db.query(`update shadow.migration_checkpoints set status = 'failed', last_error = $3, updated_at = now() where run_id = $1 and entity = $2`, [opts.runId, entity, String(e).slice(0, 500)])
        throw e
      }
      done += slice.length
    }
    await db.query(`update shadow.migration_checkpoints set status = 'done', last_error = null, updated_at = now() where run_id = $1 and entity = $2`, [opts.runId, entity])
    out.entities.push({ entity, total: docs.length, done, skipped: false })
  }
  return out
}
