import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { formatThaiDate } from '../lib/format'

/**
 * Says how far back the loaded ledger reaches, and offers the rest on request.
 *
 * Without this the recent-window optimisation would quietly lie: a report over "all dates"
 * would show only the last few months and look complete. Fetching older movements costs a
 * read per document, so it stays a deliberate click rather than something every visit pays.
 */
export function LedgerWindowNotice({
  from,
  onLoadOlder,
}: {
  from?: number
  onLoadOlder?: () => void
} = {}) {
  const { movementsFrom, ensureMovementsFrom } = useData()
  const t = useT()

  const effectiveFrom = from !== undefined ? from : movementsFrom
  if (effectiveFrom <= 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-ink-soft">
      <span>{t('แสดงประวัติตั้งแต่ {date}', { date: formatThaiDate(effectiveFrom) })}</span>
      <button
        onClick={() => {
          if (onLoadOlder) onLoadOlder()
          else ensureMovementsFrom(0)
        }}
        className="font-medium text-brand hover:underline"
      >
        {t('โหลดประวัติทั้งหมด')}
      </button>
    </div>
  )
}
