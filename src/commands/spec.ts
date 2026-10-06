import type { TxContext } from '../backend/tx'
import type { Role } from '../types'
import type { FileMovement } from './ledgerTx'

/**
 * A stock command (ADR-001): one transaction body that runs unchanged in the app (over the
 * Firestore SDK, while the rules still allow it) and on the server (over the service
 * account, functions/api/stock/[command].ts).
 *
 * The server trusts nothing from the caller but the command's name and its parameters, and
 * checks those with `parse`. Who the work is filed under comes from the verified token;
 * whether they may run it from `roles`; what it may write from `writes` — the service
 * account is outside the security rules, so that list is the rule for these endpoints.
 */
export type WriteOp = 'set' | 'update'

export interface CommandActor {
  id: string
  name: string
}

export interface CommandSpec<P = unknown, R = unknown> {
  name: string
  /** Who may run it through the server. */
  roles: readonly Role[]
  /** Collection kind → the writes it may make there. */
  writes: Readonly<Record<string, readonly WriteOp[]>>
  /** The request body's `params`, checked. Throws BadInput. */
  parse(raw: unknown): P
  /** Extra checks that need the caller's role (e.g. a direct site-to-site issue). */
  authorize?(params: P, role: Role): boolean
  run(tx: TxContext, file: FileMovement, params: P, actor: CommandActor): Promise<R>
}

/** A request the server will not even read the database for. */
export class BadInput extends Error {
  constructor(what: string) {
    super(`bad_request: ${what}`)
  }
}

export const defineCommand = <P, R>(spec: CommandSpec<P, R>): CommandSpec<P, R> => spec
