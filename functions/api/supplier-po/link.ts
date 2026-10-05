import { liveDeps, notConfigured, type SupplierEnv } from '../../_lib/supplierEnv'
import { mintLink } from '../../_lib/supplierPo'

/** POST /api/supplier-po/link { brand, poId } — signed-in staff: the link to send with the sheet. */
export const onRequestPost: PagesFunction<SupplierEnv> = async ({ request, env }) => {
  const deps = liveDeps(env, request)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  const r = await mintLink(deps, request.headers.get('authorization'), body)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
