import { useT } from '../i18n/I18nContext'
import { useOnline } from '../lib/useOnline'
import { Icon } from './Icon'

/** Said at the top of every page while the device is offline (plan C4). */
export function OfflineBanner() {
  const t = useT()
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" aria-live="polite" className="mb-4 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-ink">
      <Icon name="alertCircle" size={18} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{t('ออฟไลน์')}</span> — {t('ดูข้อมูลที่โหลดไว้ได้ แต่การบันทึกต้องรอให้กลับมาออนไลน์ สิ่งที่คีย์ค้างไว้จะเก็บในเครื่องนี้')}
      </span>
    </div>
  )
}
