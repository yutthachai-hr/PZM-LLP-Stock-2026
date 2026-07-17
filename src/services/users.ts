import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { backend, BACKEND_MODE } from '../backend'
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
    throw new Error('อีเมลนี้ถูกใช้แล้ว')
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
 * Delete a user's profile. This removes their access immediately (no profile => the security
 * rules treat them as inactive). Note: in cloud mode the underlying Firebase Auth login still
 * exists (deleting it requires the Admin SDK / a Cloud Function) but without a profile they
 * cannot read or write anything.
 */
export async function deleteUser(id: string): Promise<void> {
  await backend.remove(COL.users, id)
}
