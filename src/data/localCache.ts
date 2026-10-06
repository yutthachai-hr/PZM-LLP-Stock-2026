/**
 * A small key → value store in IndexedDB, for the listeners' device cache (release
 * hardening: Firestore reads). Every call is best-effort: a private window, blocked or full
 * storage, or a browser without IndexedDB simply has no cache — the caller then reads from
 * Firestore exactly as it did before, so nothing can break because the cache is missing.
 */

const DB = 'pzm-cache'
const STORE = 'kv'
let opening: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
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

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const d = await db()
  if (!d) return undefined
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const d = await db()
  if (!d) return
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Remove every key starting with `prefix` (a project's or a brand's caches). */
export async function cacheClear(prefix = ''): Promise<void> {
  const d = await db()
  if (!d) return
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return
        if (String(c.key).startsWith(prefix)) c.delete()
        c.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
