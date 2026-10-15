import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { enqueueToast, normalizeToast, visibleToasts, type ToastInput, type ToastKind, type ToastRecord } from '../lib/toastQueue'
import { useT } from '../i18n/I18nContext'
import { NoticeViewport } from './notifications/NoticeViewport'
import { ToastCard } from './ToastCard'

type Notify = (message: ToastInput, description?: string) => void
interface ToastApi { success: Notify; error: Notify; warning: Notify; info: Notify }
const Ctx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const counter = useRef(0)
  const push = useCallback((kind: ToastKind, input: ToastInput, description?: string) => {
    const content = normalizeToast(input, description)
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
  return <Ctx.Provider value={api}>
    <NoticeViewport renderToasts={(reserved) => <div role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions" aria-label={t('การแจ้งเตือนชั่วคราว')} className="flex flex-col gap-2">
      {visibleToasts(toasts, reserved).map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />)}
    </div>}>{children}</NoticeViewport>
  </Ctx.Provider>
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
