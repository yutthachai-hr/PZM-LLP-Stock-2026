import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { fmtQty, formatThaiDateShort } from '../../lib/format'
import { describeQty } from '../../lib/uom'
import { ADJUST_REASONS, type MovementType, type StockMovement } from '../../types'
import { Icon } from '../Icon'
import { SiteChip } from '../SiteChip'
import { Badge, Button, Card } from '../ui'
import { EditMovementModal } from './EditMovementModal'
import { TYPE_COLOR, TYPE_LABEL } from './labels'

/**
 * What has been keyed on this screen for the day being keyed — beside the form, so the
 * person filing a delivery note can see the lines already in, and put one right without
 * leaving for the history page. The owner's ask (20 Sep 2026): the same rows the Stock
 * Card shows, but only today's, and editable in place; the balances follow the edit.
 *
 * Reads nothing: the ledger window is already in memory.
 */
export function TodayTransactions({
  types,
  date,
  title,
}: {
  types: readonly MovementType[]
  /** The business day the form is keying, ms. Rows are the ones filed under that day. */
  date: number
  title?: string
}) {
  const t = useT()
  const navigate = useNavigate()
  const { movements } = useData()
  const { user } = useAuth()
  const [editing, setEditing] = useState<StockMovement | null>(null)
  const [showAll, setShowAll] = useState(false)

  const day = new Date(date)
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const to = from + 86_400_000

  const rows = useMemo(
    () =>
      movements
        .filter((m) => types.includes(m.type) && m.date >= from && m.date < to)
        .sort((a, b) => b.createdAt - a.createdAt),
    [movements, types, from, to],
  )
  const shown = showAll ? rows : rows.slice(0, 30)

  return (
    <Card className="flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{title ?? t('รายการที่ทำวันนี้')}</div>
          <div className="text-xs text-ink-faint">
            {formatThaiDateShort(from)} · {t('{n} รายการ', { n: rows.length })}
          </div>
        </div>
        <Button variant="ghost" onClick={() => navigate('/movements')}>
          <Icon name="history" size={14} />
          {t('ประวัติทั้งหมด')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-soft">{t('ยังไม่มีรายการของวันนี้')}</p>
      ) : (
        <ul className="divide-y divide-line overflow-auto">
          {shown.map((m) => (
            <li key={m.id} className={`flex items-start gap-2 px-3 py-2 text-sm ${m.voided ? 'bg-sunken text-ink-faint' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={`truncate font-medium ${m.voided ? 'line-through' : 'text-ink'}`}>{m.productName}</span>
                  <span className="num shrink-0 font-semibold text-ink">
                    {describeQty(m, fmtQty)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                  <Badge color={TYPE_COLOR[m.type]}>{t(TYPE_LABEL[m.type])}</Badge>
                  <SiteChip locationId={m.fromLocationId} />
                  {m.fromLocationId && m.toLocationId && <Icon name="arrowRight" size={12} />}
                  <SiteChip locationId={m.toLocationId} />
                  <span className="doc-no">{m.docNo}</span>
                  {m.reason && <span>· {t(ADJUST_REASONS.find((r) => r.value === m.reason)?.label ?? m.reason)}</span>}
                  {m.note && <span className="truncate">· {m.note}</span>}
                  <span>· {m.byUserName}</span>
                  {m.updatedByName && <span className="text-warn">· {t('แก้ไข:')} {m.updatedByName}</span>}
                  {m.voided && <span>· {t('(ยกเลิก)')}</span>}
                </div>
              </div>
              {!m.voided && user && (
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
                >
                  {t('แก้ไข')}
                </button>
              )}
            </li>
          ))}
          {rows.length > shown.length && (
            <li className="p-2 text-center">
              <Button variant="ghost" onClick={() => setShowAll(true)}>
                {t('แสดงทั้งหมด ({n})', { n: rows.length })}
              </Button>
            </li>
          )}
        </ul>
      )}
      {editing && <EditMovementModal movement={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

/** A form with the day's rows beside it on a wide screen, below it on a narrow one. */
export function WithTodayPanel({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      <div className="min-w-0 space-y-4">{children}</div>
      {panel}
    </div>
  )
}
