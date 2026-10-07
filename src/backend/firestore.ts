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
  increment as fsIncrement,
  orderBy,
  limit as fbLimit,
} from 'firebase/firestore'
import { getDb } from '../firebase/app'
import { DELETE_FIELD, Increment, withInitialVersion, withVersionBump, type Backend, type SubscribeOptions, type TxContext } from './types'
import { resolveCollection, type BrandId } from '../brand/brand'
import { noteListen, noteRead } from '../data/readMeter'

// Firestore implementation. Real-time across all devices, offline persistence enabled.
// Collection names are brand-scoped via resolveCollection() so brands stay fully isolated.

/** Turn our markers (DELETE_FIELD, Increment) into Firestore's own. */
function toFirestorePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === DELETE_FIELD ? deleteField() : v instanceof Increment ? fsIncrement(v.by) : v
  return out
}

export function createFirestoreBackend(brand?: BrandId): Backend {
  // `brand` undefined means "whatever is selected right now", which is what screens
  // want. Multi-step work calls forBrand() first and gets a copy pinned to one brand.
  const resolve = (name: string) => resolveCollection(name, brand)
  return {
    forBrand: (b: BrandId) => createFirestoreBackend(b),

    mode: 'cloud',

    subscribe<T>(collection: string, cb: (docs: T[]) => void, opts?: SubscribeOptions, onError?: (e: unknown) => void): () => void {
      const db = getDb()
      const c = resolve(collection)
      const ref = fbCollection(db, c)
      // A single-field range filter is served by Firestore's automatic index, so this
      // needs no composite index to be deployed alongside it.
      const q = opts?.since ? query(ref, where(opts.since.field, '>=', opts.since.value)) : ref
      // What the listener delivers is what Firestore bills for, so it is counted where it
       // arrives (data/readMeter.ts). The first snapshot brings the whole window; after
       // that only what changed, which is why a resumed listener is cheap and a cold start
       // is not.
      let first = true
      const unsub = onSnapshot(
        q,
        (snap) => {
          const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
          noteRead(c, first ? snap.size : snap.docChanges().length)
          first = false
          cb(docs)
        },
        (err) => {
          console.error(`[firestore] subscribe ${c} failed`, err)
          onError?.(err)
        },
      )
      noteListen(c, 1)
      let open = true
      return () => {
        if (open) noteListen(c, -1)
        open = false
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
      noteListen(`${c}/one`, 1)
      let open = true
      const unsub = onSnapshot(
        doc(db, c, id),
        (snap) => {
          noteRead(c, 1)
          cb(snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null)
        },
        (err) => {
          console.error(`[firestore] subscribeOne ${c}/${id} failed`, err)
          onError?.(err)
        },
      )
      return () => {
        if (open) noteListen(`${c}/one`, -1)
        open = false
        unsub()
      }
    },

    async getRange<T>(
      collection: string,
      field: string,
      from: number,
      to: number,
    ): Promise<T[]> {
      const c = resolve(collection)
      const snap = await getDocs(
        query(fbCollection(getDb(), c), where(field, '>=', from), where(field, '<=', to)),
      )
      noteRead(c, Math.max(1, snap.size))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getAll<T>(collection: string): Promise<T[]> {
      const db = getDb()
      const c = resolve(collection)
      const snap = await getDocs(fbCollection(db, c))
      noteRead(c, Math.max(1, snap.size))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getBy<T>(
      collection: string,
      field: string,
      value: string | number | boolean,
    ): Promise<T[]> {
      const c = resolve(collection)
      const snap = await getDocs(query(fbCollection(getDb(), c), where(field, '==', value)))
      // A query that finds nothing is still billed one read (plan D3': count what is paid).
      noteRead(c, Math.max(1, snap.size))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async page<T>(collection: string, field: string, opts: { limit: number; before?: number }): Promise<T[]> {
      const c = resolve(collection)
      const parts = [...(opts.before !== undefined ? [where(field, '<', opts.before)] : []), orderBy(field, 'desc'), fbLimit(opts.limit)]
      const snap = await getDocs(query(fbCollection(getDb(), c), ...parts))
      noteRead(c, Math.max(1, snap.size))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)
    },

    async getOne<T>(collection: string, id: string): Promise<T | null> {
      const db = getDb()
      const c = resolve(collection)
      const snap = await getDoc(doc(db, c, id))
      // One read, found or not (plan D3': the meter used to miss every single-document read).
      noteRead(c, 1)
      return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
    },

    async add(collection: string, data: Record<string, unknown>): Promise<string> {
      const db = getDb()
      const ref = doc(fbCollection(db, resolve(collection)))
      await setDoc(ref, { ...data, id: ref.id })
      return ref.id
    },

    async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
      const db = getDb()
      await setDoc(doc(db, resolve(collection), id), { ...withInitialVersion(collection, data), id })
    },

    async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
      const db = getDb()
      await updateDoc(doc(db, resolve(collection), id), toFirestorePatch(withVersionBump(collection, patch)))
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
            // A transaction's read is billed like any other — and again on each retry.
            noteRead(c, 1)
            return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
          },
          set(collection, id, data) {
            t.set(doc(db, resolve(collection), id), { ...withInitialVersion(collection, data), id })
          },
          update(collection, id, patch) {
            // Same translation the non-transactional update does. Without it a DELETE_FIELD
            // marker reached Firestore as an opaque value, so clearing a field inside a
            // transaction — the only place the stock engine ever clears one — did nothing.
            t.update(doc(db, resolve(collection), id), toFirestorePatch(withVersionBump(collection, patch)))
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
