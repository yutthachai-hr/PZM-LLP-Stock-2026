import { liveDeps, notConfigured, type SupplierEnv } from '../../_lib/supplierEnv'
import { revokeLink } from '../../_lib/supplierPo'

/** POST /api/supplier-po/revoke { brand, poId } — หัวหน้า/admin: take a leaked supplier link back. */
export const onRequestPost: PagesFunction<SupplierEnv> = async ({ request, env }) => {
  const deps = liveDeps(env, request)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  const r = await revokeLink(deps, request.headers.get('authorization'), body)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
