import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCalendarFeed } from '../../data/useCalendarFeed'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateShort } from '../../lib/format'
import { bkkDayEnd, bkkDayStart, DAY_MS, isSameBkkDay } from '../../lib/inventoryRules/time'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { ItemRow } from '../../pages/calendar/ItemRow'
import { Icon } from '../Icon'
import { Button, Card, CardTitle, StatGroup, StatTile } from '../ui'

/**
 * Today and the week ahead, on the dashboard.
 *
 * Reads the same three ranges the calendar does, through the same caches — a fortnight
 * either side of today, which the calendar's month window covers, so opening one after
 * the other costs nothing extra. Every tile opens the calendar with that filter on.
 */
const BEFORE_DAYS = 7
const AFTER_DAYS = 14

const isOpen = (i: CalendarItem) => i.status === 'pending' || i.status === 'inProgress' || i.status === 'waitingApproval' || i.status === 'overdue'

export function TodayPanel() {
  const t = useT()
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5 * 60_000)
    return () => clearInterval(id)
  }, [])
  const range = useMemo(
    () => ({ from: bkkDayStart(now) - BEFORE_DAYS * DAY_MS, to: bkkDayEnd(now) + AFTER_DAYS * DAY_MS }),
    [now],
  )
  const feed = useCalendarFeed(range, now)

  const today = useMemo(() => feed.items.filter((i) => isSameBkkDay(i.at, now)), [feed.items, now])
  const counts = useMemo(
    () => ({
      tasks: today.filter((i) => i.kind === 'task' && isOpen(i)).length,
      receiving: today.filter((i) => i.kind === 'poExpected' && isOpen(i)).length,
      low: today.filter((i) => i.kind === 'lowStock').length,
      critical: feed.items.filter((i) => i.priority === 'critical' || i.status === 'overdue').length,
      requests: feed.items.filter((i) => i.kind === 'prPending').length,
    }),
    [today, feed.items],
  )
  const upcoming = useMemo(
    () =>
      feed.items
        .filter((i) => i.at > bkkDayEnd(now) && i.at <= bkkDayEnd(now) + 7 * DAY_MS && (isOpen(i) || i.kind === 'cutoff'))
        .slice(0, 8),
    [feed.items, now],
  )
  const todayList = useMemo(() => today.filter((i) => i.kind !== 'lowStock' && i.kind !== 'outOfStock').slice(0, 8), [today])

  if (feed.loading && feed.items.length === 0) return null
  const go = (filter: string) => () => navigate(`/calendar?filter=${filter}`)

  return (
    <div className="space-y-4">
      <StatGroup
        title={t('วันนี้ · {date}', { date: formatThaiDateShort(now) })}
        columns={4}
        action={
          <Button variant="ghost" onClick={() => navigate('/calendar')}>
            {t('เปิดปฏิทิน')}
          </Button>
        }
      >
        <button type="button" onClick={go('tasks')} className="text-left">
          <StatTile icon="note" tone={counts.tasks > 0 ? 'brand' : 'plain'} value={`${counts.tasks}`} label={t('งานวันนี้')} />
        </button>
        <button type="button" onClick={go('purchasing')} className="text-left">
          <StatTile icon="truck" tone={counts.receiving > 0 ? 'in' : 'plain'} value={`${counts.receiving}`} label={t('รับของวันนี้')} />
        </button>
        <button type="button" onClick={go('stock')} className="text-left">
          <StatTile icon="warning" tone={counts.low > 0 ? 'warn' : 'plain'} value={`${counts.low}`} label={t('ใกล้หมด')} />
        </button>
        <button type="button" onClick={go('attention')} className="text-left">
          <StatTile icon="alertCircle" tone={counts.critical > 0 ? 'out' : 'plain'} value={`${counts.critical}`} label={t('ด่วน/เกินกำหนด')} />
        </button>
      </StatGroup>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <CardTitle title={t('วันนี้')} className="px-4 pt-4" />
          {todayList.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-faint">{t('วันนี้ไม่มีงานในปฏิทิน')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {todayList.map((i) => (
                <li key={i.id}>
                  <ItemRow item={i} onPick={(x) => navigate(`/calendar?item=${encodeURIComponent(x.id)}`)} compact />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden p-0">
          <CardTitle
            title={t('7 วันข้างหน้า')}
            className="px-4 pt-4"
            action={
              counts.requests > 0 ? (
                <button type="button" onClick={go('purchasing')} className="inline-flex items-center gap-1 text-xs text-warn">
                  <Icon name="cart" size={14} />
                  {t('รออนุมัติ {n}', { n: counts.requests })}
                </button>
              ) : undefined
            }
          />
          {upcoming.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-faint">{t('ไม่มีงานที่จะถึง')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center">
                  <span className="num w-14 shrink-0 pl-3 text-xs text-ink-faint">{formatThaiDateShort(i.at).slice(0, 5)}</span>
                  <div className="min-w-0 flex-1">
                    <ItemRow item={i} onPick={(x) => navigate(`/calendar?item=${encodeURIComponent(x.id)}`)} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
