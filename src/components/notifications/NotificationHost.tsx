import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { CATEGORY_LABEL, NOTIFICATION_BODY, NOTIFICATION_TITLE, tidyCopy } from '../../lib/inventoryRules/copy'
import { isFor } from '../../lib/inventoryRules/notifications'
import { presentNotification, type Severity } from '../../lib/notificationPresentation'
import { BURST_WINDOW_MS, dismiss, dueCards, emptyQueue, expire, LEAVE_MS, receive, soundFor, type PopupCard, type QueueState } from '../../lib/notificationQueue'
import { notificationSound } from '../../lib/notificationSound'
import { logNotification } from '../../lib/notificationLog'
import { markRead, useNotificationPrefs } from '../../services/notifications'
import type { AppNotification, Role } from '../../types'
import { Icon, type IconName } from '../Icon'

/**
 * The popups (5 Oct 2026): one host for the whole app, on every page. It watches the same
 * notifications listener the bell reads — no second subscription, no polling — and pops
 * what is new since sign-in, with one sound per batch. The bell stays the record: a popup
 * dismissed is still there, unread, until it is opened.
 *
 * The rules (what pops, history, bursts, how long) are pure, in lib/notificationQueue.ts.
 */

const PROMPT_KEY = 'pmstock:v1:sound-prompt-dismissed'

type Action =
  | { type: 'receive'; list: Parameters<typeof receive>[1]; now: number }
  | { type: 'dismiss'; key: string; now: number }
  | { type: 'tick'; now: number }
  | { type: 'reset' }

function reducer(state: QueueState, a: Action): QueueState {
  switch (a.type) {
    case 'receive':
      return receive(state, a.list, a.now).state
    case 'dismiss':
      return dismiss(state, a.key, a.now)
    case 'tick':
      return expire(state, a.now)
    case 'reset':
      return emptyQueue()
  }
}

const SEVERITY_UI: Record<Severity, { icon: IconName; label: string; bar: string; text: string }> = {
  critical: { icon: 'alertCircle', label: 'วิกฤต', bar: 'border-l-out', text: 'text-out' }, // i18n-key
  warning: { icon: 'warning', label: 'เตือน', bar: 'border-l-warn', text: 'text-warn' }, // i18n-key
  success: { icon: 'checkCircle', label: 'สำเร็จ', bar: 'border-l-in', text: 'text-in' }, // i18n-key
  info: { icon: 'info', label: 'ข้อมูล', bar: 'border-l-line-strong', text: 'text-ink-soft' }, // i18n-key
}

function promptDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1'
  } catch {
    return false
  }
}

export function NotificationHost() {
  const { user } = useAuth()
  // Keyed on the person: signing out or switching user starts from a clean slate, so one
  // person's notifications never pop for the next.
  return user ? <Host key={user.id} uid={user.id} role={user.role as Role} /> : null
}

