import { notConfigured, stockDeps, type StockEnv } from '../../_lib/stockEnv'
import { runStockCommand } from '../../_lib/stockCommands'
import { fromHeaders, traceHeaders } from '../../../src/lib/trace'

/** POST /api/stock/<command> { brand, params } — the trusted stock commands (ADR-001). */
export const onRequestPost: PagesFunction<StockEnv, 'command'> = async ({ request, env, params }) => {
  const deps = stockDeps(env)
  if (!deps) return notConfigured()
  const body = await request.json().catch(() => null)
  // G18: the workflow and request ids the app sent (or fresh ones), echoed back on the reply.
  const { inherited: _inherited, ...trace } = fromHeaders((h) => request.headers.get(h), (body as { params?: { operationId?: unknown } } | null)?.params?.operationId)
  void _inherited
  const r = await runStockCommand(deps, String(params.command), request.headers.get('authorization'), body, trace)
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store', ...traceHeaders(trace) } })
}
