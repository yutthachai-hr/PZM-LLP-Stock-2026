import { verifyFirebaseToken } from '../_poImage'
import { functionTier, type FunctionEnv } from '../../src/lib/deployTier'
import { RateLimiter, runAsk } from '../_lib/askPzm'
import { restServerStore } from '../_lib/serverStore'
import { stagingConfig } from '../_lib/stagingConfig'
import { emit, fromHeaders, traceHeaders } from '../../src/lib/trace'

/**
 * POST /api/ask — Ask PZM, read-only (owner approvals 4 and Track 2/3, 9 Oct 2026). STAGING ONLY:
 *  - the /api middleware already refuses previews (preview_isolated);
 *  - this handler refuses PRODUCTION in code; promotion is a separate owner gate and a code change;
 *  - it runs only on a complete, consistent, non-production staging configuration
 *    (_lib/stagingConfig.ts) — there is NO fallback project id, so nothing here can reach
 *    production Firebase — and only with ASK_PZM_ENABLED=true;
 *  - no model routes: `classify` is null by code (owner, Track 2: AI routing stays off).
 */
/** Cloudflare Workers Rate Limiting binding: a limit enforced across the edge, not per isolate. */
interface RateLimitBinding {
  limit(o: { key: string }): Promise<{ success: boolean }>
}
type Env = FunctionEnv & { ASK_PZM_ENABLED?: string; ASK_RATE_LIMITER?: RateLimitBinding }

const LIMITER = new RateLimiter()
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const tier = functionTier(new URL(request.url).hostname, env)
  if (tier !== 'staging') return json(404, { error: 'not_available' })
  if (env.ASK_PZM_ENABLED !== 'true') return json(404, { error: 'not_enabled' })
  const cfg = stagingConfig(env)
  // Misconfigured staging says why in the log, and only "not_configured" to the caller.
  if (!cfg.ok) {
    emit({ stage: 'api.ask', outcome: 'refused', code: 503, name: cfg.reason } as Parameters<typeof emit>[0])
    return json(503, { error: 'not_configured' })
  }
  // The global limit is required: without the binding there is no hard limit, so no service.
  if (!env.ASK_RATE_LIMITER) {
    emit({ stage: 'api.ask', outcome: 'refused', code: 503, name: 'rate_limiter_missing' } as Parameters<typeof emit>[0])
    return json(503, { error: 'not_configured' })
  }
  const body = await request.json().catch(() => null)
  const { inherited: _i, ...trace } = fromHeaders((h) => request.headers.get(h))
  void _i
  const r = await runAsk(
    {
      store: restServerStore(cfg.projectId, cfg.serviceAccount),
      // Only tokens issued by the staging project's Firebase Auth are accepted.
      verifyUser: (h) => verifyFirebaseToken(h, cfg.projectId),
      now: () => Date.now(),
      limiter: LIMITER,
      globalLimit: async (uid) => (await env.ASK_RATE_LIMITER!.limit({ key: `ask:${uid}` })).success,
    },
    request.headers.get('authorization'),
    body,
  )
  // One log line per call: ids, outcome, reads, time. Never the question or the answer.
  emit({ ...trace, stage: 'api.ask', outcome: r.status === 200 ? 'ok' : 'refused', code: r.status, ms: Number(r.body.ms ?? 0), count: Number(r.body.reads ?? 0) })
  return json(r.status, r.body, traceHeaders(trace))
}
