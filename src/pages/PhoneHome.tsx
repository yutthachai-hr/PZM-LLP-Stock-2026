import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Icon, type IconName } from '../components/Icon'
import { TodayTransactions } from '../components/movements/TodayTransactions'
import { Card } from '../components/ui'
import { useCalendarFeed } from '../data/useCalendarFeed'
import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { formatThaiDateShort } from '../lib/format'
import { shortages } from '../lib/inventoryRules/lowStock'
import { bkkDayEnd, bkkDayStart, DAY_MS, isSameBkkDay } from '../lib/inventoryRules/time'
import type { CalendarItem } from '../lib/inventoryRules/types'
import { isManager } from '../lib/purchaseRequestStatus'
import { ItemRow } from './calendar/ItemRow'

/**
 * The phone's first screen (spec §2, 21 Sep 2026; simplified 22 Sep after the owner
 * found the first cut "แน่นมาก"): two or three big numbers that matter today, what I
 * keyed today, and today's calendar items only when there are any. Nothing that is
 * zero takes up room. The desk's dashboard is another screen entirely.
 *
 * Reads nothing new: the calendar feed, the movement window and the catalogue are
 * already in memory for the desktop dashboard.
 */
const isOpen = (i: CalendarItem) => i.status === 'pending' || i.status === 'inProgress' || i.status === 'waitingApproval' || i.status === 'overdue'

export function PhoneHome() {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { products, locations, qtyAt, minFor, tracksProduct } = useData()
  const [now] = useState(() => Date.now())
  const range = useMemo(() => ({ from: bkkDayStart(now) - 7 * DAY_MS, to: bkkDayEnd(now) + 14 * DAY_MS }), [now])
  const feed = useCalendarFeed(range, now)

  const low = useMemo(() => shortages({ products, locations, qtyAt, minFor, tracksProduct }).length, [products, locations, qtyAt, minFor, tracksProduct])
  const today = useMemo(() => feed.items.filter((i) => isSameBkkDay(i.at, now)), [feed.items, now])
  const receiving = today.filter((i) => i.kind === 'poExpected' && isOpen(i)).length
  const overdue = feed.items.filter((i) => i.status === 'overdue').length
  const pendingRequests = feed.items.filter((i) => i.kind === 'prPending').length
  const tasks = today.filter((i) => i.kind === 'task' && isOpen(i)).length
  const todayList = today.filter((i) => i.kind !== 'lowStock' && i.kind !== 'outOfStock' && isOpen(i)).slice(0, 4)
  const manager = isManager(user?.role)

  return (
    <div className="space-y-5">
      <div>
        <p className="text-lg font-bold text-ink">{t('สวัสดี {name}', { name: user?.name ?? '' })}</p>
        <p className="text-sm text-ink-soft">{formatThaiDateShort(now)}</p>
      </div>

      {/* The numbers that decide the morning. A zero is not news, so it is not shown —
          except low stock and receiving, which are the two questions asked every day. */}
      <div className="grid grid-cols-2 gap-3">
        <BigTile icon="truck" tone={receiving > 0 ? 'in' : 'plain'} value={receiving} label={t('รับของวันนี้')} onClick={() => navigate('/orders')} />
        <BigTile icon="warning" tone={low > 0 ? 'warn' : 'plain'} value={low} label={t('ใกล้หมด')} onClick={() => navigate('/products')} />
        {overdue > 0 && <BigTile icon="alertCircle" tone="out" value={overdue} label={t('เลยกำหนด')} onClick={() => navigate('/calendar?filter=attention')} />}
        {tasks > 0 && <BigTile icon="note" tone="brand" value={tasks} label={t('งานวันนี้')} onClick={() => navigate('/calendar?filter=tasks')} />}
        {manager && pendingRequests > 0 && (
          <BigTile icon="cart" tone="warn" value={pendingRequests} label={t('ใบขอสั่งซื้อรออนุมัติ')} onClick={() => navigate('/requests?filter=pendingApproval')} />
        )}
      </div>

      {todayList.length > 0 && (
        <Card className="overflow-hidden p-0">
          <button type="button" onClick={() => navigate('/calendar')} className="flex min-h-12 w-full items-center justify-between px-4 text-left">
            <span className="text-base font-semibold text-ink">{t('วันนี้')}</span>
            <Icon name="chevronRight" size={18} className="text-ink-faint" />
          </button>
          <ul className="divide-y divide-line border-t border-line">
            {todayList.map((i) => (
              <li key={i.id}>
                <ItemRow item={i} onPick={(x) => navigate(`/calendar?item=${encodeURIComponent(x.id)}`)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <TodayTransactions
        types={['receive', 'issue', 'consume', 'adjust']}
        date={now}
        title={t('รายการที่ฉันทำวันนี้')}
        byUserId={user?.id}
        startOpen
      />
    </div>
  )
}

function BigTile({ icon, value, label, tone, onClick }: { icon: IconName; value: number; label: string; tone: 'plain' | 'brand' | 'in' | 'out' | 'warn'; onClick: () => void }): ReactNode {
  const tones = {
    plain: 'bg-sunken text-ink-soft',
    brand: 'bg-brand-soft text-brand',
    in: 'bg-in-soft text-in',
    out: 'bg-out-soft text-out',
    warn: 'bg-warn-soft text-warn',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-28 cursor-pointer flex-col justify-between rounded-2xl border border-line bg-surface p-4 text-left outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${tones[tone]}`}>
        <Icon name={icon} size={22} />
      </span>
      <span>
        <span className={`num block text-3xl font-bold leading-none ${tone === 'plain' ? 'text-ink' : tones[tone].split(' ')[1]}`}>{value}</span>
        <span className="mt-1 block text-sm text-ink-soft">{label}</span>
      </span>
    </button>
  )
}
