import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { enqueueToast, normalizeToast, visibleToasts, type ToastInput, type ToastKind, type ToastRecord } from '../lib/toastQueue'
import { useT } from '../i18n/I18nContext'
import { NoticeViewport } from './notifications/NoticeViewport'
import { ToastCard } from './ToastCard'

type Notify = (message: ToastInput, description?: string) => void
interface ToastApi { success: Notify; error: Notify; warning: Notify; info: Notify }
const Ctx = createContext<ToastApi | null>(null)

export function ToastProvider({ children, initialToasts = [] }: { children: ReactNode; initialToasts?: ToastRecord[] }) {
  const t = useT()
  const [toasts, setToasts] = useState<ToastRecord[]>(() => initialToasts)
  const counter = useRef(initialToasts.length)
  // `t` must not enter push's dependencies: changing the API identity reloads Orders' list and
  // closes its LINE wizard (e2e/toast-ux.demo.ts counts identity changes). Read it through a
  // ref so the fallback title still follows the current language.
  const translate = useRef(t)
  useEffect(() => { translate.current = t }, [t])
  const push = useCallback((kind: ToastKind, input: ToastInput, description?: string) => {
    // The fallback below is a dictionary key resolved through t() via the ref above, not rendered copy.
    const content = normalizeToast(input, description, translate.current('เกิดข้อผิดพลาด')) // i18n-key
    if (!content) return
    const item = { ...content, id: ++counter.current, kind }
    setToasts((current) => enqueueToast(current, item))
  }, [])
  // Callers include Orders' loader dependencies: changing API identity reloads the list and closes its LINE wizard.
  const api = useMemo<ToastApi>(() => ({
    success: (m, d) => push('success', m, d), error: (m, d) => push('error', m, d),
    warning: (m, d) => push('warning', m, d), info: (m, d) => push('info', m, d),
  }), [push])
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), [])
  // ponytail: two persistent live regions (assertive for errors, polite for others); upgrade to separate sub-lane managers if distinct timeouts or focus routing needed.
  // Neither lane carries role="alert": an always-mounted alert landmark would win the app's
  // unscoped getByRole('alert') queries (sign-in banner, operational notices). role="region"
  // plus a name still registers the assertive lane as a live region before the first error.
  return <Ctx.Provider value={api}>
    <NoticeViewport renderToasts={(reserved) => {
      const visible = visibleToasts(toasts, reserved)
      return <>
        <div role="region" aria-label={t('การแจ้งเตือนสำคัญ')} aria-live="assertive" aria-atomic="false" aria-relevant="additions text" className="flex flex-col gap-2">
          {visible.filter((item) => item.kind === 'error').map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions text" aria-label={t('การแจ้งเตือนชั่วคราว')} className="flex flex-col gap-2">
          {visible.filter((item) => item.kind !== 'error').map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </div>
      </>
    }}>{children}</NoticeViewport>
  </Ctx.Provider>
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
