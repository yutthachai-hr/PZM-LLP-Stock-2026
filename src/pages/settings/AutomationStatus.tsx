import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { Button, Card, SectionHeader } from '../../components/ui'
import { BACKEND_MODE } from '../../backend'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateTime } from '../../lib/format'
import { generateStockCountTasks, markRanToday, readCronStatus, WORKER_STALE_MS, type CronStatus } from '../../services/automation'

/**
 * Whether the automatic jobs are running, and a button to run the stock-count one now.
 *
 * Live, the nightly job reports into meta/cronStatus. Until that job exists — and in
 * demo mode, which never has one — the calendar does the same work when a manager opens
 * it; "run now" is that, on demand. Running twice is harmless: task ids are fixed per day.
 */
export function AutomationStatus() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [status, setStatus] = useState<CronStatus | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void readCronStatus().then((s) => live && setStatus(s))
    return () => {
      live = false
    }
  }, [])

  async function runNow() {
    if (!user) return
    setBusy(true)
    try {
      const r = await generateStockCountTasks({ id: user.id, name: user.name })
      markRanToday()
      toast.success(r.written === 0 ? t('งานนับสต๊อกครบแล้ว ไม่มีงานใหม่') : t('สร้างงานนับสต๊อก {n} งาน', { n: r.written }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const late = !status?.lastRunAt || Date.now() - status.lastRunAt > WORKER_STALE_MS

  return (
    <Card className="p-4">
      <SectionHeader
        icon="clock"
        title={t('งานอัตโนมัติ')}
        description={t('สร้างงานนับสต๊อกตามตาราง ล่วงหน้า 14 วัน')}
        actions={
          <Button variant="secondary" onClick={runNow} disabled={busy}>
            <Icon name="refresh" size={16} />
            {busy ? t('กำลังสร้าง...') : t('สร้างงานตอนนี้')}
          </Button>
        }
      />
      <p className="text-sm text-ink-soft">
        {BACKEND_MODE === 'local'
          ? t('โหมดนี้ไม่มีงานเบื้องหลัง — ปฏิทินสร้างงานให้เองวันละครั้งเมื่อเปิด')
          : status === undefined
            ? t('กำลังตรวจ...')
            : status?.lastRunAt
              ? t('งานเบื้องหลังทำงานล่าสุด {when}', { when: formatThaiDateTime(status.lastRunAt) })
              : t('ยังไม่มีงานเบื้องหลัง — หัวหน้า/ผู้ดูแลที่เปิดปฏิทินจะสร้างงานให้วันละครั้ง')}
      </p>
      {BACKEND_MODE !== 'local' && status?.lastRunAt && late && (
        <p className="mt-1 text-sm text-warn">{t('งานเบื้องหลังไม่ได้ทำงานเกิน 26 ชั่วโมง — ปฏิทินจะสร้างงานแทนจนกว่าจะกลับมา')}</p>
      )}
      {status?.error && <p className="mt-1 text-sm text-out">{status.error}</p>}
    </Card>
  )
}
