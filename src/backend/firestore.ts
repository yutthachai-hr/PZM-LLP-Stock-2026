import {
  collection as fbCollection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  runTransaction,
  where,
  deleteField,
  documentId,
  orderBy as fbOrderBy,
  limit as fbLimit,
  type QueryConstraint,
} from 'firebase/firestore'
import { getDb } from '../firebase/app'
import { DELETE_FIELD, type Backend, type QuerySpec, type ReadOptions, type SubscribeOptions, type TxContext } from './types'
import { resolveCollection, type BrandId } from '../brand/brand'
import { currentResumeEpoch, isReturningFromAbsence, noteListener, noteReadOp, onReturnFromLongAbsence, RESUME_TOKEN_MS } from '../data/readMeter'

/**
 * When each listener last heard from the server, kept across reloads: a reload within 30
 * minutes resumes from the offline copy and is billed only for what changed; after that it
 * is billed as a new query. Keys are labels and filters, never document contents.
 */
const SEEN_KEY = 'pzm.reads.lastServer'
function lastServerAt(key: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
    return all[key] ?? null
  } catch {
    return null
  }
}
function markServer(key: string, at: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
    all[key] = at
    localStorage.setItem(SEEN_KEY, JSON.stringify(all))
  } catch {
    // no storage: the estimate is just less precise
  }
}
const activeKeys = new Set<string>()
// Back from more than 30 minutes away: no listener has been in touch with the server
// since, whatever the marks say (a test can declare the absence without the time passing).
onReturnFromLongAbsence(() => {
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    // no storage
  }
})
if (typeof document !== 'undefined') {
  // Still connected up to the moment the page is hidden: that is when the 30 minutes start.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') for (const k of activeKeys) markServer(k, Date.now())
  })
}

// Firestore implementation. Real-time across all devices, offline persistence enabled.
// Collection names are brand-scoped via resolveCollection() so brands stay fully isolated.

/** The spec as Firestore query constraints. */
function constraints(spec: QuerySpec | undefined): QueryConstraint[] {
  if (!spec) return []
  const out: QueryConstraint[] = (spec.filters ?? []).map((f) => where(f.field, f.op, f.value))
  if (spec.orderBy) out.push(fbOrderBy(spec.orderBy.field, spec.orderBy.dir ?? 'asc'))
  if (spec.limit !== undefined) out.push(fbLimit(spec.limit))
  return out
}

/** Turn our DELETE_FIELD marker into Firestore's own. */
function toFirestorePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === DELETE_FIELD ? deleteField() : v
  return out
}

