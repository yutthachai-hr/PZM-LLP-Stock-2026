import { liveDeps, notConfigured, type SupplierEnv } from '../../_lib/supplierEnv'
import { decideDate } from '../../_lib/supplierPo'

/** POST /api/supplier-po/decide { brand, poId, changeId, decision, reason } — หัวหน้า/admin only. */
export const onRequestPost: PagesFunction<SupplierEnv> = async ({ request, env }) => {
  const deps = liveDeps(env, request)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  const r = await decideDate(deps, request.headers.get('authorization'), body)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
