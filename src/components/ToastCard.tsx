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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const startedAt = useRef<number | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closing = useRef(false)
  const hovered = useRef(false)
  const focused = useRef(false)
  const [leaving, setLeaving] = useState(false)

  const isPaused = useCallback(() => {
    return closing.current || hovered.current || focused.current || (typeof document !== 'undefined' && document.hidden)
  }, [])

  const pause = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (startedAt.current !== null) {
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
      startedAt.current = null
    }
  }, [])

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    pause()
    setLeaving(true)
    if (root.current?.contains(document.activeElement) && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
    exitTimer.current = setTimeout(() => onDismiss(toast.id), 180)
  }, [onDismiss, pause, toast.id])

  const autoDismiss = useCallback(() => {
    timer.current = undefined
    if (isPaused()) {
      pause()
      return
    }
    close()
  }, [close, isPaused, pause])

  const resume = useCallback(() => {
    if (isPaused() || timer.current !== undefined) return
    if (remaining.current <= 0) {
      close()
      return
    }
    startedAt.current = Date.now()
    timer.current = setTimeout(autoDismiss, remaining.current)
  }, [autoDismiss, close, isPaused])

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) pause()
      else resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (typeof document !== 'undefined' && document.hidden) pause()
    else resume()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      pause()
    }
  }, [pause, resume])

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    startedAt.current = null
    remaining.current = TOAST_DURATION[toast.kind]
    closing.current = false
    clearTimeout(exitTimer.current)
    setLeaving(false)
    resume()
  }, [resume, toast.kind, toast.revision])

  useEffect(() => () => clearTimeout(exitTimer.current), [])

  const ui = variant[toast.kind]
  // ponytail: keying text by revision forces DOM re-insertion for a11y re-announcement; upgrade to dedicated speech lane if queued utterances needed.
  return <article ref={root} data-toast data-toast-kind={toast.kind} data-toast-revision={toast.revision} data-leaving={leaving} aria-hidden={leaving || undefined}
    className="notice-card toast-card flex items-start gap-3 border border-line p-4"
    onMouseEnter={() => { hovered.current = true; pause() }}
    onMouseLeave={() => { hovered.current = false; resume() }}
    onFocusCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null
      focused.current = true
      pause()
    }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        focused.current = false
        resume()
      }
    }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
    <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${ui.color}`}><Icon name={ui.icon} size={19} /></span>
    <div className="min-w-0 flex-1">
      <h3 key={toast.revision ?? 0} className="whitespace-pre-line text-sm font-semibold leading-6 text-ink">{toast.title}</h3>
      {toast.description && <p key={toast.revision ?? 0} className="mt-1 whitespace-pre-line text-[13px] leading-5 text-ink-soft">{toast.description}</p>}
      {toast.action && <button type="button" disabled={leaving} className={`mt-2 min-h-11 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-brand-soft ${focusRing}`}
        onClick={() => { if (closing.current) return; try { toast.action!.onClick() } finally { close() } }}>{toast.action.label}</button>}
    </div>
    <button type="button" disabled={leaving} aria-label={t('ปิดการแจ้งเตือนนี้')}
      className={`-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-sunken hover:text-ink ${focusRing}`}
      onClick={close}><Icon name="x" size={16} /></button>
  </article>
}
