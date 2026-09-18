import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, SectionHeader } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { saveSettings, useScheduleConfig } from '../../services/schedules'
import type { InventorySettings } from '../../types'

type Key = Exclude<keyof InventorySettings, 'id' | 'kind' | 'updatedAt' | 'updatedBy'>

const FIELDS: { key: Key; label: string; hint: string }[] = [
  { key: 'adjustValueBaht', label: 'ปรับสต๊อกที่ถือว่ามาก (บาท)', hint: 'การปรับยอดที่มูลค่าถึงเท่านี้จะแจ้งหัวหน้า' }, // i18n-key
  { key: 'adjustPct', label: 'ปรับสต๊อกที่ถือว่ามาก (% ของยอดคงเหลือ)', hint: 'หรือปรับเกินสัดส่วนนี้ของที่มีอยู่' }, // i18n-key
  { key: 'wasteValueBaht', label: 'ของเสียที่ต้องแจ้ง (บาท)', hint: 'ของเสีย/สูญหายที่มูลค่าถึงเท่านี้' }, // i18n-key
  { key: 'coverDays', label: 'สั่งให้พอใช้กี่วัน', hint: 'คำแนะนำสั่งซื้อคิดเผื่อหลังของมาถึง' }, // i18n-key
  { key: 'usageWindowDays', label: 'คิดอัตราการใช้จากกี่วันย้อนหลัง', hint: 'ใช้คำนวณวันที่คาดว่าของจะหมด' }, // i18n-key
  { key: 'reminderBeforeMin', label: 'เตือนก่อนเริ่มงาน (นาที)', hint: 'เวลาที่ส่งแจ้งเตือนก่อนงานเริ่ม' }, // i18n-key
  { key: 'escalateAfterHours', label: 'แจ้งหัวหน้าเมื่องานเลยกำหนด (ชั่วโมง)', hint: 'งานค้างเกินเท่านี้จะส่งถึงหัวหน้า' }, // i18n-key
]

/**
 * The numbers the calendar's warnings and suggestions work to, one set per brand. Saved
 * now so they are in place; the notifications and reorder suggestions that read them
 * arrive in the next phases.
 */
export function ThresholdsSection() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { settings, loaded } = useScheduleConfig()
  const [values, setValues] = useState<Record<Key, string> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loaded && values === null) {
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])) as Record<Key, string>)
    }
  }, [loaded, settings, values])

  async function save() {
    if (!values || !user) return
    setBusy(true)
    try {
      const patch = Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])])) as Record<Key, number>
      await saveSettings(patch, { id: user.id })
      toast.success(t('บันทึกแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="adjust"
        title={t('เกณฑ์แจ้งเตือนคลัง')}
        description={t('ตัวเลขที่การแจ้งเตือนและคำแนะนำสั่งซื้อใช้ (เริ่มใช้ในเฟสถัดไป)')}
      />
      {!values ? (
        <p className="py-2 text-sm text-ink-faint">{t('กำลังโหลด...')}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={f.key} label={t(f.label)} hint={t(f.hint)}>
                <Input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={busy}>
              {busy ? t('กำลังบันทึก...') : t('บันทึก')}
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
