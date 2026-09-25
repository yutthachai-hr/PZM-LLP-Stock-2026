/**
 * Product photos kept on this device (owner, 26 Sep 2026).
 *
 * A photo lives in Firestore as one document, and every time a screen showed it that was
 * one read — per photo, per device, every time the app was opened. With a few hundred
 * photos and a dozen people scrolling the stock list, that is thousands of reads a day out
 * of the free tier's 50,000, which has run out twice already. Kept here, a device reads a
 * photo once and again only when it changes.
 *
 * "Changes" is judged by a version the caller passes — the product's `updatedAt`, which
 * setting or removing a photo bumps. A stored copy with another version is not used.
 *
 * Everything here fails soft: no IndexedDB (a private window, blocked storage), a quota
 * error, a corrupt entry — the caller simply goes to the network as before.
 */

const DB_NAME = 'pzm-product-images'
const STORE = 'photos'

interface Entry {
  v: number
  dataUrl: string
}

let opening: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined)
        try {
          const req = work(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

/** The stored photo for `key` if it is the `version` asked for; otherwise undefined. */
export async function readStoredImage(key: string, version: number): Promise<string | undefined> {
  const e = (await run('readonly', (s) => s.get(key))) as Entry | undefined
  return e && e.v === version && typeof e.dataUrl === 'string' ? e.dataUrl : undefined
}

export async function storeImage(key: string, version: number, dataUrl: string): Promise<void> {
  await run('readwrite', (s) => s.put({ v: version, dataUrl } satisfies Entry, key))
}

export async function forgetStoredImage(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key))
}
