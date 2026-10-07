import type { SqlClient } from './writer'

/**
 * The shadow tools' SqlClient over PGlite (PostgreSQL in-process) — for the tests and for
 * rehearsing a backfill and parity run on this machine before a Supabase project exists.
 * Against Supabase itself the same tools take a PostgreSQL connection with the service
 * role, from the Worker or an operator's machine — never from a browser.
 */
interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  transaction<T>(fn: (tx: { query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>
}

export function pgliteClient(db: PgliteLike): SqlClient {
  const wrap = (q: PgliteLike['query']): SqlClient => ({
    query: (sql, params) => q(sql, params),
    transaction: () => {
      throw new Error('nested transactions are not used by the shadow tools')
    },
  })
  return {
    query: (sql, params) => db.query(sql, params),
    transaction: (fn) => db.transaction((tx) => fn(wrap((sql, params) => tx.query(sql, params)))),
  }
}
