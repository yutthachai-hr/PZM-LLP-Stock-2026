import { liveDeps, notConfigured, type SupplierEnv } from '../../_lib/supplierEnv'
import { answerLink, viewLink } from '../../_lib/supplierPo'

/**
 * The supplier's link, no sign-in: the token is the credential.
 *   GET  /api/supplier/<token>  what the page shows (records the first view, nothing else)
 *   POST /api/supplier/<token>  { action: 'accept'|'propose', date?, note?, name?, requestId }
 */
const tokenOf = (params: Record<string, string | string[]>) => {
  const raw = params.token
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
}

const reply = (r: { status: number; body: Record<string, unknown> }) =>
  Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })

export const onRequestGet: PagesFunction<SupplierEnv> = async ({ request, env, params }) => {
  const deps = liveDeps(env, request)
  if (!deps) return notConfigured()
  return reply(await viewLink(deps, tokenOf(params)))
}

export const onRequestPost: PagesFunction<SupplierEnv> = async ({ request, env, params }) => {
  const deps = liveDeps(env, request)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  return reply(await answerLink(deps, tokenOf(params), body))
}