export function createFirestoreBackend(brand?: BrandId): Backend {
  // `brand` undefined means "whatever is selected right now", which is what screens
  // want. Multi-step work calls forBrand() first and gets a copy pinned to one brand.
  const resolve = (name: string) => resolveCollection(name, brand)
  return {
    forBrand: (b: BrandId) => createFirestoreBackend(b),

    mode: 'cloud',

    subscribe<T>(collection: string, cb: (docs: T[]) => void, opts?: SubscribeOptions): () => void {
      const db = getDb()
      const c = resolve(collection)
      const ref = fbCollection(db, c)
      // A single-field range filter is served by Firestore's automatic index, so this
      // needs no composite index to be deployed alongside it.
      const parts = [...(opts?.since ? [where(opts.since.field, '>=', opts.since.value)] : []), ...constraints(opts?.query)]
      const q = parts.length ? query(ref, ...parts) : ref
      const label = opts?.label ?? `${collection}.listen`
      const key = `${c}|${label}|${opts?.since ? `${opts.since.field}>=${opts.since.value}` : '*'}|${opts?.query ? JSON.stringify(opts.query) : ''}`
      // Every delivery is counted where it arrives (data/readMeter.ts): served from the
      // device's copy (free), the first answer from the server (the whole result, unless
      // resumed within 30 minutes), a return after a long absence (the whole result again),
      // and the changes after that.
      let delivered = false
      let fromServer = false
      let sawCache = false
      let epoch = currentResumeEpoch()
      noteListener(1)
      activeKeys.add(key)
      const unsub = onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) => {
          const changes = snap.docChanges().length
          const cached = snap.metadata.fromCache
          if (cached) {
            if (!delivered) {
              sawCache = true
              noteReadOp({ label, collection: c, kind: 'listen.bootstrap', docs: snap.size, fromCache: true })
            }
          } else if (!fromServer) {
            const last = lastServerAt(key)
            const resumed = sawCache && last !== null && Date.now() - last < RESUME_TOKEN_MS
            noteReadOp({ label, collection: c, kind: 'listen.bootstrap', docs: snap.size, billed: resumed ? changes : Math.max(1, snap.size) })
            fromServer = true
            epoch = currentResumeEpoch()
          } else if (currentResumeEpoch() !== epoch) {
            noteReadOp({ label, collection: c, kind: 'listen.resume', docs: snap.size, billed: Math.max(1, snap.size) })
            epoch = currentResumeEpoch()
          } else if (changes > 0) {
            noteReadOp({ label, collection: c, kind: 'listen.update', docs: changes })
          }
          if (!cached) markServer(key, Date.now())
          // A change of metadata alone (cache → server with nothing new) is not news.
          if (delivered && changes === 0) return
          delivered = true
          cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T))
        },
        (err) => {
          console.error(`[firestore] subscribe ${c} failed`, err)
          opts?.onError?.(err)
        },
      )
      return () => {
        noteListener(-1)
        activeKeys.delete(key)
        if (!isReturningFromAbsence()) markServer(key, Date.now())
        unsub()
      }
    },

    subscribeOne<T>(
      collection: string,
      id: string,
      cb: (d: T | null) => void,
      onError?: (e: unknown) => void,
    ): () => void {
      const db = getDb()
      const c = resolve(collection)
      return onSnapshot(
        doc(db, c, id),
        (snap) => cb(snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null),
        (err) => {
          console.error(`[firestore] subscribeOne ${c}/${id} failed`, err)
          onError?.(err)
        },
      )
    },

    async getRange<T>(
      collection: string,
      field: string,
      from: number,
      to: number,
      opts?: ReadOptions,
    ): Promise<T[]> {
      const c = resolve(collection)
      const snap = await getDocs(
        query(fbCollection(getDb(), c), where(field, '>=', from), where(field, '<=', to)),
      )
      noteReadOp({ label: opts?.label ?? `${collection}.range`, collection: c, kind: 'range', docs: snap.size, fromCache: snap.metadata.fromCache })
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getAll<T>(collection: string, opts?: ReadOptions): Promise<T[]> {
      const db = getDb()
      const c = resolve(collection)
      const snap = await getDocs(fbCollection(db, c))
      noteReadOp({ label: opts?.label ?? `${collection}.all`, collection: c, kind: 'all', docs: snap.size, fromCache: snap.metadata.fromCache })
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getBy<T>(
      collection: string,
      field: string,
      value: string | number | boolean,
      opts?: ReadOptions,
    ): Promise<T[]> {
      const c = resolve(collection)
      const snap = await getDocs(query(fbCollection(getDb(), c), where(field, '==', value)))
      noteReadOp({ label: opts?.label ?? `${collection}.by.${field}`, collection: c, kind: 'by', docs: snap.size, fromCache: snap.metadata.fromCache })
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getOne<T>(collection: string, id: string, opts?: ReadOptions): Promise<T | null> {
      const db = getDb()
      const c = resolve(collection)
      const snap = await getDoc(doc(db, c, id))
      noteReadOp({ label: opts?.label ?? `${collection}.one`, collection: c, kind: 'one', docs: snap.exists() ? 1 : 0, fromCache: snap.metadata.fromCache })
      return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
    },

    async query<T>(collection: string, spec: QuerySpec, opts?: ReadOptions): Promise<T[]> {
      const c = resolve(collection)
      const snap = await getDocs(query(fbCollection(getDb(), c), ...constraints(spec)))
      noteReadOp({ label: opts?.label ?? `${collection}.query`, collection: c, kind: 'page', docs: snap.size, fromCache: snap.metadata.fromCache })
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getMany<T>(collection: string, ids: readonly string[], opts?: ReadOptions): Promise<T[]> {
      const c = resolve(collection)
      const out: T[] = []
      const unique = [...new Set(ids)]
      for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30)
        const snap = await getDocs(query(fbCollection(getDb(), c), where(documentId(), 'in', chunk)))
        noteReadOp({ label: opts?.label ?? `${collection}.many`, collection: c, kind: 'by', docs: snap.size, fromCache: snap.metadata.fromCache })
        for (const d of snap.docs) out.push({ ...d.data(), id: d.id } as T)
      }
      return out
    },

    async add(collection: string, data: Record<string, unknown>): Promise<string> {
      const db = getDb()
      const ref = doc(fbCollection(db, resolve(collection)))
      await setDoc(ref, { ...data, id: ref.id })
      return ref.id
    },

    async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
      const db = getDb()
      await setDoc(doc(db, resolve(collection), id), { ...data, id })
    },

    async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
      const db = getDb()
      await updateDoc(doc(db, resolve(collection), id), toFirestorePatch(patch))
    },

    async remove(collection: string, id: string): Promise<void> {
      const db = getDb()
      await deleteDoc(doc(db, resolve(collection), id))
    },

    async transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
      const db = getDb()
      return runTransaction(db, async (t) => {
        const tx: TxContext = {
          async get<T>(collection: string, id: string): Promise<T | null> {
            const c = resolve(collection)
            const snap = await t.get(doc(db, c, id))
            noteReadOp({ label: `${collection}.tx`, collection: c, kind: 'tx', docs: snap.exists() ? 1 : 0 })
            return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
          },
          set(collection, id, data) {
            t.set(doc(db, resolve(collection), id), { ...data, id })
          },
          update(collection, id, patch) {
            // Same translation the non-transactional update does. Without it a DELETE_FIELD
            // marker reached Firestore as an opaque value, so clearing a field inside a
            // transaction — the only place the stock engine ever clears one — did nothing.
            t.update(doc(db, resolve(collection), id), toFirestorePatch(patch))
          },
          delete(collection, id) {
            t.delete(doc(db, resolve(collection), id))
          },
        }
        return fn(tx)
      })
    },
  }
}
