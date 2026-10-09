import { accessToken, parseServiceAccount } from '../../worker/src/auth'
import { decodeFields, encodeFields, type FsValue } from '../../worker/src/codec'

/**
 * What the supplier-confirmation functions may do to the database, and nothing more.
 *
 * The live implementation is Firestore over REST, signed in as the service account
 * (FIREBASE_SERVICE_ACCOUNT, the same least-privilege key the cron Worker uses). Service
 * accounts are outside the security rules, so what these functions may write is pinned
 * here, field by field, and by a test: an order's supplier-answer fields plus `expectedAt`
 * and `updatedAt`, and new notifications. Nothing else, in either brand.
 *
 * Every order write is conditional on the document's `updateTime` from the read — two
 * answers arriving together cannot both apply on top of the same old state.
 */

export interface Versioned<T> {
  doc: T
  updateTime: string
}

export interface ServerStore {
  get<T>(collection: string, id: string): Promise<Versioned<T> | null>
  /**
   * Change these fields (null removes one) only if the document still has `updateTime`.
   * False when someone else wrote it first — read again and retry.
   */
  patchIf(collection: string, id: string, fields: Record<string, unknown>, updateTime: string): Promise<boolean>
  /** Create only if no document has that id. False when one already does. */
  create(collection: string, id: string, doc: Record<string, unknown>): Promise<boolean>
  /**
   * Several writes as one atomic commit, each with its precondition (ADR-001): all land or
   * none does. False when a precondition failed — someone wrote in between; read again.
   * Only the stock commands use it, and only for the writes `assertCommandWrite` allows.
   */
  commit(writes: readonly ServerWrite[]): Promise<boolean>
  /** Documents of one collection matching every filter (equality, or a range on one field). */
  query<T>(collection: string, filters: readonly QueryFilter[]): Promise<T[]>
}

export interface QueryFilter {
  field: string
  op: '==' | '>=' | '<='
  value: string | number | boolean
}

/** One write in a commit. `update` changes only the named fields; null in `data` removes one. */
export interface ServerWrite {
  /** `verify` writes nothing: it only makes the commit fail if the document moved since read. */
  op: 'set' | 'update' | 'verify'
  collection: string
  id: string
  data: Record<string, unknown>
  /** The document's updateTime when it was read, or whether it must (not) exist. */
  precondition?: { updateTime: string } | { exists: boolean }
}

/** The order fields a supplier answer, a link or a decision may write. */
export const SERVER_PO_FIELDS = [
  'requestedDeliveryDate',
  'confirmedDeliveryDate',
  'supplierConfirmationStatus',
  'supplierConfirmedAt',
  'supplierConfirmedBy',
  'supplierDeliveryNote',
  'deliveryDateHistory',
  'pendingDeliveryDate',
  'supplierLink',
  'supplierActivity',
  'expectedAt',
  'updatedAt',
  // G25: every write moves the order's version (worked out from the copy read, under its updateTime).
  'version',
] as const

export const baseOf = (collection: string) => (collection.includes('__') ? collection.split('__')[1] : collection)

/** Throws unless this write is one the functions are allowed to make. */
export function assertServerWrite(collection: string, fields: Record<string, unknown>, kind: 'patch' | 'create'): void {
  const base = baseOf(collection)
  if (kind === 'patch' && base === 'purchaseOrders') {
    const bad = Object.keys(fields).filter((k) => !(SERVER_PO_FIELDS as readonly string[]).includes(k))
    if (bad.length) throw new Error(`may not write purchaseOrders.${bad.join(', ')}`)
    return
  }
  if (kind === 'create' && base === 'notifications') return
  throw new Error(`may not ${kind} ${collection}`)
}

/** The brands the server serves (src/brand/brand.ts BrandId; the Worker cannot import that file). */
export type ServerBrand = 'pizza' | 'lelapin' | 'rnd'
export const SERVER_BRANDS: readonly ServerBrand[] = ['pizza', 'lelapin', 'rnd']

/** A brand's collection name, as the app's resolveCollection names it. */
export function brandCollection(brand: ServerBrand, name: string): string {
  if (name === 'users' || name === 'meta' || name === 'revokedUsers' || brand === 'pizza') return name
  return `${brand}__${name}`
}


/**
 * Throws unless every write is one this command is allowed to make (ADR-001). The service
 * account is outside the security rules, so the command's own `writes` list — collection
 * kind → operations — is the rule; a test pins every command's list.
 */
export function assertCommandWrite(
  command: string,
  allowed: Readonly<Record<string, readonly string[]>>,
  writes: readonly ServerWrite[],
): void {
  for (const w of writes) {
    if (w.op === 'verify') continue
    const ops = allowed[baseOf(w.collection)]
    if (!ops || !ops.includes(w.op)) throw new Error(`${command} may not ${w.op} ${w.collection}`)
  }
}

