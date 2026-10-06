/**
 * A bounded, filtered query in a shape every backend can run (perf/firestore-read-budget,
 * 6 Oct 2026): "this person's latest 30 notifications", "the next 50 movements before this
 * one". Firestore runs it on the server — the whole point, as the client no longer receives
 * documents only to throw them away. The local and test backends run the same spec in
 * memory with `applySpec`, so demo mode shows the same rows.
 *
 * A spec that combines an array filter or several fields with an order needs a composite
 * index in Firestore (firestore.indexes.json); the callers say which.
 */

export type QueryOp = '==' | '>=' | '<=' | '<' | '>' | 'in' | 'array-contains-any'

export interface QueryFilter {
  field: string
  op: QueryOp
  value: unknown
}

export interface QuerySpec {
  filters?: QueryFilter[]
  orderBy?: { field: string; dir?: 'asc' | 'desc' }
  limit?: number
}

function get(d: Record<string, unknown>, path: string): unknown {
  let v: unknown = d
  for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return v
}

function matches(d: Record<string, unknown>, f: QueryFilter): boolean {
  const v = get(d, f.field)
  switch (f.op) {
    case '==':
      return v === f.value
    case '>=':
      return typeof v === 'number' && v >= (f.value as number)
    case '<=':
      return typeof v === 'number' && v <= (f.value as number)
    case '<':
      return typeof v === 'number' && v < (f.value as number)
    case '>':
      return typeof v === 'number' && v > (f.value as number)
    case 'in':
      return (f.value as unknown[]).includes(v)
    case 'array-contains-any':
      return Array.isArray(v) && (f.value as unknown[]).some((x) => v.includes(x))
  }
}

/** The spec run in memory: what Firestore would return for it. */
export function applySpec<T>(docs: readonly T[], spec: QuerySpec | undefined): T[] {
  if (!spec) return [...docs]
  let out = docs.filter((d) => (spec.filters ?? []).every((f) => matches(d as Record<string, unknown>, f)))
  if (spec.orderBy) {
    const { field, dir = 'asc' } = spec.orderBy
    const sign = dir === 'desc' ? -1 : 1
    out = [...out].sort((a, b) => {
      const x = get(a as Record<string, unknown>, field) as number
      const y = get(b as Record<string, unknown>, field) as number
      return x === y ? 0 : x < y ? -sign : sign
    })
  }
  return spec.limit !== undefined ? out.slice(0, spec.limit) : out
}
