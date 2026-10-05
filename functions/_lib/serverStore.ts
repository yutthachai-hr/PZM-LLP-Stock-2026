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
] as const

const baseOf = (collection: string) => (collection.includes('__') ? collection.split('__')[1] : collection)

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

/** A brand's collection name, as the app's resolveCollection names it. */
export function brandCollection(brand: 'pizza' | 'lelapin', name: string): string {
  if (name === 'users' || name === 'meta' || name === 'revokedUsers' || brand === 'pizza') return name
  return `${brand}__${name}`
}

export function restServerStore(projectId: string, rawServiceAccount: string, fetcher: typeof fetch = fetch): ServerStore {
  const sa = parseServiceAccount(rawServiceAccount)
  const root = `projects/${projectId}/databases/(default)/documents`
  const base = `https://firestore.googleapis.com/v1/${root}`

  async function call(path: string, body: unknown): Promise<unknown> {
    const res = await fetcher(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken(sa, fetcher)}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
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
  }
}
