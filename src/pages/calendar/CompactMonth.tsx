import { useMemo } from 'react'
import { useT } from '../../i18n/I18nContext'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { DAY_NAMES } from './chips'
import { groupByDay } from './MonthGrid'

/**
 * The month on a phone: a number per day and a dot per kind of thing on it. Tapping a day
 * opens that day's list; the phone never tries to draw seven columns of chips.
 */
export function CompactMonth({
  anchor,
  range,
  items,
  now,
  onPickDay,
}: {
  anchor: number
  range: { from: number; to: number }
  items: CalendarItem[]
  now: number
  onPickDay: (ms: number) => void
}) {
  const t = useT()
  const month = new Date(anchor).getMonth()
  const days = useMemo(() => {
    const out: number[] = []
    for (let d = bkkDayStart(range.from); d <= range.to; d += DAY_MS) out.push(d)
    return out
  }, [range.from, range.to])
  const byDay = useMemo(() => groupByDay(items), [items])
  const todayKey = bkkDayStart(now)

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium uppercase text-ink-soft">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-1">
            {t(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = byDay.get(day) ?? []
          const outside = new Date(day).getMonth() !== month
          const red = list.some((i) => i.priority === 'critical' || i.status === 'overdue')
          const amber = list.some((i) => i.priority === 'high' || i.priority === 'medium')
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg ${
                day === todayKey ? 'bg-brand-soft font-bold text-brand' : outside ? 'text-ink-faint' : 'text-ink'
              }`}
            >
              <span className="num text-sm">{new Date(day).getDate()}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {list.length > 0 && (
                  <span className={`h-1.5 w-1.5 rounded-full ${red ? 'bg-out' : amber ? 'bg-warn' : 'bg-brand'}`} />
                )}
                {list.length > 2 && <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
