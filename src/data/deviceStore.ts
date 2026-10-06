/**
 * The app's own copies of shared data on this device (perf/firestore-read-budget,
 * 6 Oct 2026): products, balances, suppliers and the session range caches, so that opening
 * the app again reads what changed rather than everything. One IndexedDB store, keyed by
 * brand-resolved name; erased on sign-out with Firestore's own offline copy.
 *
 * Fails soft everywhere: no IndexedDB (a private window, blocked storage) simply means the
 * caller reads from the network as it did before.
 */

const DB_NAME = 'pzm-synced'
const STORE = 'snapshots'

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

export async function readCopy<T>(key: string): Promise<T | null> {
  return ((await run<T>('readonly', (s) => s.get(key) as IDBRequest<T>)) ?? null) as T | null
}

export async function writeCopy<T>(key: string, value: T): Promise<void> {
  await run('readwrite', (s) => s.put(value, key))
}

/** Erase every stored copy — on sign-out, with Firestore's own offline copy. */
export async function clearCopies(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}

/** A full re-read at least this often catches deletions and writes from a clock far behind. */
export const FULL_EVERY_MS = 24 * 60 * 60_000
/**
 * Margin for device clocks that disagree, applied to every "changed since". Phones and PCs
 * keep network time to within seconds; a clock further out than this is caught by the next
 * whole read (FULL_EVERY_MS). Kept small because everything stamped inside the margin is
 * read again on each return — a 30-minute margin re-read a whole burst of job writes.
 */
export const SKEW_MS = 5 * 60_000
