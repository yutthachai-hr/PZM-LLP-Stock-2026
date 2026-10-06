import { notConfigured, stockDeps, type StockEnv } from '../../_lib/stockEnv'
import { receivePOCommand } from '../../_lib/stockCommands'

/** POST /api/stock/receive-po — check a delivery in against its order (ADR-001). */
export const onRequestPost: PagesFunction<StockEnv> = async ({ request, env }) => {
  const deps = stockDeps(env)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  const r = await receivePOCommand(deps, request.headers.get('authorization'), body)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
