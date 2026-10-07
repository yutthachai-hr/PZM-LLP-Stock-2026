import { accessToken, parseServiceAccount } from './auth'
import { restStore } from './firestore'
import { CRONS, runJob, type JobKind } from './jobs'
import postgres from 'postgres'
import { postgresClient } from '../../src/shadow/postgres'
import { shadowSync } from './shadowSync'
import { emit, newRequestId, newTraceId } from '../../src/lib/trace'

/** G18: one trace per cron invocation, one line per job — counts and outcome, never data. */
async function traced(stage: 'worker.shadow' | 'worker.job', name: string, work: () => Promise<Record<string, unknown>>): Promise<void> {
  const ctx = { traceId: newTraceId(), requestId: newRequestId() }
  const started = Date.now()
  try {
    const r = await work()
    const count = typeof r.applied === 'number' ? r.applied : typeof r.written === 'number' ? r.written : undefined
    emit({ ...ctx, stage, name, outcome: r.error ? 'error' : r.configured === false ? 'skipped' : 'ok', ms: Date.now() - started, count })
  } catch {
    emit({ ...ctx, stage, name, outcome: 'error', ms: Date.now() - started })
  }
}

/**
 * pzmstock-cron: the inventory calendar's background jobs, on Cloudflare's free cron.
 *
 * Secrets / vars (worker/wrangler.toml, `wrangler secret put`):
 *   FIREBASE_SERVICE_ACCOUNT  the service account's JSON key (roles/datastore.user only)
 *   WORKER_ENABLED            "false" stops every job without a redeploy
 *   SUPABASE_DB_URL           the Supabase shadow's connection string (Session pooler) — when
 *                             set, SHADOW_CRON replicates Firestore → Supabase (shadowSync.ts)
 *
 * Every run ends by writing meta/cronStatus — the app reads it to know the Worker is
 * alive, and stands in for it (managers' browsers) when it has been silent over 26 hours.
 */

export interface Env {
  FIREBASE_SERVICE_ACCOUNT?: string
  WORKER_ENABLED?: string
  SUPABASE_DB_URL?: string
}

/** Its own cron, so the replicator has a whole invocation's 50 outgoing requests to itself. */
export const SHADOW_CRON = '15,45 * * * *'

async function runShadow(env: Env, now = Date.now()): Promise<Record<string, unknown>> {
  // Not configured: nothing is read and nothing is written.
  if (!env.SUPABASE_DB_URL) return { configured: false }
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  const store = restStore(sa.project_id, () => accessToken(sa))
  const sql = postgres(env.SUPABASE_DB_URL, { max: 1, prepare: false, fetch_types: false, ssl: 'require' })
  let status: Record<string, unknown> = { lastRunAt: now }
  try {
    status = { ...status, ...(await shadowSync(store, postgresClient(sql as never), now)) }
    const lag = await sql`select lag_seconds, dead_letter, pending, failed from shadow.replication_status`
    status = { ...status, ...(lag[0] ?? {}) }
  } catch (e) {
    status = { ...status, error: String((e as Error).message ?? e).slice(0, 500) }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
  // Failures stay visible: the app's Settings can read meta/shadowStatus next to cronStatus.
  await store.write([{ type: 'set', collection: 'meta', id: 'shadowStatus', doc: JSON.parse(JSON.stringify(status)) }])
  return status
}

async function run(env: Env, kind: JobKind, now = Date.now()): Promise<Record<string, unknown>> {
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  const store = restStore(sa.project_id, () => accessToken(sa))
  let status: Record<string, unknown> = { lastRunAt: now, lastJob: kind }
  try {
    const r = await runJob(store, kind, now)
    status = { ...status, ...r }
  } catch (e) {
    status = { ...status, error: String((e as Error).message ?? e).slice(0, 500) }
  }
  await store.write([{ type: 'set', collection: 'meta', id: 'cronStatus', doc: status }])
  return status
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.WORKER_ENABLED === 'false') return
    if (event.cron === SHADOW_CRON) {
      ctx.waitUntil(traced('worker.shadow', 'shadowSync', () => runShadow(env, event.scheduledTime)))
      return
    }
    const kind = CRONS[event.cron]
    if (!kind) return
    ctx.waitUntil(traced('worker.job', kind, () => run(env, kind, event.scheduledTime)))
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({ ok: true, enabled: env.WORKER_ENABLED !== 'false', configured: !!env.FIREBASE_SERVICE_ACCOUNT })
    }
    return new Response('pzmstock-cron', { status: 404 })
  },
}
