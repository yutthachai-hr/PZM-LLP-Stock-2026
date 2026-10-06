import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { NOTIFICATION_TITLE, tidyCopy } from '../../lib/inventoryRules/copy'
import { isFor, isUnread } from '../../lib/inventoryRules/notifications'
import { markAllRead, useNotificationPrefs } from '../../services/notifications'
import type { Role } from '../../types'
import { Icon } from '../Icon'
import { useToast } from '../Toast'

/**
 * Critical notifications stay on screen until acknowledged (owner, 6 Oct 2026; plan C5).
 * The popup still goes after four seconds, as he asked earlier; what it said stays here,
 * as a red bar under the top bar, until the person presses "รับทราบ" — which marks those
 * notifications read for them, and only them.
 */
export function CriticalBar() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { notifications } = useData()
  const prefs = useNotificationPrefs(user?.id)
  const [busy, setBusy] = useState(false)

  const critical = useMemo(() => {
    if (!user) return []
    const me = { id: user.id, role: user.role as Role }
    return notifications
      .filter((n) => n.priority === 'critical' && isFor(n, me, prefs) && isUnread(n, user.id))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [notifications, user, prefs])

  if (!user || !critical.length) return null
  const first = critical[0]

  async function acknowledge() {
    if (!user) return
    setBusy(true)
    try {
      await markAllRead(critical, user.id)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-danger px-4 py-2 text-sm text-white md:px-5">
      <Icon name="alertCircle" size={17} />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{t('วิกฤต {n} รายการ', { n: critical.length })}</span>
        {' — '}
        {tidyCopy(t(NOTIFICATION_TITLE[first.kind] ?? first.kind, first.params))}
      </span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('pzm:open-notifications', { detail: { tab: 'critical' } }))}
        className="min-h-9 rounded-md px-2 font-semibold underline underline-offset-2 hover:bg-white/10"
      >
        {t('ดูทั้งหมด')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void acknowledge()}
        className="min-h-9 rounded-md bg-white px-3 font-semibold text-danger hover:bg-white/90 disabled:opacity-60"
      >
        {t('รับทราบ')}
      </button>
    </div>
  )
}
