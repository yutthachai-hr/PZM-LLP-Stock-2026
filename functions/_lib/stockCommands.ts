import type { AppUser } from '../../src/types'
import { AppError } from '../../src/i18n/AppError'
import { COL } from '../../src/types'
import { STOCK_COMMANDS } from '../../src/commands/stockCommands'
import { BadInput, type CommandReader, type CommandSpec } from '../../src/commands/spec'
import { brandCollection, SERVER_BRANDS, type ServerBrand, type ServerStore } from './serverStore'
import { runServerTx, TxConflict } from './serverTx'
import { emit, isOperationId, type TraceContext } from '../../src/lib/trace'

/**
 * The trusted command boundary for stock (ADR-001, plan A3).
 *
 * Every number written to the ledger and the balances is worked out here from what the
 * server reads — the caller says what happened (which order, which lines, which bill), never
 * what a balance should become. The transaction bodies are the app's own (src/commands), so
 * a command and the app's client path cannot disagree; tests/functions/stock-commands.test.ts
 * holds them to that with a golden comparison.
 *
 * Who may call: an active, unrevoked user, checked against `users/{uid}` as the rules'
 * active() does, whose role the command allows. Who it is filed under: that user — the body
 * cannot name anyone.
 *
 *   POST /api/stock/<command>   { brand, params }
 */

export interface StockDeps {
  store: ServerStore
  now: () => number
  makeId: () => string
  /** A UUID per outbox event. Absent: no outbox (the tests that do not look at it). */
  eventId?: () => string
  verifyUser: (authorization: string | null) => Promise<string | null>
}

export interface Reply {
  status: number
  body: Record<string, unknown>
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } })
const isBrand = (b: unknown): b is ServerBrand => SERVER_BRANDS.includes(b as ServerBrand)

/** The command's own idempotency id, when it has one (receivePO), as the trace's operationId. */
const opIdOf = (p: unknown): string | undefined => {
  const v = (p as { operationId?: unknown } | null)?.operationId
  return isOperationId(v) ? v : undefined
}

async function caller(deps: StockDeps, authorization: string | null): Promise<AppUser | null> {
  const uid = await deps.verifyUser(authorization)
  if (!uid) return null
  if (await deps.store.get('revokedUsers', uid)) return null
  const user = (await deps.store.get<AppUser>('users', uid))?.doc
  return user && user.active === true ? { ...user, id: uid } : null
}

export async function runStockCommand(deps: StockDeps, name: string, authorization: string | null, body: unknown, trace?: TraceContext): Promise<Reply> {
  const started = deps.now()
  const reply = await runCommand(deps, name, authorization, body, trace)
  if (trace) {
    // G18: one line per call — ids, outcome, time. Never the parameters or the result.
    const outcome = reply.status === 200 ? 'ok' : reply.status === 409 ? 'conflict' : reply.status >= 500 ? 'error' : 'refused'
    emit({ ...trace, stage: 'api.command', name, outcome, code: reply.status, ms: deps.now() - started, brand: isBrand((body as { brand?: unknown } | null)?.brand) ? (body as { brand: ServerBrand }).brand : undefined })
  }
  return reply
}

async function runCommand(deps: StockDeps, name: string, authorization: string | null, body: unknown, trace?: TraceContext): Promise<Reply> {
  const spec = (STOCK_COMMANDS as Record<string, CommandSpec<unknown, unknown, unknown>>)[name]
  if (!spec || !Object.hasOwn(STOCK_COMMANDS, name)) return fail(404, 'no_such_command')
  const user = await caller(deps, authorization)
  if (!user) return fail(401, 'unauthorized')
  if (!spec.roles.includes(user.role)) return fail(403, 'forbidden')
  const b = (body ?? {}) as Record<string, unknown>
  if (!isBrand(b.brand)) return fail(400, 'bad_request', { at: 'brand' })
  let params: unknown
  try {
    params = spec.parse(b.params)
  } catch (e) {
    if (e instanceof BadInput || e instanceof AppError) return fail(400, 'bad_request', { at: e.message })
    throw e
  }
  if (spec.authorize && !spec.authorize(params, user.role)) return fail(403, 'forbidden')
  // Who it is, from their own record: name, role and sites — never from the request.
  const actor = { id: user.id, name: user.name, role: user.role, ...(user.siteIds ? { siteIds: user.siteIds } : {}) }
  const brand = b.brand
  const read: CommandReader = {
    get: async <T,>(c: string, id: string) => (await deps.store.get<T>(brandCollection(brand, c), id))?.doc ?? null,
    getBy: (c, field, value) => deps.store.query(brandCollection(brand, c), [{ field, op: '==', value }]),
    getRange: (c, field, from, to) => deps.store.query(brandCollection(brand, c), [{ field, op: '>=', value: from }, { field, op: '<=', value: to }]),
  }
  try {
    const ctx = spec.prepare ? await spec.prepare(read, params) : undefined
    const result = await runServerTx(deps.store, brand, spec, (tx) =>
      spec.run(tx, (mv, given) => tx.set(COL.movements, given ?? deps.makeId(), mv as Record<string, unknown>), params, actor, ctx),
      5,
      deps.eventId ? { now: deps.now, eventId: deps.eventId, ...(trace ? { trace: { ...trace, ...(opIdOf(params) ? { operationId: opIdOf(params) } : {}) } } : {}) } : undefined,
    )
    return { status: 200, body: { result } }
  } catch (e) {
    if (e instanceof AppError) return fail(422, 'app', { key: e.key, ...(e.vars ? { vars: e.vars } : {}) })
    if (e instanceof TxConflict) return fail(409, 'busy')
    throw e
  }
}
