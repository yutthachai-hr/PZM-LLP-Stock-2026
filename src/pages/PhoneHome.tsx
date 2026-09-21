import { useAuth } from '../auth/AuthContext'
import { TodayPanel } from '../components/dashboard/TodayPanel'
import { TodayTransactions } from '../components/movements/TodayTransactions'
import { useT } from '../i18n/I18nContext'
import { RequestWidget } from './requests/RequestWidget'

/**
 * The phone's first screen (spec §2, 21 Sep 2026): what is due, what I did, what is
 * waiting. Nothing here is read for its own sake — the calendar feed, the movement
 * window and the request cache are already in memory for the desktop dashboard.
 */
export function PhoneHome() {
  const t = useT()
  const { user } = useAuth()
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">{t('สวัสดี {name}', { name: user?.name ?? '' })}</p>
      <TodayPanel />
      <TodayTransactions
        types={['receive', 'issue', 'consume', 'adjust']}
        date={Date.now()}
        title={t('รายการที่ฉันทำวันนี้')}
        byUserId={user?.id}
        startOpen
      />
      <RequestWidget />
    </div>
  )
}