export function restServerStore(
  projectId: string,
  rawServiceAccount: string,
  fetcher: typeof fetch = fetch,
  /**
   * Tests only: talk to the Firestore emulator (`http://127.0.0.1:8080`) with its `owner`
   * token instead of Google with the service account.
   */
  emulator?: { host: string },
): ServerStore {
  const root = `projects/${projectId}/databases/(default)/documents`
  const base = emulator ? `${emulator.host}/v1/${root}` : `https://firestore.googleapis.com/v1/${root}`
  const sa = emulator ? null : parseServiceAccount(rawServiceAccount)
  const bearer = async () => (sa ? await accessToken(sa, fetcher) : 'owner')

  async function send(path: string, body: unknown): Promise<Response> {
    return fetcher(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function call(path: string, body: unknown): Promise<unknown> {
    const res = await send(path, body)
    if (!res.ok) throw new Error(`firestore ${path}: ${res.status} ${await res.text()}`)
    return res.json()
  }

  /** One write through batchWrite: true written, false refused by its precondition. */
  async function writeOne(write: Record<string, unknown>): Promise<boolean> {
    const res = (await call(':batchWrite', { writes: [write] })) as { status?: { code?: number; message?: string }[] }
    const code = res.status?.[0]?.code ?? 0
    if (code === 0) return true
    // 9 FAILED_PRECONDITION (updateTime moved), 6 ALREADY_EXISTS (create): a lost race.
    if (code === 9 || code === 6) return false
    throw new Error(`firestore write: ${code} ${res.status?.[0]?.message ?? ''}`)
  }

  return {
    async get<T>(collection: string, id: string): Promise<Versioned<T> | null> {
      const rows = (await call(':batchGet', { documents: [`${root}/${collection}/${id}`] })) as {
        found?: { name: string; fields?: Record<string, FsValue>; updateTime: string }
      }[]
      const found = rows.find((r) => r.found)?.found
      if (!found) return null
      return { doc: { ...decodeFields(found.fields ?? {}), id } as T, updateTime: found.updateTime }
    },

    async patchIf(collection, id, fields, updateTime) {
      assertServerWrite(collection, fields, 'patch')
      const present: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) present[k] = v
      return writeOne({
        update: { name: `${root}/${collection}/${id}`, fields: encodeFields(present) },
        // A field in the mask but not in `fields` is removed — that is how null deletes.
        updateMask: { fieldPaths: Object.keys(fields).filter((k) => fields[k] !== undefined) },
        currentDocument: { updateTime },
      })
    },

    async create(collection, id, doc) {
      assertServerWrite(collection, doc, 'create')
      return writeOne({
        update: { name: `${root}/${collection}/${id}`, fields: encodeFields({ ...doc, id }) },
        currentDocument: { exists: false },
      })
    },

    async query<T>(collection: string, filters: readonly QueryFilter[]): Promise<T[]> {
      const OP = { '==': 'EQUAL', '>=': 'GREATER_THAN_OR_EQUAL', '<=': 'LESS_THAN_OR_EQUAL' } as const
      const fieldFilters = filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: OP[f.op], value: encodeFields({ v: f.value }).v } }))
      const where = fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: 'AND', filters: fieldFilters } }
      const rows = (await call(':runQuery', { structuredQuery: { from: [{ collectionId: collection }], ...(fieldFilters.length ? { where } : {}) } })) as {
        document?: { name: string; fields?: Record<string, FsValue> }
      }[]
      return rows.filter((r) => r.document).map((r) => ({ ...decodeFields(r.document!.fields ?? {}), id: r.document!.name.split('/').pop() }) as T)
    },

    async commit(writes) {
      const body = {
        writes: writes.map((w) => {
          const name = `${root}/${w.collection}/${w.id}`
          if (w.op === 'verify') return { verify: name, ...(w.precondition ? { currentDocument: w.precondition } : {}) }
          const present: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(w.data)) if (v !== null && v !== undefined) present[k] = v
          return {
            update: { name, fields: encodeFields(w.op === 'set' ? { ...present, id: w.id } : present) },
            ...(w.op === 'update' ? { updateMask: { fieldPaths: Object.keys(w.data).filter((k) => w.data[k] !== undefined) } } : {}),
            ...(w.precondition ? { currentDocument: w.precondition } : {}),
          }
        }),
      }
      const res = await send(':commit', body)
      if (res.ok) return true
      const text = await res.text()
      // A precondition that failed is a lost race, not an error: the caller reads again.
      if (res.status === 409 || res.status === 404 || /FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED|NOT_FOUND/.test(text)) return false
      throw new Error(`firestore :commit: ${res.status} ${text}`)
    },
  }
}
