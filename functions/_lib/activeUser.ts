import { PROJECT_ID } from '../_poImage'
import { restServerStore, type ServerStore } from './serverStore'

/**
 * Whether a verified uid may still use the app's server endpoints (plan B6): an active
 * `users` record and no `revokedUsers` entry — what the rules' active() asks. A valid token
 * alone is not enough: an account switched off or revoked keeps a working token for up to
 * an hour.
 *
 * Needs the service account (FIREBASE_SERVICE_ACCOUNT). Without it nothing can be checked
 * and the answer is `true`, which is how these endpoints behaved before — said here so it
 * is a decision, not an accident.
 */
export async function stillActive(
  env: { FIREBASE_SERVICE_ACCOUNT?: string; FIREBASE_PROJECT_ID?: string },
  uid: string,
  store?: ServerStore,
): Promise<boolean> {
  const s = store ?? (env.FIREBASE_SERVICE_ACCOUNT ? restServerStore((env.FIREBASE_PROJECT_ID ?? '').trim() || PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT) : null)
  if (!s) return true
  if (await s.get('revokedUsers', uid)) return false
  const user = (await s.get<{ active?: boolean }>('users', uid))?.doc
  return user?.active === true
}
