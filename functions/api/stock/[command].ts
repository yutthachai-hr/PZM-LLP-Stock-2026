import { notConfigured, stockDeps, type StockEnv } from '../../_lib/stockEnv'
import { runStockCommand } from '../../_lib/stockCommands'

/** POST /api/stock/<command> { brand, params } — the trusted stock commands (ADR-001). */
export const onRequestPost: PagesFunction<StockEnv, 'command'> = async ({ request, env, params }) => {
  const deps = stockDeps(env)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  const r = await runStockCommand(deps, String(params.command), request.headers.get('authorization'), body)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
