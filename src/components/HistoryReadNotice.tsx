import { useT } from '../i18n/I18nContext'
import type { HistoryStatus } from '../data/historyRequest'
import { Button } from './ui'

/** The query's completion, not the global listener's look-back or the oldest row found. */
export function HistoryReadNotice({ status, count, error, retry, product = false }: {
  status: HistoryStatus; count: number; error?: string; retry: () => void; product?: boolean
}) {
  const t = useT()
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 px-1 text-sm text-ink-soft" data-history-status={status}>
      <span>{status === 'loading' || status === 'idle' ? t('กำลังโหลดประวัติที่ขอ…') :
        status === 'error' ? <span role="alert">{t('โหลดประวัติไม่สำเร็จ — ยังยืนยันความครบถ้วนไม่ได้')}: {error}</span> :
        status === 'partial' ? t('ประวัติยังไม่ครบ — ไม่แสดงยอดสะสม') :
        product ? t('โหลดประวัติสินค้าครบแล้ว ({count} รายการ)', { count }) :
        t('โหลดช่วงวันที่ที่ขอครบแล้ว ({count} รายการ)', { count })}</span>
      {status !== 'loading' && status !== 'idle' && <Button variant="secondary" onClick={retry}>{t('โหลดประวัติใหม่')}</Button>}
    </div>
  )
}
