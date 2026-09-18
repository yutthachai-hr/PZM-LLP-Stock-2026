import { decodeFields, encode, encodeFields, type FsValue } from './codec'
import { assertWritable, type Filter, type Store, type WriteOp } from './store'

/**
 * The Store over Firestore's REST API, signed in as the service account. Service accounts
 * are outside the security rules, which is why the collections it may write are pinned in
 * code (store.ts) and by a test.
 */

const OP: Record<Filter['op'], string> = {
  '==': 'EQUAL',
  '>=': 'GREATER_THAN_OR_EQUAL',
  '<=': 'LESS_THAN_OR_EQUAL',
  '<': 'LESS_THAN',
  '>': 'GREATER_THAN',
  in: 'IN',
}

interface RunQueryRow {
  document?: { name: string; fields?: Record<string, FsValue> }
}

export function restStore(projectId: string, token: () => Promise<string>, fetcher: typeof fetch = fetch): Store {
  const root = `projects/${projectId}/databases/(default)/documents`
  const base = `https://firestore.googleapis.com/v1/${root}`

  async function call(path: string, body: unknown): Promise<unknown> {
    const res = await fetcher(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`firestore ${path}: ${res.status} ${await res.text()}`)
    return res.json()
  }

  const docOf = (name: string, fields?: Record<string, FsValue>) => ({ ...decodeFields(fields ?? {}), id: name.split('/').pop()! })

  return {
    async query<T>(collection: string, filters: Filter[] = [], opts: { limit?: number; orderBy?: string } = {}): Promise<T[]> {
      const where = filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: OP[f.op], value: encode(f.value) } }))
      const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection }] }
      if (where.length === 1) structuredQuery.where = where[0]
      if (where.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: where } }
      if (opts.orderBy) structuredQuery.orderBy = [{ field: { fieldPath: opts.orderBy }, direction: 'ASCENDING' }]
      if (opts.limit) structuredQuery.limit = opts.limit
      const rows = (await call(':runQuery', { structuredQuery })) as RunQueryRow[]
      return rows.filter((r) => r.document).map((r) => docOf(r.document!.name, r.document!.fields) as T)
    },

    async get<T>(collection: string, id: string): Promise<T | null> {
      const rows = (await call(':batchGet', { documents: [`${root}/${collection}/${id}`] })) as { found?: { name: string; fields?: Record<string, FsValue> } }[]
      const found = rows.find((r) => r.found)?.found
      return found ? (docOf(found.name, found.fields) as T) : null
    },

    async write(ops: WriteOp[]): Promise<boolean[]> {
      const out: boolean[] = []
      // batchWrite: each write stands alone, so one refused create does not sink the rest.
      for (let i = 0; i < ops.length; i += 500) {
        const chunk = ops.slice(i, i + 500)
        const writes = chunk.map((op) => {
          assertWritable(op.collection)
          const name = `${root}/${op.collection}/${op.id}`
          switch (op.type) {
            case 'create':
              return { update: { name, fields: encodeFields({ ...op.doc, id: op.id }) }, currentDocument: { exists: false } }
            case 'set':
              return { update: { name, fields: encodeFields({ ...op.doc, id: op.id }) } }
            case 'patch':
              return { update: { name, fields: encodeFields(op.fields) }, updateMask: { fieldPaths: Object.keys(op.fields) }, currentDocument: { exists: true } }
            case 'delete':
              return { delete: name }
          }
        })
        const res = (await call(':batchWrite', { writes })) as { status?: { code?: number }[] }
        for (let j = 0; j < chunk.length; j++) out.push(!res.status?.[j]?.code)
      }
      return out
    },
  }
}
