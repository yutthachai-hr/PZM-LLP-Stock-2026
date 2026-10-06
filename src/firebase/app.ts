import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  clearIndexedDbPersistence,
  terminate,
  type Firestore,
} from 'firebase/firestore'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { getFirebaseConfig, isEmulatorMode } from './config'

/** Ports in firebase.json — the automated tests' databases (see isEmulatorMode). */
const EMULATOR_HOST = '127.0.0.1'
const FIRESTORE_EMULATOR_PORT = 8080
const AUTH_EMULATOR_PORT = 9099

// Lazy singletons — only initialised when cloud mode is active.

let _app: FirebaseApp | null = null
let _db: Firestore | null = null
let _auth: Auth | null = null

function app(): FirebaseApp {
  if (_app) return _app
  const cfg = getFirebaseConfig()
  if (!cfg) throw new Error('Firebase is not configured')
  _app = getApps()[0] ?? initializeApp(cfg)
  return _app
}

export function getDb(): Firestore {
  if (_db) return _db
  // Offline persistence + multi-tab so mobile keeps working on flaky networks.
  // ignoreUndefinedProperties: Firestore rejects `undefined` field values (unlike the local
  // backend). Optional empty fields (cost, note, ...) are simply skipped instead of erroring.
  _db = initializeFirestore(app(), {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  })
  if (isEmulatorMode()) connectFirestoreEmulator(_db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT)
  return _db
}

export function getAuthInstance(): Auth {
  if (_auth) return _auth
  _auth = getAuth(app())
  if (isEmulatorMode()) connectAuthEmulator(_auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true })
  return _auth
}

/**
 * Throw away the offline copy of the database on this device.
 *
 * Firestore keeps everything it has loaded in IndexedDB so the app works on a bad
 * connection. On a tablet several people share, that copy outlives the session it was
 * loaded in and is readable by whoever has the device next, signed in or not.
 *
 * The database has to be shut down before its storage can be cleared, which leaves the app
 * with a Firestore instance nothing can use — so the caller reloads. Failing is not fatal:
 * another tab holding the same database will refuse the clear, and being signed out is
 * still the more important half.
 */
export async function clearLocalCaches(): Promise<void> {
  const db = _db
  if (!db) return
  try {
    await terminate(db)
    await clearIndexedDbPersistence(db)
  } catch (e) {
    console.error('[firebase] could not clear the offline copy on this device', e)
  } finally {
    _db = null
    window.location.reload()
  }
}