function Host({ uid, role }: { uid: string; role: Role }) {
  const t = useT()
  const navigate = useNavigate()
  const { notifications } = useData()
  const prefs = useNotificationPrefs(uid)
  const [state, dispatch] = useReducer(reducer, undefined, emptyQueue)
  const [askSound, setAskSound] = useState(false)
  const byId = useRef(new Map<string, AppNotification>())
  const lastPlayed = useRef(new Set<string>())

  const sound = prefs?.sound ?? { enabled: true, volume: 0.6 }
  // receive() needs the state as of now, not as of the render that scheduled the timer.
  const stateRef = useRef(state)
  stateRef.current = state

  // Unlock audio on the first touch or key anywhere: that is the gesture browsers want.
  useEffect(() => {
    const unlock = () => void notificationSound.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  const mine = useMemo(
    () => notifications.filter((n) => isFor(n, { id: uid, role }, prefs)),
    [notifications, uid, role, prefs],
  )

  // Arrivals within a moment of each other are one batch (a recalculation writing fifteen
  // at once is one card and one sound, not fifteen).
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const n of mine) byId.current.set(n.id, n)
      const now = Date.now()
      // Muted for a while: nothing pops or sounds (critical still does unless switched off);
      // what arrives meanwhile is history by the time the mute ends.
      const muted = !!sound.mutedUntil && sound.mutedUntil > now
      const list = mine.map((n) => {
        const presented = presentNotification(n)
        const silence = muted && (presented.severity !== 'critical' || sound.allowCritical === false)
        return { presented: silence ? { ...presented, popup: false, sound: null } : presented, category: n.category }
      })
      const { fresh } = receive(stateRef.current, list, now)
      dispatch({ type: 'receive', list, now })
      if (fresh.length) logNotification('displayed', { cards: fresh.map((c) => c.key), count: fresh.reduce((s, c) => s + c.items.length, 0) })
      const name = soundFor(fresh.filter((c) => !lastPlayed.current.has(c.key)))
      fresh.forEach((c) => lastPlayed.current.add(c.key))
      if (!name) return
      const off = new Set(sound.off ?? [])
      const allowed = fresh.some((c) => c.items.some((i) => i.sound && !off.has(i.soundCategory)))
      const result = notificationSound.play(name, { enabled: sound.enabled && allowed, volume: sound.volume })
      logNotification('sound', { name, result })
      if (result === 'needs-unlock' && !promptDismissed()) setAskSound(true)
    }, BURST_WINDOW_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine])

  // Leaving: a card whose four seconds are up fades and slides out to the right, then goes.
  // Cards that arrived together leave top first (their times are staggered in the queue).
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set())
  const close = useCallback((key: string) => {
    setLeaving((cur) => (cur.has(key) ? cur : new Set(cur).add(key)))
    setTimeout(() => {
      dispatch({ type: 'dismiss', key, now: Date.now() })
      setLeaving((cur) => {
        const next = new Set(cur)
        next.delete(key)
        return next
      })
    }, LEAVE_MS)
  }, [])
  const timed = state.visible.some((c) => c.ttl !== null)
  useEffect(() => {
    if (!timed) return
    const id = setInterval(() => {
      for (const key of dueCards(stateRef.current, Date.now())) close(key)
    }, 100)
    return () => clearInterval(id)
  }, [timed, close])

  const open = useCallback(
    (card: PopupCard, url: string) => {
      close(card.key)
      navigate(url)
      logNotification('opened', { card: card.key, url })
      // Opening it is reading it; a dismissed popup stays unread in the bell.
      for (const item of card.items) {
        const n = byId.current.get(item.id)
        if (n) void markRead(n, uid).catch(() => {})
      }
    },
    [close, navigate, uid],
  )

  async function enableSound() {
    const ok = await notificationSound.unlock()
    if (ok) notificationSound.play('success', { enabled: true, volume: sound.volume })
    setAskSound(false)
    try {
      localStorage.setItem(PROMPT_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const titleOf = (id: string) => {
    const n = byId.current.get(id)
    return n ? tidyCopy(t(NOTIFICATION_TITLE[n.kind] ?? n.kind, n.params)) : ''
  }
  const bodyOf = (id: string) => {
    const n = byId.current.get(id)
    return n ? tidyCopy(t(NOTIFICATION_BODY[n.kind] ?? '', n.params)) : ''
  }

  if (!state.visible.length && !askSound) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-2 top-[calc(env(safe-area-inset-top)+4rem)] z-[90] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[22rem]"
      aria-label={t('การแจ้งเตือนใหม่')}
    >
      {askSound && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md">
          <Icon name="bell" size={16} className="shrink-0 text-ink-soft" />
          <span className="min-w-0 flex-1 text-ink">{t('เปิดเสียงแจ้งเตือน?')}</span>
          <button className="min-h-9 rounded-md bg-brand px-3 text-xs font-medium text-white" onClick={() => void enableSound()}>
            {t('เปิดเสียง')}
          </button>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-faint hover:bg-sunken"
            aria-label={t('ปิด')}
            onClick={() => {
              setAskSound(false)
              try {
                localStorage.setItem(PROMPT_KEY, '1')
              } catch {
                /* ignore */
              }
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {state.visible.map((card) => {
        const ui = SEVERITY_UI[card.severity]
        const burst = card.items.length > 1
        const first = card.items[0]
        return (
          <div
            key={card.key}
            role={card.severity === 'critical' ? 'alert' : 'status'}
            aria-live={card.severity === 'critical' ? 'assertive' : 'polite'}
            className={`pointer-events-auto rounded-lg border border-l-4 border-line bg-surface shadow-md transition-[opacity,transform] duration-300 ease-in motion-reduce:transition-none ${leaving.has(card.key) ? 'translate-x-[110%] opacity-0' : 'motion-safe:animate-[pzm-pop_160ms_ease-out]'} ${ui.bar}`}
          >
            <div className="flex items-start gap-2 px-3 pt-2.5">
              <Icon name={ui.icon} size={18} className={`mt-0.5 shrink-0 ${ui.text}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${ui.text}`}>
                  {t(ui.label)}
                  {card.category && <span className="font-normal text-ink-faint"> · {t(CATEGORY_LABEL[card.category])}</span>}
                </p>
                {burst ? (
                  <>
                    <p className="text-sm font-semibold text-ink">{t('{n} รายการใหม่', { n: card.items.length })}</p>
                    <ul className="mt-0.5 space-y-0.5 text-xs text-ink-soft">
                      {card.items.slice(0, 3).map((i) => (
                        <li key={i.id} className="truncate">
                          {titleOf(i.id)}
                        </li>
                      ))}
                      {card.items.length > 3 && <li>{t('+{n} รายการ', { n: card.items.length - 3 })}</li>}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-ink">{titleOf(first.id)}</p>
                    {bodyOf(first.id) && <p className="text-xs text-ink-soft">{bodyOf(first.id)}</p>}
                  </>
                )}
              </div>
              <button
                className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-sunken hover:text-ink"
                aria-label={t('ปิดการแจ้งเตือนนี้')}
                onClick={() => close(card.key)}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-2 pl-9">
              {burst ? (
                <button
                  className="min-h-9 rounded-md border border-line-strong px-3 text-xs font-medium text-ink hover:bg-sunken"
                  onClick={() => {
                    close(card.key)
                    window.dispatchEvent(new CustomEvent('pzm:open-notifications', { detail: { tab: card.category ?? 'all' } }))
                  }}
                >
                  {t('ดูทั้งหมด')}
                </button>
              ) : (
                first.actions.map((a, i) => (
                  <button
                    key={a.url}
                    className={`min-h-9 rounded-md px-3 text-xs font-medium ${
                      i === 0 ? 'bg-brand text-white hover:brightness-110' : 'border border-line-strong text-ink hover:bg-sunken'
                    }`}
                    onClick={() => open(card, a.url)}
                  >
                    {t(a.label)}
                  </button>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
