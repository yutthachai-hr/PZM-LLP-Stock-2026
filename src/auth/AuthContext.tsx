import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { backend, BACKEND_MODE } from '../backend'
import { COL, type AppUser } from '../types'
import { getAuthInstance, clearLocalCaches } from '../firebase/app'
import { clearThumbCache } from '../components/ProductThumb'

import { AppError } from '../i18n/AppError'
import { useIdleLogout } from './useIdleLogout'
import { classifyProfileError, retryDelayMs } from './profileError'

interface AuthState {
  user: AppUser | null
  loading: boolean
  mode: 'cloud' | 'local'
  needsBootstrap: boolean // local mode only: no users exist yet -> "create first admin"
  notice: string | null // e.g. "account pending approval"
  login: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

const SESSION_KEY = 'pmstock:v1:session'

// Notices are stored as translation keys, not translated text: these are set inside
// callbacks that close over the language at subscribe time, and LoginPage runs them
// through t() when it renders.
const PENDING = 'บัญชีนี้ยังไม่ถูกเปิดใช้งาน — กรุณาให้ผู้ดูแลระบบอนุมัติก่อนเข้าใช้' // i18n-key
const REVOKED = 'สิทธิ์การเข้าใช้ของบัญชีนี้ถูกยกเลิกแล้ว' // i18n-key
const IDLE = 'ออกจากระบบอัตโนมัติเพราะไม่มีการใช้งาน {minutes} นาที — เครื่องนี้เป็นเครื่องใช้ร่วมกัน' // i18n-key
const UNPROVISIONED =
  'ระบบนี้ยังไม่ได้ตั้งค่า — เจ้าของต้องสร้างบัญชีผู้ดูแลคนแรกจาก Firebase Console ก่อน' // i18n-key
// Shown only when the very first profile read fails, so the sign-in screen says why it is
// asking rather than appearing for no reason.
const CONNECTION = 'เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาลองใหม่อีกครั้ง' // i18n-key

/**
 * Where a sign-out notice waits out the page reload that follows it.
 *
 * logout() ends in clearLocalCaches(), which terminates Firestore and reloads the page so
 * the offline copy cannot outlive the session on a shared device. That reload also throws
 * away React state — including the notice explaining why the person was just signed out.
 * So every automatic sign-out landed on a blank sign-in screen with no reason given, which
 * reads as the app losing the session at random.
 *
 * sessionStorage, not localStorage: the explanation belongs to this tab and this reload,
 * and should not still be sitting there tomorrow.
 */
const NOTICE_KEY = 'pmstock:v1:notice'

function readNotice(): string | null {
  try {
    return sessionStorage.getItem(NOTICE_KEY)
  } catch {
    return null // private mode; the notice is a courtesy, not a requirement
  }
}

function rememberNotice(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(NOTICE_KEY, key)
    else sessionStorage.removeItem(NOTICE_KEY)
  } catch {
    /* nothing to remember it in */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [noticeState, setNoticeState] = useState<string | null>(readNotice)
  const notice = noticeState
  const setNotice = useCallback((key: string | null) => {
    rememberNotice(key)
    setNoticeState(key)
  }, [])
  // name entered on the sign-up form, used when the profile doc is created
  const pendingName = useRef<string | null>(null)

  // The branches share a tablet, so a session left open belongs to whoever picks the device
  // up next — and every movement they record is filed under the previous person's name.
  useIdleLogout(user !== null, () => {
    setNotice(IDLE)
    void logout()
  })

  // ---- initial load ----
  useEffect(() => {
    let disposed = false

    if (BACKEND_MODE === 'cloud') {
      // IMPORTANT: never read Firestore before authentication — secure rules deny it,
      // which would hang the app. Wait for the auth state, then watch the profile.
      const auth = getAuthInstance()

      // Every auth event supersedes the one before it. Signing out, or signing in as
      // someone else, must not be undone by a slower callback from the previous account
      // arriving late, so each round carries a generation that is re-checked after every
      // await and on every snapshot — not only before the first one.
      let generation = 0
      let profileUnsub: (() => void) | null = null
      let profileRetry: ReturnType<typeof setTimeout> | null = null

      const unsub = onAuthStateChanged(auth, (fbUser) => {
        generation++
        const gen = generation
        profileUnsub?.()
        profileUnsub = null
        if (profileRetry) clearTimeout(profileRetry)
        profileRetry = null

        const stale = () =>
          disposed || gen !== generation || auth.currentUser?.uid !== fbUser?.uid

        if (!fbUser) {
          setUser(null)
          setLoading(false)
          return
        }
        const uid = fbUser.uid

        // Refuse the session and say why. Signing out also drops anything already loaded.
        async function reject(why: string) {
          if (stale()) return
          setNotice(why)
          setUser(null)
          try {
            await fbSignOut(auth)
          } catch {
            /* the notice is the point; the next auth event settles the rest */
          }
          setLoading(false)
        }

        // A signed-in account with no profile is asking for access. Give it the only shape
        // self-signup is allowed to produce — inactive staff — and let an admin approve it.
        // For a revoked account, or a database nobody has provisioned, the rules refuse and
        // the person is told which of the two it is instead of watching a spinner.
        let requested = false
        async function requestAccess() {
          const name =
            pendingName.current || fbUser?.displayName || fbUser?.email || 'ผู้ใช้' // stored profile name, not UI copy — i18n-key
          try {
            await backend.set(COL.users, uid, {
              name,
              email: fbUser?.email || '',
              role: 'staff',
              active: false,
              createdAt: Date.now(),
            })
            if (stale()) return
            pendingName.current = null
            // The subscription reports the new document and decides what happens next.
          } catch {
            if (stale()) return
            const provisioned = await backend.getOne(COL.meta, 'bootstrap').catch(() => null)
            if (stale()) return
            await reject(provisioned ? REVOKED : UNPROVISIONED)
          }
        }

        // Whether a profile has ever arrived on this session. A listener that fails before
        // one does leaves the sign-in screen up, so it has to say why; one that fails after
        // must not disturb someone who is already working.
        let everLoaded = false
        let attempts = 0

        function watchProfile() {
          profileUnsub = backend.subscribeOne<AppUser>(
            COL.users,
            uid,
            (profile) => {
              if (stale()) return
              attempts = 0
              if (!profile) {
                // Either brand new, or the profile was just deleted under a signed-in user.
                if (requested) {
                  void reject(REVOKED)
                  return
                }
                requested = true
                void requestAccess()
                return
              }
              if (profile.active === false) {
                void reject(PENDING)
                return
              }
              // Live, so an admin revoking access takes effect on this screen too, not only
              // at the next sign-in.
              everLoaded = true
              setNotice(null)
              setUser(profile)
              setLoading(false)
            },
            (err) => {
              if (stale()) return
              // A listener that fails is usually a dropped connection or an exhausted daily
              // read quota, not a decision about this person. Only the rules refusing the
              // read means access is actually gone.
              if (classifyProfileError(err) === 'denied') {
                void reject(REVOKED)
                return
              }
              // Firestore's onSnapshot does not retry — the listener is finished — so
              // re-establish it rather than leaving the app deaf to its own profile.
              // The session is left alone: dropping to sign-in here is what was throwing
              // away a half-finished count every time the tablet's wifi hiccuped.
              setLoading(false)
              if (!everLoaded) setNotice(CONNECTION)
              attempts++
              profileUnsub?.()
              profileUnsub = null
              profileRetry = setTimeout(() => {
                if (stale()) return
                watchProfile()
              }, retryDelayMs(attempts))
            },
          )
        }

        watchProfile()
      })
      return () => {
        disposed = true
        if (profileRetry) clearTimeout(profileRetry)
        profileUnsub?.()
        unsub()
      }
    }

    // local mode: read users from localStorage (no rules) and restore session
    async function initLocal() {
      const users = await backend.getAll<AppUser>(COL.users)
      if (disposed) return
      if (users.length === 0) setNeedsBootstrap(true)
      const sid = localStorage.getItem(SESSION_KEY)
      if (sid) {
        const profile = users.find((u) => u.id === sid && u.active !== false)
        setUser(profile ?? null)
      }
      setLoading(false)
    }
    void initLocal()
    return () => {
      disposed = true
    }
  }, [setNotice])

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

  /**
   * Ask for access to the system.
   *
   * In cloud mode this creates the Firebase Auth account only; the profile that follows is
   * always INACTIVE STAFF, whoever asks and however empty the database is. Being first to
   * reach a database is not evidence of owning it, so the first admin is created by the
   * owner from the Firebase console instead, where the rules do not apply.
   *
   * In local mode there is no server to appeal to, so the first account is the admin — that
   * mode is for trying the app out, not for real data.
   */
  async function signUp(name: string, email: string, password: string): Promise<void> {
    const em = email.trim().toLowerCase()

    if (BACKEND_MODE === 'cloud') {
      pendingName.current = name.trim()
      await createUserWithEmailAndPassword(getAuthInstance(), em, password)
      // onAuthStateChanged creates the pending profile and reports the outcome
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

  /**
   * Sign out and leave nothing readable behind.
   *
   * The branches share a tablet, so the next person to pick it up is a different person.
   * Signing out alone does not help much: Firestore keeps an offline copy of everything
   * that was loaded, and the app keeps decoded product photos in memory. Both are cleared
   * here. Clearing the offline copy needs the database shut down first, which is why the
   * page reloads afterwards.
   */
  async function logout(): Promise<void> {
    if (BACKEND_MODE === 'cloud') {
      await fbSignOut(getAuthInstance())
    } else {
      localStorage.removeItem(SESSION_KEY)
    }
    setUser(null)
    clearThumbCache()
    await clearLocalCaches()
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
        signUp,
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
