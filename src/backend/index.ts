import type { Backend } from './types'
import { createLocalBackend } from './local'
import { createFirestoreBackend } from './firestore'
import { firebaseReady } from '../firebase/config'

// Choose the backend once at startup based on whether Firebase is configured.
// Switching modes (adding/removing config) reloads the page, so this stays stable.

export const backend: Backend = firebaseReady()
  ? createFirestoreBackend()
  : createLocalBackend()

export const BACKEND_MODE = backend.mode

export type { Backend, TxContext } from './types'
