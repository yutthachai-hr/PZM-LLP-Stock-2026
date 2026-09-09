import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { backend, BACKEND_MODE } from '../backend'
import { AppError } from '../i18n/AppError'
import { COL, type AppUser, type Role } from '../types'
import { getFirebaseConfig } from '../firebase/config'

export async function countUsers(): Promise<number> {
  const all = await backend.getAll<AppUser>(COL.users)
  return all.length
}

export async function listUsers(): Promise<AppUser[]> {
  return backend.getAll<AppUser>(COL.users)
}

export interface NewUserInput {
  name: string
  email: string
  password: string
  role: Role
}

/**
 * Create a user account.
 *  - cloud: creates a Firebase Auth account via a throwaway secondary app so the
 *    current admin session is NOT replaced, then writes the profile doc.
 *  - local: writes a user doc with a local password (demo only).
 * Returns the new user id.
 */
export async function createUser(input: NewUserInput): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()

  if (BACKEND_MODE === 'cloud') {
    const cfg = getFirebaseConfig()
    if (!cfg) throw new Error('Firebase not configured')
    const secondary = initializeApp(cfg, `secondary-${Date.now()}`)
    try {
      const cred = await createUserWithEmailAndPassword(
        getAuth(secondary),
        email,
        input.password,
      )
      const uid = cred.user.uid
      await backend.set(COL.users, uid, {
        name,
        email,
        role: input.role,
        active: true,
        createdAt: Date.now(),
      })
      return uid
    } finally {
      await deleteApp(secondary)
    }
  }

  // local mode
  const existing = await backend.getAll<AppUser>(COL.users)
  if (existing.some((u) => u.email.toLowerCase() === email)) {
    throw new AppError('อีเมลนี้ถูกใช้แล้ว')
  }
  return backend.add(COL.users, {
    name,
    email,
    role: input.role,
    active: true,
    localPassword: input.password,
    createdAt: Date.now(),
  })
}

export async function updateUserProfile(
  id: string,
  patch: Partial<Pick<AppUser, 'name' | 'role' | 'active'>>,
): Promise<void> {
  await backend.update(COL.users, id, patch as Record<string, unknown>)
}

/**
 * Remove a user's access for good.
 *
 * Deleting the profile is not enough on its own. In cloud mode the Firebase Auth login
 * survives (removing it needs the Admin SDK, which the free plan has no room for), and that
 * account could simply sign up again — landing back as a pending staff member, or worse if
 * a rule ever loosened. So the tombstone goes first and the profile second, and the rules
 * refuse to delete a profile that has no tombstone. The tombstone is also what makes the
 * revocation land on any device the person is still signed in on.
 *
 * Re-hiring someone is deliberately an explicit admin action: `restoreUser` below.
 */
export async function deleteUser(id: string, by: string): Promise<void> {
  await backend.set(COL.revokedUsers, id, { revokedAt: Date.now(), revokedBy: by })
  await backend.remove(COL.users, id)
}

/** Lift a revocation so the person can sign up (or be added) again. */
export async function restoreUser(id: string): Promise<void> {
  await backend.remove(COL.revokedUsers, id)
}

export interface RevokedUser {
  id: string
  revokedAt?: number
  revokedBy?: string
}

/** Accounts an admin has removed. Admin-only: the rules refuse this listing to anyone else. */
export async function listRevoked(): Promise<RevokedUser[]> {
  return backend.getAll<RevokedUser>(COL.revokedUsers)
}
