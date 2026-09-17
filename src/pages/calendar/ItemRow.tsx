import { Icon } from '../../components/Icon'
import { Badge } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { useT, type TFn } from '../../i18n/I18nContext'
import type { CalendarItem } from '../../lib/inventoryRules/types'
import { assigneesOf } from '../../services/events'
import { KIND_ICON, KIND_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL, TYPE_ICON, TYPE_LABEL, timeOf } from './chips'

/** The item's title as the screen prints it. */
export function itemTitle(item: CalendarItem, t: TFn): string {
  return t(item.titleKey, item.titleParams)
}

/** The second line: what kind, where, who. */
export function itemSubtitle(item: CalendarItem, t: TFn, locationName: (id?: string) => string | undefined): string {
  const parts: string[] = []
  if (item.meta.kind === 'task') {
    const e = item.meta.event
    parts.push(t(TYPE_LABEL[e.type]))
    if (e.locationId) parts.push(locationName(e.locationId) ?? '')
    if (e.assignedToAll) parts.push(t('ทุกคน'))
    else if (e.assignedToName) parts.push(e.assignedToName)
    else if (assigneesOf(e).length === 0) parts.push(t('ยังไม่มอบหมาย'))
  } else {
    parts.push(t(KIND_LABEL[item.kind]))
    if (item.locationId) parts.push(locationName(item.locationId) ?? '')
    if (item.meta.kind === 'poExpected' && item.meta.delivery === 'delayed') {
      parts.push(t('ล่าช้า {n} วัน', { n: item.meta.daysLate }))
    }
    if (item.meta.kind === 'prPending') parts.push(t('{n} ผู้ขาย', { n: item.meta.suppliers }))
    if (item.meta.kind === 'lowStock' || item.meta.kind === 'outOfStock') {
      parts.push(t('ขั้นต่ำ {min}', { min: item.meta.min }))
    }
  }
  return parts.filter(Boolean).join(' · ')
}

export function itemIcon(item: CalendarItem) {
  return item.meta.kind === 'task' ? TYPE_ICON[item.meta.event.type] : KIND_ICON[item.kind]
}

/**
 * One line of the calendar's lists: time (or "all day"), icon, title, what it is, status.
 * The whole row is the button; at 44px it is a thumb target on the tablets.
 */
export function ItemRow({ item, onPick, compact }: { item: CalendarItem; onPick: (i: CalendarItem) => void; compact?: boolean }) {
  const t = useT()
  const { locationById } = useData()
  const locationName = (id?: string) => (id ? locationById(id)?.name : undefined)
  const showPriority = item.priority === 'critical' || item.priority === 'high'
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className={`flex w-full items-start gap-3 px-3 text-left hover:bg-sunken ${compact ? 'py-2' : 'py-2.5'}`}
    >
      <span className="num w-12 shrink-0 pt-0.5 text-xs font-semibold text-ink-soft">
        {item.allDay ? t('ทั้งวัน') : timeOf(item.at)}
      </span>
      <Icon name={itemIcon(item)} size={16} className="mt-0.5 shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium ${item.status === 'cancelled' ? 'text-ink-faint line-through' : 'text-ink'}`}>
          {itemTitle(item, t)}
        </span>
        <span className="block truncate text-xs text-ink-faint">{itemSubtitle(item, t, locationName)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {item.status !== 'info' && <Badge color={STATUS_COLOR[item.status]}>{t(STATUS_LABEL[item.status])}</Badge>}
        {showPriority && <Badge color={PRIORITY_COLOR[item.priority]}>{t(PRIORITY_LABEL[item.priority])}</Badge>}
      </span>
    </button>
  )
}
