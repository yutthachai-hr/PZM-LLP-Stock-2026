import { useMemo } from 'react'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateShort } from '../../lib/format'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { chipClass, DAY_NAMES, timeOf } from './chips'
import { itemIcon, itemTitle } from './ItemRow'
import { groupByDay } from './MonthGrid'

/** Seven columns, every item of the day stacked with its time — the week at a glance. */
export function WeekView({
  range,
  items,
  now,
  onPick,
  onPickDay,
}: {
  range: { from: number; to: number }
  items: CalendarItem[]
  now: number
  onPick: (i: CalendarItem) => void
  onPickDay: (ms: number) => void
}) {
  const t = useT()
  const days = useMemo(() => {
    const out: number[] = []
    for (let d = bkkDayStart(range.from); d <= range.to; d += DAY_MS) out.push(d)
    return out
  }, [range.from, range.to])
  const byDay = useMemo(() => groupByDay(items), [items])
  const todayKey = bkkDayStart(now)

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-7 divide-x divide-line">
        {days.map((day) => {
          const list = byDay.get(day) ?? []
          const today = day === todayKey
          return (
            <div key={day} className="min-h-[24rem]">
              <button
                type="button"
                onClick={() => onPickDay(day)}
                className={`flex w-full items-baseline justify-between border-b border-line px-2 py-2 text-left hover:bg-sunken ${today ? 'bg-brand-soft/40' : 'bg-sunken'}`}
              >
                <span className="text-xs font-medium uppercase text-ink-soft">{t(DAY_NAMES[new Date(day).getDay()])}</span>
                <span className={`num text-sm ${today ? 'font-bold text-brand' : 'text-ink'}`}>{formatThaiDateShort(day).slice(0, 5)}</span>
              </button>
              <div className="space-y-1 p-1">
                {list.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onPick(item)}
                    title={itemTitle(item, t)}
                    className={`block w-full rounded px-1.5 py-1 text-left text-[11px] leading-tight hover:brightness-95 ${chipClass(item)}`}
                  >
                    <span className="flex items-center gap-1">
                      <Icon name={itemIcon(item)} size={11} className="shrink-0" />
                      {!item.allDay && <span className="num shrink-0 font-semibold">{timeOf(item.at)}</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 break-words">{itemTitle(item, t)}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
