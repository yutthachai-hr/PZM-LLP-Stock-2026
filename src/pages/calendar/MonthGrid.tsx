import { useEffect, useMemo, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateShort } from '../../lib/format'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { chipClass, DAY_NAMES, timeOf } from './chips'
import { itemIcon, itemTitle } from './ItemRow'

const CHIPS_PER_DAY = 2

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
  onShift,
}: {
  anchor: number
  range: { from: number; to: number }
  items: CalendarItem[]
  now: number
  onPick: (i: CalendarItem) => void
  onPickDay: (ms: number) => void
  /** The mouse wheel over the grid: -1 the month before, 1 the month after. */
  onShift?: (dir: -1 | 1) => void
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

  // The wheel pages through months while the pointer is over the grid (owner, 18 Sep).
  // A native listener, because React's is passive and could not stop the page scrolling
  // at the same time. Deltas are summed so a trackpad's many small events make one step,
  // and a short pause after each step stops one flick skipping three months.
  const grid = useRef<HTMLDivElement>(null)
  const shift = useRef(onShift)
  shift.current = onShift
  useEffect(() => {
    const el = grid.current
    if (!el) return
    let sum = 0
    let until = 0
    const onWheel = (ev: WheelEvent) => {
      if (!shift.current || ev.ctrlKey || Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return
      ev.preventDefault()
      const now = Date.now()
      if (now < until) return
      sum += ev.deltaY
      if (Math.abs(sum) < 40) return
      shift.current(sum > 0 ? 1 : -1)
      sum = 0
      until = now + 350
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    // Seven columns at any width; below sm it scrolls sideways rather than squeezing a
    // day into 43px — which is why the phone opens on the agenda instead.
    // The look the owner picked (a content-calendar template): white cells, hairline
    // rules, small grey weekday captions, a bold day number at the top-left, and each
    // entry a soft pastel pill — the colour carries the meaning, the whitespace does the rest.
    <div ref={grid} className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line bg-sunken text-center text-[13px] font-semibold text-ink-soft">
          {DAY_NAMES.map((d, i) => (
            <div key={d} className={`px-3 py-2.5 ${i === 0 ? 'text-brand' : ''}`}>
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
                className={`group min-h-36 cursor-pointer border-b border-r border-line p-2 outline-none transition-colors duration-150 last:border-r-0 hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
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
                      className={`block w-full rounded-lg px-2 py-1.5 text-left transition hover:brightness-95 ${chipClass(item)}`}
                    >
                      {/* A card, as the owner's mock-up 05 draws it: what, and when. */}
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold leading-4">
                        <Icon name={itemIcon(item)} size={13} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{itemTitle(item, t)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-4 opacity-80">
                        <Icon name="clock" size={11} className="shrink-0" />
                        {item.allDay ? t('ทั้งวัน') : timeOf(item.at)}
                      </span>
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
