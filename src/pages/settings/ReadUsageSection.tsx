import { useEffect, useState } from 'react'
import { Button, Card, SectionHeader } from '../../components/ui'
import { readTally, resetReadTally, subscribeReadTally, type ReadTally } from '../../data/readMeter'
import { BACKEND_MODE } from '../../backend'
import { useT } from '../../i18n/I18nContext'

/**
 * What this visit has cost in reads, by collection.
 *
 * The free plan allows 50,000 document reads a day across everyone using the app, and it
 * has run out three times (14 Sep, 22 Sep, 23 Sep 2026) — each time diagnosed by reading
 * code and estimating. This is the same question answered from the app itself: open the
 * app, come here, and read how much one open costs and which collection it went on.
 *
 * It counts what the listeners deliver, which is an upper bound on what is billed: a
 * listener that resumes from the offline copy hands over documents nobody paid for.
 */
const DAILY_FREE_READS = 50_000

export function ReadUsageSection() {
  const t = useT()
  const [tally, setTally] = useState<ReadTally>(readTally)

  useEffect(() => subscribeReadTally(() => setTally(readTally())), [])

  if (BACKEND_MODE !== 'cloud') {
    return (
      <Card className="p-4">
        <SectionHeader
          icon="cloud"
          title={t('การอ่านข้อมูล (โควตา)')}
          description={t('โหมดในเครื่องไม่ได้อ่านจากฐานข้อมูลบนคลาวด์ จึงไม่มีการนับ')}
        />
      </Card>
    )
  }

  const rows = Object.entries(tally.byCollection).sort((a, b) => b[1] - a[1])
  const minutes = Math.max(1, Math.round((Date.now() - tally.since) / 60_000))
  const share = Math.round((tally.total / DAILY_FREE_READS) * 100)

  return (
    <Card className="p-4">
      <SectionHeader
        icon="cloud"
        title={t('การอ่านข้อมูล (โควตา)')}
        description={t('นับจำนวนรายการที่แอปอ่านตั้งแต่เปิดหน้านี้ครั้งล่าสุด — โควตาฟรีคือ 50,000 รายการต่อวัน รวมทุกคนทุกเครื่อง')}
        actions={
          <Button variant="secondary" size="sm" onClick={resetReadTally}>
            {t('เริ่มนับใหม่')}
          </Button>
        }
      />
      <div className="mb-3 flex items-baseline gap-2">
        <span className="num text-3xl font-bold text-ink">{tally.total.toLocaleString()}</span>
        <span className="text-sm text-ink-soft">
          {t('รายการ · {min} นาทีที่ผ่านมา · {pct}% ของโควตาวันหนึ่ง', { min: minutes, pct: share })}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">{t('ยังไม่มีการอ่านในหน้านี้')}</p>
      ) : (
        <div className="divide-y divide-line">
          {rows.map(([name, n]) => (
            <div key={name} className="flex items-center justify-between py-1.5 text-sm">
              <span className="doc-no truncate text-ink-soft">{name}</span>
              <span className="num font-medium text-ink">{n.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        {t('ตัวเลขนี้คือจำนวนที่แอปได้รับ ซึ่งมากกว่าหรือเท่ากับที่ถูกคิดเงินจริง (ข้อมูลที่อ่านจากสำเนาในเครื่องไม่ถูกคิด) เปิดแอปใหม่ทุกครั้งคือการอ่านรอบใหม่ — ถ้าตัวเลขต่อการเปิดหนึ่งครั้งสูง ให้ดูว่าคอลเลกชันไหนกินมากที่สุด')}
      </p>
    </Card>
  )
}
