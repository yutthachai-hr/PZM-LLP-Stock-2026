import { useCallback, useEffect, useRef, useState } from 'react'
import { TOAST_DURATION, type ToastRecord } from '../lib/toastQueue'
import { useT } from '../i18n/I18nContext'
import { Icon, type IconName } from './Icon'
import { focusRing } from './frame/tones'

const variant: Record<ToastRecord['kind'], { icon: IconName; color: string }> = {
  success: { icon: 'checkCircle', color: 'bg-in-soft text-in' },
  error: { icon: 'alertCircle', color: 'bg-danger-soft text-danger' },
  warning: { icon: 'warning', color: 'bg-warn-soft text-warn' },
  info: { icon: 'info', color: 'bg-brand-soft text-brand' },
}

export function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  const t = useT()
  const root = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const remaining = useRef(TOAST_DURATION[toast.kind])
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closing = useRef(false)
  const [leaving, setLeaving] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setLeaving(true)
    if (root.current?.contains(document.activeElement) && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
    exitTimer.current = setTimeout(() => onDismiss(toast.id), 180)
  }, [onDismiss, toast.id])
  useEffect(() => {
    const changed = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    remaining.current = TOAST_DURATION[toast.kind]
    closing.current = false
    clearTimeout(exitTimer.current)
    setLeaving(false)
  }, [toast.kind, toast.revision])
  useEffect(() => {
    if (hovered || focused || hidden || leaving) return
    const started = Date.now()
    const timer = setTimeout(close, remaining.current)
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)) }
  }, [hovered, focused, hidden, leaving, close, toast.revision])
  useEffect(() => () => clearTimeout(exitTimer.current), [])
  const ui = variant[toast.kind]
  return <article ref={root} data-toast data-toast-kind={toast.kind} data-leaving={leaving} aria-hidden={leaving || undefined}
    className="notice-card toast-card flex items-start gap-3 border border-line p-4"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null
      setFocused(true)
    }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
    <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${ui.color}`}><Icon name={ui.icon} size={19} /></span>
    <div className="min-w-0 flex-1">
      <h3 className="whitespace-pre-line text-sm font-semibold leading-6 text-ink">{toast.title}</h3>
      {toast.description && <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-ink-soft">{toast.description}</p>}
      {toast.action && <button type="button" disabled={leaving} className={`mt-2 min-h-11 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-brand-soft ${focusRing}`}
        onClick={() => { if (closing.current) return; try { toast.action!.onClick() } finally { close() } }}>{toast.action.label}</button>}
    </div>
    <button type="button" disabled={leaving} aria-label={t('ปิดการแจ้งเตือนนี้')}
      className={`-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-sunken hover:text-ink ${focusRing}`}
      onClick={close}><Icon name="x" size={16} /></button>
  </article>
}
