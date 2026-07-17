import {
  collection as fbCollection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore'
import { getDb } from '../firebase/app'
import type { Backend, TxContext } from './types'
import { resolveCollection } from '../brand/brand'

// Firestore implementation. Real-time across all devices, offline persistence enabled.
// Collection names are brand-scoped via resolveCollection() so brands stay fully isolated.

export function createFirestoreBackend(): Backend {
  return {
    mode: 'cloud',

    subscribe<T>(collection: string, cb: (docs: T[]) => void): () => void {
      const db = getDb()
      const c = resolveCollection(collection)
      const unsub = onSnapshot(
        fbCollection(db, c),
        (snap) => {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
          cb(docs)
        },
        (err) => {
          console.error(`[firestore] subscribe ${c} failed`, err)
        },
      )
      return unsub
    },

    async getAll<T>(collection: string): Promise<T[]> {
      const db = getDb()
      const snap = await getDocs(fbCollection(db, resolveCollection(collection)))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
    },

    async getOne<T>(collection: string, id: string): Promise<T | null> {
      const db = getDb()
      const snap = await getDoc(doc(db, resolveCollection(collection), id))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null
    },

    async add(collection: string, data: Record<string, unknown>): Promise<string> {
      const db = getDb()
      const ref = doc(fbCollection(db, resolveCollection(collection)))
      await setDoc(ref, { ...data, id: ref.id })
      return ref.id
    },

    async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
      const db = getDb()
      await setDoc(doc(db, resolveCollection(collection), id), { ...data, id })
    },

    async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
      const db = getDb()
      await updateDoc(doc(db, resolveCollection(collection), id), patch)
    },

    async remove(collection: string, id: string): Promise<void> {
      const db = getDb()
      await deleteDoc(doc(db, resolveCollection(collection), id))
    },

    async transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
      const db = getDb()
      return runTransaction(db, async (t) => {
        const tx: TxContext = {
          async get<T>(collection: string, id: string): Promise<T | null> {
            const snap = await t.get(doc(db, resolveCollection(collection), id))
            return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null
          },
          set(collection, id, data) {
            t.set(doc(db, resolveCollection(collection), id), { ...data, id })
          },
          update(collection, id, patch) {
            t.update(doc(db, resolveCollection(collection), id), patch)
          },
          delete(collection, id) {
            t.delete(doc(db, resolveCollection(collection), id))
          },
        }
        return fn(tx)
      })
    },
  }
}
