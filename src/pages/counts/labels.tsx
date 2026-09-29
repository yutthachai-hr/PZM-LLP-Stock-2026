import { Badge } from '../../components/ui'
import { useI18n, useT } from '../../i18n/I18nContext'
import { countDayOf } from '../../lib/monthlyCount'
import type { MonthlyCountStatus } from '../../types'

/** The month a sheet is for, as a name and a year in the reader's language. */
export function MonthLabel({ month }: { month: string }) {
  const { lang } = useI18n()
  return <>{new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' }).format(countDayOf(month))}</>
}

/** A sheet's status, in words and colour. */
const STATUS: Record<MonthlyCountStatus, { label: string; color: 'amber' | 'blue' | 'green' }> = {
  counting: { label: 'กำลังนับ', color: 'amber' }, // i18n-key
  recorded: { label: 'บันทึกไว้ดู (ไม่ปรับ)', color: 'blue' }, // i18n-key
  posting: { label: 'กำลังปรับสต๊อก', color: 'amber' }, // i18n-key
  posted: { label: 'ปรับสต๊อกแล้ว', color: 'green' }, // i18n-key
}

export function StatusBadge({ status }: { status: MonthlyCountStatus }) {
  const t = useT()
  return <Badge color={STATUS[status].color}>{t(STATUS[status].label)}</Badge>
}
