import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { Button, Card, SectionHeader } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateTime } from '../../lib/format'
import { bkkDayEnd } from '../../lib/inventoryRules/time'
import type { SoundCategory } from '../../lib/notificationPresentation'
import { notificationSound } from '../../lib/notificationSound'
import { saveSoundPrefs, useNotificationPrefs } from '../../services/notifications'

/**
 * Sound and mute for the popups (5 Oct 2026), per person and brand, in the same
 * preferences document as the bell's mutes. Muting stops popups and sound for a while;
 * the bell keeps filling, and critical alerts still come through unless switched off here.
 */

const CATEGORIES: { key: SoundCategory; label: string }[] = [
  { key: 'supplierConfirmations', label: 'ผู้ขายยืนยัน' }, // i18n-key
  { key: 'dateChanges', label: 'เปลี่ยนวันส่ง' }, // i18n-key
  { key: 'deliveryRisks', label: 'ความเสี่ยงส่งช้า' }, // i18n-key
  { key: 'stockoutRisks', label: 'เสี่ยงของหมด' }, // i18n-key
  { key: 'informational', label: 'ข้อมูลทั่วไป' }, // i18n-key
]

export function NotificationSoundSettings() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const prefs = useNotificationPrefs(user?.id)
  const [enabled, setEnabled] = useState(true)
  const [volume, setVolume] = useState(60)
  const [off, setOff] = useState<string[]>([])
  const [allowCritical, setAllowCritical] = useState(true)
  const [busy, setBusy] = useState(false)
  const mutedUntil = prefs?.sound?.mutedUntil && prefs.sound.mutedUntil > Date.now() ? prefs.sound.mutedUntil : null

  useEffect(() => {
    const s = prefs?.sound
    setEnabled(s?.enabled ?? true)
    setVolume(Math.round((s?.volume ?? 0.6) * 100))
    setOff(s?.off ?? [])
    setAllowCritical(s?.allowCritical !== false)
  }, [prefs])

  async function save(extra: { mutedUntil?: number | null } = {}) {
    if (!user) return
    setBusy(true)
    try {
      const until = extra.mutedUntil === undefined ? mutedUntil : extra.mutedUntil
      await saveSoundPrefs(user.id, { enabled, volume: volume / 100, off, allowCritical, ...(until ? { mutedUntil: until } : {}) })
      toast.success(t('บันทึกแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    // The click is the gesture browsers want before they allow sound.
    await notificationSound.unlock()
    const r = notificationSound.play('warning', { enabled: true, volume: volume / 100 })
    if (r !== 'played') toast.error(t('เครื่องนี้เล่นเสียงไม่ได้ — การแจ้งเตือนยังแสดงตามปกติ'))
  }

  const now = Date.now()
  return (
    <Card className="p-4">
      <SectionHeader icon="bell" title={t('เสียงและการปิดแจ้งเตือนชั่วคราว')} description={t('เสียงเล่นเฉพาะการแจ้งเตือนใหม่ที่เด้งขึ้นขณะเปิดแอป')} />
      <div className="space-y-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-5 w-5 accent-brand" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('เปิดเสียงแจ้งเตือน')}
        </label>
        <label className="flex flex-wrap items-center gap-3">
          <span className="w-20 text-ink-soft">{t('ระดับเสียง')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volume}
            disabled={!enabled}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-48 accent-brand"
            aria-label={t('ระดับเสียง')}
          />
          <span className="num w-10 text-right">{volume}%</span>
          <Button variant="secondary" size="sm" onClick={() => void test()}>
            {t('ทดสอบเสียง')}
          </Button>
        </label>
        <fieldset disabled={!enabled}>
          <legend className="mb-1 text-ink-soft">{t('เล่นเสียงสำหรับ')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {CATEGORIES.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={!off.includes(c.key)}
                  onChange={() => setOff((cur) => (cur.includes(c.key) ? cur.filter((x) => x !== c.key) : [...cur, c.key]))}
                />
                {t(c.label)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rounded-lg border border-line bg-sunken p-3">
          <p className="mb-2 text-ink-soft">
            {mutedUntil ? t('ปิดการแจ้งเตือนชั่วคราวถึง {time}', { time: formatThaiDateTime(mutedUntil) }) : t('ปิดการแจ้งเตือนชั่วคราว (ไม่เด้ง ไม่มีเสียง กระดิ่งยังเก็บไว้)')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save({ mutedUntil: now + 30 * 60_000 })}>
              {t('30 นาที')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save({ mutedUntil: now + 60 * 60_000 })}>
              {t('1 ชั่วโมง')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save({ mutedUntil: bkkDayEnd(now) })}>
              {t('ถึงสิ้นวันนี้')}
            </Button>
            {mutedUntil && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ mutedUntil: null })}>
                {t('เปิดกลับตอนนี้')}
              </Button>
            )}
          </div>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={allowCritical} onChange={(e) => setAllowCritical(e.target.checked)} />
            {t('ยังแจ้งระดับวิกฤตระหว่างปิดชั่วคราว')}
          </label>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy}>
            {t('บันทึก')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
