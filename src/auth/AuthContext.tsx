import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { backend, BACKEND_MODE } from '../backend'
import { COL, type AppUser } from '../types'
import { getAuthInstance } from '../firebase/app'

import { AppError } from '../i18n/AppError'

interface AuthState {
  user: AppUser | null
  loading: boolean
  mode: 'cloud' | 'local'
  needsBootstrap: boolean // no users exist yet -> show "create first admin"
  notice: string | null // e.g. "account pending approval"
  login: (email: string, password: string) => Promise<void>
  registerFirstAdmin: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

const SESSION_KEY = 'pmstock:v1:session'

// Claim the "first admin" slot via a one-time bootstrap sentinel doc.
// Returns true if this uid became the first admin (sentinel did not exist yet).
async function claimFirstAdmin(uid: string): Promise<boolean> {
  try {
    const boot = await backend.getOne(COL.meta, 'bootstrap')
    if (boot) return false
    await backend.set(COL.meta, 'bootstrap', { claimedBy: uid, at: Date.now() })
    return true
  } catch {
    return false
  }
}

// Make sure the sentinel exists (called when an admin signs in) so later self-sign-ups
// are never mistaken for the first user.
async function ensureSentinel(uid: string): Promise<void> {
  try {
    const boot = await backend.getOne(COL.meta, 'bootstrap')
    if (!boot) await backend.set(COL.meta, 'bootstrap', { claimedBy: uid, at: Date.now() })
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // name entered on the "create first admin" form, used when the profile doc is created
  const pendingName = useRef<string | null>(null)

  // ---- initial load ----
  useEffect(() => {
    let cancelled = false

    if (BACKEND_MODE === 'cloud') {
      // IMPORTANT: never read Firestore before authentication — secure rules deny it,
      // which would hang the app. Wait for the auth state, then read the profile.
      const auth = getAuthInstance()
      const unsub = onAuthStateChanged(auth, async (fbUser) => {
        if (cancelled) return
        if (!fbUser) {
          setUser(null)
          setLoading(false)
          return
        }
        try {
          let profile = await backend.getOne<AppUser>(COL.users, fbUser.uid)
          if (!profile) {
            // Determine the first-ever user by claiming a one-time bootstrap sentinel.
            // Non-admins can't list the users collection (by design), so we can't count —
            // the sentinel is the reliable signal. First user => admin+active; others =>
            // staff and INACTIVE (must be approved by an admin before they can access data).
            const isFirst = await claimFirstAdmin(fbUser.uid)
            await backend.set(COL.users, fbUser.uid, {
              name: pendingName.current || fbUser.displayName || fbUser.email || 'ผู้ใช้', // stored profile name, not UI copy — i18n-key
              email: fbUser.email || '',
              role: isFirst ? 'admin' : 'staff',
              active: isFirst,
              createdAt: Date.now(),
            })
            pendingName.current = null
            profile = await backend.getOne<AppUser>(COL.users, fbUser.uid)
          } else if (profile.role === 'admin') {
            // Self-heal: make sure the sentinel exists so future sign-ups aren't treated
            // as the first user (covers projects bootstrapped before this safeguard).
            await ensureSentinel(fbUser.uid)
          }
          if (profile && profile.active === false) {
            // Store the key, not translated text: this callback closes over the language
            // at subscribe time, and LoginPage runs the notice through t() when it renders.
            setNotice('บัญชีนี้ยังไม่ถูกเปิดใช้งาน — กรุณาให้ผู้ดูแลระบบอนุมัติก่อนเข้าใช้') // i18n-key
            await fbSignOut(auth)
            setUser(null)
          } else {
            setNotice(null)
            setUser(profile)
          }
        } catch (e) {
          console.error('[auth] load profile failed', e)
          setUser(null)
        }
        setLoading(false)
      })
      return () => {
        cancelled = true
        unsub()
      }
    }

    // local mode: read users from localStorage (no rules) and restore session
    async function initLocal() {
      const users = await backend.getAll<AppUser>(COL.users)
      if (cancelled) return
      if (users.length === 0) setNeedsBootstrap(true)
      const sid = localStorage.getItem(SESSION_KEY)
      if (sid) {
        const profile = users.find((u) => u.id === sid && u.active !== false)
        setUser(profile ?? null)
      }
      setLoading(false)
    }
    initLocal()
    return () => {
      cancelled = true
    }
  }, [])

  async function login(email: string, password: string): Promise<void> {
    const em = email.trim().toLowerCase()
    if (BACKEND_MODE === 'cloud') {
      await signInWithEmailAndPassword(getAuthInstance(), em, password)
      // onAuthStateChanged sets the user
      return
    }
    const users = await backend.getAll<AppUser>(COL.users)
    const found = users.find((u) => u.email.toLowerCase() === em)
    if (!found) throw new AppError('ไม่พบอีเมลนี้ในระบบ')
    if (found.active === false) throw new AppError('บัญชีนี้ถูกปิดใช้งาน')
    if (found.localPassword !== password) throw new AppError('รหัสผ่านไม่ถูกต้อง')
    localStorage.setItem(SESSION_KEY, found.id)
    setUser(found)
    setNeedsBootstrap(false)
  }

  async function registerFirstAdmin(
    name: string,
    email: string,
    password: string,
  ): Promise<void> {
    const em = email.trim().toLowerCase()

    if (BACKEND_MODE === 'cloud') {
      // Don't read Firestore first (denied pre-auth). Just create the auth account;
      // onAuthStateChanged then creates the profile doc (admin if it's the first user).
      pendingName.current = name.trim()
      await createUserWithEmailAndPassword(getAuthInstance(), em, password)
      // onAuthStateChanged loads the profile and clears loading
    } else {
      const users = await backend.getAll<AppUser>(COL.users)
      if (users.length > 0) throw new AppError('มีผู้ใช้ในระบบแล้ว กรุณาเข้าสู่ระบบ')
      const id = await backend.add(COL.users, {
        name: name.trim(),
        email: em,
        role: 'admin',
        active: true,
        localPassword: password,
        createdAt: Date.now(),
      })
      localStorage.setItem(SESSION_KEY, id)
      const profile = await backend.getOne<AppUser>(COL.users, id)
      setUser(profile)
    }
    setNeedsBootstrap(false)
  }

  async function logout(): Promise<void> {
    if (BACKEND_MODE === 'cloud') {
      await fbSignOut(getAuthInstance())
    } else {
      localStorage.removeItem(SESSION_KEY)
    }
    setUser(null)
  }

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        mode: BACKEND_MODE,
        needsBootstrap,
        notice,
        login,
        registerFirstAdmin,
        logout,
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
