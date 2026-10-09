import { useData } from '../data/DataContext'
import { LIVE_ERROR_TEXT } from '../data/liveError'
import { useT } from '../i18n/I18nContext'
import { Icon } from './Icon'
import { Button } from './ui'

/**
 * A live listener the database ended (plan C1): said at the top of every page, with a
 * retry, until it is live again. Without it a refused or quota-starved listener left the
 * screen showing its last rows — or none — as if they were current.
 */
export function LiveErrorBanner() {
  const t = useT()
  const { liveError, retryLive } = useData()
  if (!liveError) return null
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
      <Icon name="alertCircle" size={18} />
      <span className="min-w-0 flex-1 font-medium">{t(LIVE_ERROR_TEXT[liveError.kind])}</span>
      <Button variant="secondary" size="sm" onClick={retryLive}>
        <Icon name="refresh" size={15} />
        {t('ลองใหม่')}
      </Button>
    </div>
  )
}
