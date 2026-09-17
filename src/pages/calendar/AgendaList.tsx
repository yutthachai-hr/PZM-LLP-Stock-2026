import type { ReactNode } from 'react'
import { Badge } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { bkkDayStart, isSameBkkDay } from '../../lib/inventoryRules/time'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { formatThaiDateShort } from '../../lib/format'
import { ItemRow } from './ItemRow'

/** Items grouped by day, in order — the list view, and the phone's default. */
export function AgendaList({
  items,
  now,
  onPick,
  empty,
  compact,
}: {
  items: CalendarItem[]
  now: number
  onPick: (i: CalendarItem) => void
  empty: ReactNode
  compact?: boolean
}) {
  const t = useT()
  if (items.length === 0) return <>{empty}</>

  const groups: { day: number; rows: CalendarItem[] }[] = []
  for (const item of items) {
    const day = bkkDayStart(item.at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(item)
    else groups.push({ day, rows: [item] })
  }

  return (
    <div className="divide-y divide-line">
      {groups.map(({ day, rows }) => (
        <div key={day}>
          <div className="flex items-center gap-2 bg-sunken px-3 py-1.5 text-xs font-medium text-ink-soft">
            {formatThaiDateShort(day)}
            {isSameBkkDay(day, now) && <Badge color="blue">{t('วันนี้')}</Badge>}
          </div>
          <ul className="divide-y divide-line">
            {rows.map((item) => (
              <li key={item.id}>
                <ItemRow item={item} onPick={onPick} compact={compact} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
