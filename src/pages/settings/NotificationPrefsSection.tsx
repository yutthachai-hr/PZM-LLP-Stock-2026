import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { Button, Card, SectionHeader } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { CATEGORY_LABEL, NOTIFICATION_PRIORITY_LABEL } from '../../lib/inventoryRules/copy'
import { savePrefs, useNotificationPrefs } from '../../services/notifications'
import type { NotificationCategory, NotificationPriority } from '../../types'

const CATEGORIES: NotificationCategory[] = ['task', 'inventory', 'purchasing', 'supplier', 'system']
const MUTABLE: NotificationPriority[] = ['high', 'medium', 'info']

/**
 * What each person wants in their bell, per category and priority. Critical always shows —
 * the owner's rule for what nobody may silence. Stored per brand as prefs__<uid>.
 */
export function NotificationPrefsSection() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const prefs = useNotificationPrefs(user?.id)
  const [mute, setMute] = useState<Partial<Record<NotificationCategory, NotificationPriority[]>>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMute(prefs?.mute ?? {})
  }, [prefs])

  const muted = (c: NotificationCategory, p: NotificationPriority) => !!mute[c]?.includes(p)
  function toggle(c: NotificationCategory, p: NotificationPriority) {
    setMute((cur) => {
      const list = cur[c] ?? []
      return { ...cur, [c]: list.includes(p) ? list.filter((x) => x !== p) : [...list, p] }
    })
  }

  async function save() {
    if (!user) return
    setBusy(true)
    try {
      await savePrefs(user.id, mute)
      toast.success(t('บันทึกแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="notifications" className="scroll-mt-20">
      <Card className="p-4">
        <SectionHeader icon="bell" title={t('การแจ้งเตือนของฉัน')} description={t('เลือกสิ่งที่อยากเห็นในกระดิ่ง — ระดับวิกฤตแสดงเสมอ')} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint">
                <th className="py-2 pr-3 font-medium">{t('หมวด')}</th>
                <th className="px-2 py-2 text-center font-medium">{t(NOTIFICATION_PRIORITY_LABEL.critical)}</th>
                {MUTABLE.map((p) => (
                  <th key={p} className="px-2 py-2 text-center font-medium">
                    {t(NOTIFICATION_PRIORITY_LABEL[p])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {CATEGORIES.map((c) => (
                <tr key={c}>
                  <td className="py-2 pr-3 text-ink">{t(CATEGORY_LABEL[c])}</td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked disabled aria-label={t('วิกฤต — แสดงเสมอ')} className="h-4 w-4 accent-brand" />
                  </td>
                  {MUTABLE.map((p) => (
                    <td key={p} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!muted(c, p)}
                        onChange={() => toggle(c, p)}
                        aria-label={`${t(CATEGORY_LABEL[c])} · ${t(NOTIFICATION_PRIORITY_LABEL[p])}`}
                        className="h-5 w-5 cursor-pointer accent-brand"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy ? t('กำลังบันทึก...') : t('บันทึก')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
