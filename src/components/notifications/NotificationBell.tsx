import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateTime } from '../../lib/format'
import { CATEGORY_LABEL, NOTIFICATION_BODY, NOTIFICATION_TITLE } from '../../lib/inventoryRules/copy'
import { isFor, isUnread } from '../../lib/inventoryRules/notifications'
import { markAllRead, markRead, useNotificationPrefs } from '../../services/notifications'
import type { AppNotification, NotificationCategory, Role } from '../../types'
import { Icon } from '../Icon'
import { useToast } from '../Toast'
import { Button, Modal, SegTab } from '../ui'

type Tab = 'all' | 'critical' | NotificationCategory

const TABS: Tab[] = ['all', 'critical', 'task', 'inventory', 'purchasing', 'supplier']
const TAB_LABEL: Record<Tab, string> = {
  all: 'ทั้งหมด', // i18n-key
  critical: 'วิกฤต', // i18n-key
  task: 'งาน', // i18n-key
  inventory: 'สต๊อก', // i18n-key
  purchasing: 'จัดซื้อ', // i18n-key
  supplier: 'ผู้ขาย', // i18n-key
  system: 'สรุป', // i18n-key
}

/** A slot with nothing in it (a task with no location) leaves " · " behind; take it out. */
function tidy(text: string): string {
  return text
    .replace(/(\s·\s*)+(?=\s—|\s·|$)/g, '')
    .replace(/^\s*·\s*/, '')
    .trim()
}

const TONE: Record<AppNotification['priority'], string> = {
  critical: 'bg-out',
  high: 'bg-warn',
  medium: 'bg-brand',
  info: 'bg-ink-faint',
}

/**
 * The bell: what is addressed to me, from the week the app holds (one listener), newest
 * first, unread counted. Opening one marks it read — my own key, nothing else — and goes
 * where it points.
 */
export function NotificationBell() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notifications } = useData()
  const prefs = useNotificationPrefs(user?.id)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('all')

  const mine = useMemo(() => {
    if (!user) return []
    const me = { id: user.id, role: user.role as Role }
    return notifications.filter((n) => isFor(n, me, prefs)).sort((a, b) => b.createdAt - a.createdAt)
  }, [notifications, user, prefs])
  const unread = user ? mine.filter((n) => isUnread(n, user.id)) : []
  const shown = mine.filter((n) => (tab === 'all' ? true : tab === 'critical' ? n.priority === 'critical' : n.category === tab))

  async function openOne(n: AppNotification) {
    if (!user) return
    setOpen(false)
    navigate(n.link)
    try {
      await markRead(n, user.id)
    } catch {
      // Reading it is what matters; the mark will be retried next time it is opened.
    }
  }

  async function readAll() {
    if (!user) return
    try {
      await markAllRead(unread, user.id)
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  if (!user) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
        aria-label={t('การแจ้งเตือน ({n} ยังไม่อ่าน)', { n: unread.length })}
      >
        <Icon name="bell" size={19} />
        {unread.length > 0 && (
          <span
            className={`num absolute right-1 top-1 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4 text-white ${
              unread.some((n) => n.priority === 'critical') ? 'bg-danger' : 'bg-brand'
            }`}
          >
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>
      <Modal open={open} sheet onClose={() => setOpen(false)} title={t('การแจ้งเตือน')}>
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto rounded-lg bg-sunken p-1 [&>*]:shrink-0 [&>*]:whitespace-nowrap">
          {TABS.map((k) => (
            <SegTab key={k} grow={false} label={t(TAB_LABEL[k])} active={tab === k} onClick={() => setTab(k)} />
          ))}
        </div>
        <div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
          <span>{t('ยังไม่อ่าน {n}', { n: unread.length })}</span>
          {unread.length > 0 && (
            <Button variant="secondary" onClick={readAll}>
              <Icon name="check" size={14} />
              {t('อ่านทั้งหมดแล้ว')}
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">{t('ไม่มีการแจ้งเตือน')}</p>
        ) : (
          <ul className="-mx-5 divide-y divide-line">
            {shown.map((n) => {
              const fresh = isUnread(n, user.id)
              return (
                <li key={n.id}>
                  <button
                    onClick={() => void openOne(n)}
                    className={`flex w-full cursor-pointer items-start gap-3 px-5 py-3 text-left hover:bg-sunken ${fresh ? '' : 'opacity-70'}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${fresh ? TONE[n.priority] : 'bg-line-strong'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${fresh ? 'font-semibold text-ink' : 'text-ink'}`}>
                        {tidy(t(NOTIFICATION_TITLE[n.kind] ?? n.kind, n.params))}
                      </span>
                      <span className="block text-xs text-ink-soft">{tidy(t(NOTIFICATION_BODY[n.kind] ?? '', n.params))}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        {t(CATEGORY_LABEL[n.category])} · {formatThaiDateTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-4 border-t border-line pt-3">
          <button
            onClick={() => {
              setOpen(false)
              navigate('/settings#notifications')
            }}
            className="cursor-pointer text-xs text-ink-soft underline-offset-2 hover:underline"
          >
            {t('ตั้งค่าการแจ้งเตือน')}
          </button>
        </div>
      </Modal>
    </>
  )
}
