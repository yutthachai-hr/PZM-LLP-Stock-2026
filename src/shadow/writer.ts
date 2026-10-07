import type { ChildSet, Plan, Upsert } from './mapping'

/**
 * Writing mapped rows into the shadow database (service role only).
 *
 * `SqlClient` is the smallest surface both drivers offer — PGlite locally and in the tests,
 * a PostgreSQL connection (or Supabase's) from the replication Worker — so the same code
 * writes in both places.
 *
 * Every write is safe to repeat:
 *  - an upsert with a version updates only when the incoming version is not older, so a
 *    late, out-of-order delivery cannot roll a record back;
 *  - a set of child rows is replaced only when its parent's upsert actually applied;
 *  - `coalesce` columns keep what another source already filled in.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>
}

/** Columns stored as jsonb: passed as JSON text and cast. */
const JSONB = new Set(['doc', 'payload', 'params', 'reasons', 'detail', 'before', 'after', 'actual_outcome', 'summary'])

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

function value(col: string, v: unknown): unknown {
  if (v === undefined) return null
  return JSONB.has(col) ? JSON.stringify(v) : v
}

function placeholder(col: string, i: number): string {
  return JSONB.has(col) ? `$${i}::jsonb` : `$${i}`
}

/** One upsert. Returns whether a row was written (inserted, or updated past the version guard). */
export async function upsert(db: SqlClient, u: Upsert): Promise<boolean> {
  const cols = Object.keys(u.row)
  const params = cols.map((c) => value(c, u.row[c]))
  const target = `shadow.${q(u.table)}`
  const insert = `insert into ${target} (${cols.map(q).join(', ')}) values (${cols.map((c, i) => placeholder(c, i + 1)).join(', ')})`
  if (u.insertOnly) {
    const r = await db.query(`${insert} on conflict (${u.pk.map(q).join(', ')}) do nothing returning 1 as ok`, params)
    return r.rows.length > 0
  }
  const set = cols
    .filter((c) => !u.pk.includes(c))
    .map((c) => (u.coalesce?.includes(c) ? `${q(c)} = coalesce(excluded.${q(c)}, ${target}.${q(c)})` : `${q(c)} = excluded.${q(c)}`))
  const where = u.versioned ? ` where ${target}.version <= excluded.version` : ''
  const sql = set.length
    ? `${insert} on conflict (${u.pk.map(q).join(', ')}) do update set ${set.join(', ')}${where} returning 1 as ok`
    : `${insert} on conflict (${u.pk.map(q).join(', ')}) do nothing returning 1 as ok`
  const r = await db.query(sql, params)
  return r.rows.length > 0
}

const CHILD_PK: Record<string, string[]> = {
  unit_conversions: ['brand', 'product_id', 'label'],
  purchase_request_lines: ['brand', 'request_id', 'line_no'],
  purchase_order_lines: ['brand', 'po_id', 'line_no'],
  transfer_lines: ['brand', 'transfer_id', 'line_no'],
}

/** Replace a parent's child rows with exactly these. */
export async function replaceChildren(db: SqlClient, c: ChildSet): Promise<void> {
  const keys = Object.keys(c.parent)
  await db.query(
    `delete from shadow.${q(c.table)} where ${keys.map((k, i) => `${q(k)} = $${i + 1}`).join(' and ')}`,
    keys.map((k) => c.parent[k]),
  )
  const pk = CHILD_PK[c.table]
  if (!pk) throw new Error(`no primary key known for child table ${c.table}`)
  // A duplicate position in the source array is kept once (the first), never an error.
  for (const row of c.rows) await upsert(db, { table: c.table, pk, row, insertOnly: true })
}

/**
 * Apply one mapped document. The first upsert is the document itself; its children are
 * rewritten only if it applied (an older delivery changes nothing at all).
 */
export async function applyPlan(db: SqlClient, plan: Plan): Promise<{ applied: boolean }> {
  const [main, ...rest] = plan.upserts
  const applied = main ? await upsert(db, main) : true
  if (!applied) return { applied: false }
  for (const c of plan.children) await replaceChildren(db, c)
  for (const u of rest) await upsert(db, u)
  return { applied: true }
}
