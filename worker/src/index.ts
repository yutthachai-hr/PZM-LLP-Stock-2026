import { accessToken, parseServiceAccount } from './auth'
import { restStore } from './firestore'
import { CRONS, runJob, type JobKind } from './jobs'

/**
 * pzmstock-cron: the inventory calendar's background jobs, on Cloudflare's free cron.
 *
 * Secrets / vars (worker/wrangler.toml, `wrangler secret put`):
 *   FIREBASE_SERVICE_ACCOUNT  the service account's JSON key (roles/datastore.user only)
 *   WORKER_ENABLED            "false" stops every job without a redeploy
 *
 * Every run ends by writing meta/cronStatus — the app reads it to know the Worker is
 * alive, and stands in for it (managers' browsers) when it has been silent over 26 hours.
 */

export interface Env {
  FIREBASE_SERVICE_ACCOUNT?: string
  WORKER_ENABLED?: string
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
    const kind = CRONS[event.cron]
    if (!kind) return
    ctx.waitUntil(run(env, kind, event.scheduledTime))
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({ ok: true, enabled: env.WORKER_ENABLED !== 'false', configured: !!env.FIREBASE_SERVICE_ACCOUNT })
    }
    return new Response('pzmstock-cron', { status: 404 })
  },
}
