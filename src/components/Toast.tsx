import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useT } from '../i18n/I18nContext'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
}

const Ctx = createContext<ToastApi | null>(null)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const t = useT()
  const closeLabel = t('ปิด')

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++counter
    // Errors wait to be closed, so keep the screen from filling with them: the last four.
    setToasts((t) => [...t, { id, kind, message }].slice(-4))
    // An error stays until it is closed (plan C5): it is the one message that says
    // something was not saved, and four seconds is easy to miss with the goods in hand.
    if (kind !== 'error') setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  // One object for the life of the provider. It used to be rebuilt on every render, so any
  // toast appearing or expiring handed every `useToast()` caller a new identity — and the
  // Orders page, whose loader depends on it, reloaded the whole list, flashed its spinner
  // and unmounted the open LINE send wizard mid-render ("Invalid element provided as first
  // argument", owner's screenshot, 5 Oct 2026).
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  const style: Record<ToastKind, string> = {
    success: 'bg-in',
    error: 'bg-danger',
    info: 'bg-ink',
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Above the phone's tab bar and its raised "+" (1.5rem over it), never over them (plan C5); a live region, so a screen
          reader says it — an error at once, anything else when it has a pause. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+2rem)] z-[100] flex flex-col items-end gap-2 md:inset-x-auto md:bottom-4 md:right-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${style[t.kind]}`}
          >
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.kind === 'error' && (
              <button type="button" onClick={() => dismiss(t.id)} aria-label={closeLabel} className="-mr-2 -my-1 shrink-0 rounded px-2 py-1 font-bold hover:bg-white/15">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
