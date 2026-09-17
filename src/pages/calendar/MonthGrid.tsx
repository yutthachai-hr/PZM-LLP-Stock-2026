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
    // The look the owner picked (a content-calendar template): white cells, hairline
    // rules, small grey weekday captions, a bold day number at the top-left, and each
    // entry a soft pastel pill — the colour carries the meaning, the whitespace does the rest.
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {DAY_NAMES.map((d) => (
            <div key={d} className="px-3 py-2.5">
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
                className={`group min-h-32 cursor-pointer border-b border-r border-line p-2 outline-none transition-colors duration-150 last:border-r-0 hover:bg-sunken/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
                  outside ? 'bg-sunken/40' : 'bg-surface'
                }`}
              >
                <span className="mb-1.5 flex items-center justify-between">
                  <span
                    className={`num inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold ${
                      day === todayKey ? 'bg-brand text-white' : outside ? 'text-ink-faint' : 'text-ink'
                    }`}
                  >
                    {new Date(day).getDate()}
                  </span>
                  {list.length > 0 && <span className="num text-[10px] text-ink-faint">{list.length}</span>}
                </span>
                <div className="space-y-1">
                  {list.slice(0, CHIPS_PER_DAY).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onPick(item)
                      }}
                      title={itemTitle(item, t)}
                      className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium leading-4 transition hover:brightness-95 ${chipClass(item)}`}
                    >
                      <Icon name={itemIcon(item)} size={11} className="shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1 truncate">{itemTitle(item, t)}</span>
                    </button>
                  ))}
                  {list.length > CHIPS_PER_DAY && (
                    <span className="inline-block rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                      +{list.length - CHIPS_PER_DAY}
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
