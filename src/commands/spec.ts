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
  /** On the server: from the caller's `users` document, never from the request. */
  role?: Role
  siteIds?: string[]
}

/**
 * Reads a command may make before its transaction — the ones a transaction cannot make (a
 * query). Collection names as the app writes them; each side maps the brand.
 */
export interface CommandReader {
  get<T>(collection: string, id: string): Promise<T | null>
  getBy<T>(collection: string, field: string, value: string | number | boolean): Promise<T[]>
  getRange<T>(collection: string, field: string, from: number, to: number): Promise<T[]>
}

export interface CommandSpec<P = unknown, R = unknown, C = undefined> {
  name: string
  /** Who may run it through the server. */
  roles: readonly Role[]
  /** Only for these brands, when set (Smart Other item: R&D first). Checked on both paths. */
  brands?: readonly string[]
  /** Collection kind → the writes it may make there. */
  writes: Readonly<Record<string, readonly WriteOp[]>>
  /** The request body's `params`, checked. Throws BadInput. */
  parse(raw: unknown): P
  /** Extra checks that need the caller's role (e.g. a direct site-to-site issue). */
  authorize?(params: P, role: Role): boolean
  /** Reads made before the transaction; their result is handed to `run`. */
  prepare?(read: CommandReader, params: P): Promise<C>
  run(tx: TxContext, file: FileMovement, params: P, actor: CommandActor, ctx: C): Promise<R>
}

/** A request the server will not even read the database for. */
export class BadInput extends Error {
  constructor(what: string) {
    super(`bad_request: ${what}`)
  }
}

export const defineCommand = <P, R, C = undefined>(spec: CommandSpec<P, R, C>): CommandSpec<P, R, C> => spec
