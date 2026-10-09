import type { SqlClient } from './writer'

/**
 * The shadow tools' SqlClient over a real PostgreSQL connection — the Supabase project,
 * reached with the `postgres` driver (porsager) from an operator's machine or the cron
 * Worker. The connection string carries the database password: it lives in an environment
 * variable / Worker secret, never in the repository and never in a browser.
 */
interface PgSql {
  unsafe<T>(query: string, params?: unknown[]): Promise<T[]>
  begin<T>(fn: (tx: PgSql) => Promise<T>): Promise<T>
}

export function postgresClient(sql: PgSql): SqlClient {
  const wrap = (s: PgSql, inTx: boolean): SqlClient => ({
    query: async <T,>(q: string, params: unknown[] = []) => ({ rows: (await s.unsafe<T>(q, params as never[])) as T[] }),
    transaction: <T,>(fn: (tx: SqlClient) => Promise<T>) => {
      if (inTx) throw new Error('nested transactions are not used by the shadow tools')
      return s.begin((tx) => fn(wrap(tx, true)))
    },
  })
  return wrap(sql, false)
}
