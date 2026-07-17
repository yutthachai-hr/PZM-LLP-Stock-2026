import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirebaseConfig } from './config'

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
  return _db
}

export function getAuthInstance(): Auth {
  if (_auth) return _auth
  _auth = getAuth(app())
  return _auth
}
