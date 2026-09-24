import { SectionCard, StatusChip } from '../../components/frame'
import { Button, Input } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { fmtQty } from '../../lib/format'
import { shownUnit } from '../../lib/ledger'
import { useT } from '../../i18n/I18nContext'
import type { PurchaseOrder, PurchaseOrderLine } from '../../types'
import { needsReason, outstanding, owedLines, receiveAll, variance, type PoLineEntry, type Variance } from './receipt'

export function VarianceChip({ v, diff }: { v: Variance; diff: number }) {
  const t = useT()
  if (v === 'match') return <StatusChip tone="green" size="sm">{t('ครบ')}</StatusChip>
  if (v === 'short') return <StatusChip tone="amber" size="sm">{t('ขาด {n}', { n: fmtQty(diff) })}</StatusChip>
  if (v === 'over') return <StatusChip tone="blue" size="sm" icon="alertCircle">{t('เกิน {n}', { n: fmtQty(diff) })}</StatusChip>
  return <StatusChip tone="slate" size="sm" icon={null}>{t('รอใส่จำนวน')}</StatusChip>
}

/**
 * A line ordered in another unit (a Carton of 24 EA) shows what the quantity means in the
 * product's own unit, at the rate the order was placed at — the same conversion the
 * receipt will file (services/purchaseOrders.ts).
 */
function inBase(l: PurchaseOrderLine, qty: number): string | null {
  if (!l.entryUnit || l.baseQty === undefined || !(l.orderedQty > 0)) return null
  return `= ${fmtQty((l.baseQty / l.orderedQty) * qty)} ${l.unit}`
}

/**
 * The order's lines against this delivery: what was ordered, what is still owed, what came.
 *
 * Nothing is prefilled — "รับครบตาม PO ทั้งหมด" is one press and says the person looked —
 * and a line that differs asks for its reason right under it. On a phone each line is a
 * card; from lg up the same rows line up as a table.
 */
export function PoLines({
  order,
  entries,
  onChange,
  invalid,
}: {
  order: PurchaseOrder
  entries: Record<string, PoLineEntry>
  onChange: (entries: Record<string, PoLineEntry>) => void
  /** After a refused review: outline the lines still missing something. */
  invalid: boolean
}) {
  const t = useT()
  const owed = owedLines(order)
  const allMatch = owed.every((l) => variance(outstanding(l), entries[l.productId]?.qty ?? null) === 'match')

  function set(productId: string, patch: Partial<PoLineEntry>) {
    const cur = entries[productId] ?? { qty: null, reason: '' }
    onChange({ ...entries, [productId]: { ...cur, ...patch } })
  }

  return (
    <SectionCard
      icon="package"
      title={t('รายการตามใบสั่งซื้อ')}
      count={t('({n} รายการ)', { n: owed.length })}
      actions={
        <Button variant={allMatch ? 'secondary' : 'success'} onClick={() => onChange(receiveAll(order, entries))}>
          <Icon name="checkCircle" size={17} />
          {t('รับครบตาม PO ทั้งหมด')}
        </Button>
      }
    >
      <div className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_5.5rem_7rem] gap-3 border-b border-line pb-2 text-xs font-semibold text-ink-soft lg:grid">
        <span>{t('สินค้า')}</span>
        <span className="text-right">{t('สั่ง / ค้างรับ')}</span>
        <span className="text-right">{t('รับครั้งนี้')}</span>
        <span>{t('หน่วย')}</span>
        <span>{t('ส่วนต่าง')}</span>
      </div>
      <ul className="divide-y divide-line">
        {owed.map((l) => {
          const due = outstanding(l)
          const e = entries[l.productId]
          const qty = e?.qty ?? null
          const v = variance(due, qty)
          const missingReason = needsReason(due, e)
          const flag = invalid && (v === 'pending' || missingReason)
          const base = qty !== null ? inBase(l, qty) : null
          return (
            <li key={l.productId} className={`py-3 ${flag ? '-mx-2 rounded-lg bg-danger-soft/40 px-2' : ''}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 lg:grid-cols-[minmax(0,1fr)_8rem_8rem_5.5rem_7rem]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{l.productName}</div>
                </div>
                <div className="num text-right text-sm text-ink-soft lg:order-none">
                  <span className="text-xs lg:hidden">{t('สั่ง / ค้างรับ')} </span>
                  {fmtQty(l.orderedQty)} / <span className="font-semibold text-ink">{fmtQty(due)}</span>
                </div>
                <div className="flex items-center gap-2 lg:block">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    aria-label={t('รับครั้งนี้: {name}', { name: l.productName })}
                    value={qty ?? ''}
                    onChange={(ev) => set(l.productId, { qty: ev.target.value === '' ? null : Number(ev.target.value) })}
                    className={`num text-right ${flag && v === 'pending' ? 'border-danger' : ''}`}
                  />
                  {base && <span className="text-xs text-ink-faint lg:mt-1 lg:block lg:text-right">{base}</span>}
                </div>
                <div className="text-sm text-ink-soft">{shownUnit(l)}</div>
                <div className="col-span-2 lg:col-span-1">
                  <VarianceChip v={v} diff={Math.abs((qty ?? 0) - due)} />
                </div>
              </div>
              {(v === 'short' || v === 'over') && (
                <Input
                  value={e?.reason ?? ''}
                  onChange={(ev) => set(l.productId, { reason: ev.target.value })}
                  placeholder={v === 'short' ? t('เหตุผลที่ของมาไม่ครบ (บังคับ)') : t('เหตุผลที่ของมาเกิน (บังคับ)')}
                  aria-label={t('เหตุผล: {name}', { name: l.productName })}
                  className={`mt-2 ${missingReason ? 'border-danger bg-danger-soft' : ''}`}
                />
              )}
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}
