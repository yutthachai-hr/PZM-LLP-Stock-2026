import { liveDeps, notConfigured, type SupplierEnv } from '../../_lib/supplierEnv'
import { markLinkRequested } from '../../_lib/supplierPo'

/** POST /api/supplier-po/requested { brand, poId, version } — signed-in staff: the sheet with this link went (A2). */
export const onRequestPost: PagesFunction<SupplierEnv> = async ({ request, env }) => {
  const deps = liveDeps(env, request)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  const r = await markLinkRequested(deps, request.headers.get('authorization'), body)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
