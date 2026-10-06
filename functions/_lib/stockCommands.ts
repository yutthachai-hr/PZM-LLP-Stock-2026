import type { AppUser } from '../../src/types'
import { AppError } from '../../src/i18n/AppError'
import { COL } from '../../src/types'
import { STOCK_COMMANDS } from '../../src/commands/stockCommands'
import { BadInput, type CommandSpec } from '../../src/commands/spec'
import type { ServerStore } from './serverStore'
import { runServerTx, TxConflict } from './serverTx'

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
  verifyUser: (authorization: string | null) => Promise<string | null>
}

export interface Reply {
  status: number
  body: Record<string, unknown>
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } })
const isBrand = (b: unknown): b is 'pizza' | 'lelapin' => b === 'pizza' || b === 'lelapin'

async function caller(deps: StockDeps, authorization: string | null): Promise<AppUser | null> {
  const uid = await deps.verifyUser(authorization)
  if (!uid) return null
  if (await deps.store.get('revokedUsers', uid)) return null
  const user = (await deps.store.get<AppUser>('users', uid))?.doc
  return user && user.active === true ? { ...user, id: uid } : null
}

export async function runStockCommand(deps: StockDeps, name: string, authorization: string | null, body: unknown): Promise<Reply> {
  const spec = (STOCK_COMMANDS as Record<string, CommandSpec<unknown, unknown>>)[name]
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
  const actor = { id: user.id, name: user.name }
  try {
    const result = await runServerTx(deps.store, b.brand, spec, (tx) =>
      spec.run(tx, (mv, given) => tx.set(COL.movements, given ?? deps.makeId(), mv as Record<string, unknown>), params, actor),
    )
    return { status: 200, body: { result } }
  } catch (e) {
    if (e instanceof AppError) return fail(422, 'app', { key: e.key, ...(e.vars ? { vars: e.vars } : {}) })
    if (e instanceof TxConflict) return fail(409, 'busy')
    throw e
  }
}
