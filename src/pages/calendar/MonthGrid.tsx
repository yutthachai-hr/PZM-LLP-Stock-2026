import { useMemo } from 'react'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateShort } from '../../lib/format'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { chipClass, DAY_NAMES } from './chips'
import { itemIcon, itemTitle } from './ItemRow'

const CHIPS_PER_DAY = 3

/** Items by the Bangkok day they fall on. */
export function groupByDay(items: readonly CalendarItem[]): Map<number, CalendarItem[]> {
  const map = new Map<number, CalendarItem[]>()
  for (const item of items) {
    const k = bkkDayStart(item.at)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

export function MonthGrid({
  anchor,
  range,
  items,
  now,
  onPick,
  onPickDay,
}: {
  anchor: number
  range: { from: number; to: number }
  items: CalendarItem[]
  now: number
  onPick: (i: CalendarItem) => void
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
    // Seven columns at any width; below sm it scrolls sideways rather than squeezing a
    // day into 43px — which is why the phone opens on the agenda instead.
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line bg-sunken text-center text-xs font-medium uppercase text-ink-soft">
          {DAY_NAMES.map((d) => (
            <div key={d} className="px-1 py-2">
              {t(d)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const list = byDay.get(day) ?? []
            const outside = new Date(day).getMonth() !== month
            return (
              // The whole cell is the target: on a tablet a finger lands in the middle of
              // the square. Chips inside stop the click so they open their own drawer.
              <div
                key={day}
                role="button"
                tabIndex={0}
                onClick={() => onPickDay(day)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    onPickDay(day)
                  }
                }}
                aria-label={formatThaiDateShort(day)}
                className={`min-h-24 cursor-pointer border-b border-r border-line p-1 outline-none transition-colors duration-150 last:border-r-0 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
                  outside ? 'bg-sunken/50' : ''
                } ${day === todayKey ? 'bg-brand-soft/40' : ''}`}
              >
                <span
                  className={`num mb-1 block rounded px-1 text-xs ${
                    day === todayKey ? 'font-bold text-brand' : outside ? 'text-ink-faint' : 'text-ink-soft'
                  }`}
                >
                  {new Date(day).getDate()}
                </span>
                <div className="space-y-0.5">
                  {list.slice(0, CHIPS_PER_DAY).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onPick(item)
                      }}
                      title={itemTitle(item, t)}
                      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:brightness-95 ${chipClass(item)}`}
                    >
                      <Icon name={itemIcon(item)} size={11} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{itemTitle(item, t)}</span>
                    </button>
                  ))}
                  {list.length > CHIPS_PER_DAY && (
                    <span className="block px-1 text-[11px] text-ink-faint">
                      {t('อีก {n} รายการ', { n: list.length - CHIPS_PER_DAY })}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
