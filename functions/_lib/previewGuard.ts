import { functionTier, PREVIEW_SAFE_ROUTES, type FunctionEnv } from '../../src/lib/deployTier'

/**
 * P0 preview isolation, server side (owner, 8 Oct 2026). Run before every Pages Function
 * under /api, /a and /po (their _middleware.ts files): on anything but the production host —
 * or a declared staging tier on a non-production project — a privileged function is refused
 * BEFORE its handler runs, so no service account, KV namespace, AI binding or Gemini key is
 * touched. Decided by the request's host name: a preview deployment cannot serve the
 * production host, so its own code sees a preview host and refuses.
 *
 * Not relied on alone: preview secrets are also kept apart in the Cloudflare dashboard
 * (docs/evidence/preview-isolation.md).
 */
export const PREVIEW_ISOLATED = { error: 'preview_isolated', message: 'This deployment is a preview: privileged functions are disabled. Use the production site, or a staging project.' }

export async function previewGuard(ctx: { request: Request; env: unknown; next: () => Promise<Response> }): Promise<Response> {
  const url = new URL(ctx.request.url)
  const tier = functionTier(url.hostname, (ctx.env ?? {}) as FunctionEnv)
  if (tier === 'production' || tier === 'staging' || PREVIEW_SAFE_ROUTES.includes(url.pathname)) return ctx.next()
  return new Response(JSON.stringify(PREVIEW_ISOLATED), {
    status: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-pzm-tier': tier },
  })
}
