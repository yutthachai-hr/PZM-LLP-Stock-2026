import { PROJECT_ID, verifyFirebaseToken } from '../_poImage'
import { functionTier, type FunctionEnv } from '../../src/lib/deployTier'
import { gatewayClassifier, type GatewayEnv } from '../_lib/aiGateway'
import { RateLimiter, runAsk } from '../_lib/askPzm'
import { restServerStore } from '../_lib/serverStore'
import { emit, fromHeaders, traceHeaders } from '../../src/lib/trace'

/**
 * POST /api/ask — Ask PZM, read-only (owner approval 4, 9 Oct 2026). STAGING ONLY:
 *  - the /api middleware already refuses previews (preview_isolated);
 *  - this handler refuses PRODUCTION too, in code. Promotion is a separate owner gate and a
 *    code change, not a dashboard switch;
 *  - and it is off unless ASK_PZM_ENABLED=true on the staging deployment.
 */
type Env = FunctionEnv & GatewayEnv & { ASK_PZM_ENABLED?: string }

const LIMITER = new RateLimiter()
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const tier = functionTier(new URL(request.url).hostname, env)
  if (tier !== 'staging') return json(404, { error: 'not_available' })
  if (env.ASK_PZM_ENABLED !== 'true' || !env.FIREBASE_SERVICE_ACCOUNT) return json(404, { error: 'not_enabled' })
  const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim() || PROJECT_ID
  const body = await request.json().catch(() => null)
  const { inherited: _i, ...trace } = fromHeaders((h) => request.headers.get(h))
  void _i
  const r = await runAsk(
    {
      store: restServerStore(projectId, env.FIREBASE_SERVICE_ACCOUNT),
      verifyUser: (h) => verifyFirebaseToken(h, projectId),
      now: () => Date.now(),
      classify: gatewayClassifier(env),
      limiter: LIMITER,
    },
    request.headers.get('authorization'),
    body,
  )
  // One log line per call: ids, outcome, reads, time. Never the question or the answer.
  emit({ ...trace, stage: 'api.ask', outcome: r.status === 200 ? 'ok' : 'refused', code: r.status, ms: Number(r.body.ms ?? 0), count: Number(r.body.reads ?? 0) })
  return json(r.status, r.body, traceHeaders(trace))
}
