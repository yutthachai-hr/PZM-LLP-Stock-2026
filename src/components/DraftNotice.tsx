import { useT } from '../i18n/I18nContext'
import { AlertBanner, bannerAction } from './ui'

/** "What you had keyed was kept" — shown above a form the draft was put back into. */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  const t = useT()
  return (
    <AlertBanner tone="info" icon="history" action={
      <button type="button" className={bannerAction} onClick={onDiscard}>
        {t('ล้างแบบร่าง')}
      </button>
    }>
      {t('กู้คืนรายการที่คีย์ค้างไว้ในเครื่องนี้ — ตรวจสอบก่อนบันทึก')}
    </AlertBanner>
  )
}
