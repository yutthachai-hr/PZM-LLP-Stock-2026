import { useState } from 'react'
import { Button, Spinner } from '../../components/ui'
import { StatRow, StatTile } from '../../components/frame'
import { useData } from '../../data/DataContext'
import { orderCache } from '../../data/orderCache'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { evaluateShadow, type ShadowEvaluation } from '../../intel/shadow'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import { loadShadows } from '../../services/intelShadow'
import { useLedgerWindow } from '../../data/DataContext'

const DAYS = 60

/**
 * Phase G9/G10: how the intelligence's predictions have done — the shadow snapshots of the
 * last 60 days against what happened. Read only when asked (one bounded query plus the
 * order cache), never subscribed. This is the evidence that decides whether a prediction
 * may later be trusted for anything more than a suggestion.
 */
export function ShadowSection() {
  const t = useT()
  const { movements } = useData()
  useLedgerWindow(DAYS + 8)
  const [result, setResult] = useState<ShadowEvaluation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const now = Date.now()
      const from = bkkDayStart(now) - DAYS * DAY_MS
      const [snaps, orders] = await Promise.all([loadShadows(from, now), orderCache.fetchRange(from - 30 * DAY_MS, bkkDayEnd(now))])
      setResult(evaluateShadow(snaps, orders, movements, now))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        {t('การคาดการณ์ที่ระบบเก็บไว้ (โหมดเงา) เทียบกับสิ่งที่เกิดขึ้นจริง ย้อนหลัง {days} วัน — ใช้ตัดสินว่าจะเชื่อการคาดการณ์ได้แค่ไหน ระบบไม่ได้ทำอะไรตามการคาดการณ์เหล่านี้', { days: DAYS })}
      </p>
      <Button onClick={() => void run()} disabled={busy}>
        {result ? t('คำนวณใหม่') : t('ดูผลเทียบ')}
      </Button>
      {busy && <Spinner />}
      {error != null && <p className="text-sm text-danger">{errText(error, t)}</p>}
      {result &&
        (['delivery', 'stockout'] as const).map((k) => {
          const m = result[k].metrics
          return (
            <div key={k} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">{k === 'delivery' ? t('ความเสี่ยงส่งช้า (ระดับสูงขึ้นไป)') : t('คาดว่าของหมดใน 7 วัน')}</h3>
              <StatRow columns={4}>
                <StatTile icon="clipboardList" label={t('ตัดสินผลแล้ว / รอผล')} value={`${m.n} / ${result[k].pending}`} />
                <StatTile icon="checkCircle" label={t('แม่น (precision)')} value={pct(m.precision)} tone="green" />
                <StatTile icon="search" label={t('จับได้ (recall)')} value={pct(m.recall)} tone="blue" />
                <StatTile icon="warning" label={t('เตือนผิด')} value={pct(m.falseWarningRate)} tone="amber" />
              </StatRow>
            </div>
          )
        })}
    </div>
  )
}
