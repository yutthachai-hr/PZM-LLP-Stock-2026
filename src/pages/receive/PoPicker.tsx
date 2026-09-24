import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionCard, StatusChip } from '../../components/frame'
import { Button, SearchInput, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { formatThaiDate } from '../../lib/format'
import { useT } from '../../i18n/I18nContext'
import type { PurchaseOrder } from '../../types'
import { partialLabel } from './receipt'

/**
 * Which purchase order this delivery is for.
 *
 * Only orders still waiting for goods are offered (listOpenOrders), searched by their number,
 * the supplier, or anything on them — the person holding a delivery note knows at least one
 * of the three. Once one is picked the list folds into a line naming it, with a way back.
 */
export function PoPicker({
  orders,
  selected,
  missing,
  onPick,
  onClear,
  focusSearch,
}: {
  /** null while loading. */
  orders: PurchaseOrder[] | null
  selected: PurchaseOrder | null
  /** An order was asked for (a link, a draft) that is no longer waiting for goods. */
  missing: boolean
  onPick: (order: PurchaseOrder) => void
  onClear: () => void
  /** Bump to put the cursor in the search box — after "next bill". */
  focusSearch: number
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusSearch) box.current?.querySelector('input')?.focus()
  }, [focusSearch])

  const hits = useMemo(() => {
    const all = orders ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (o) =>
        o.docNo.toLowerCase().includes(needle) ||
        o.supplierName.toLowerCase().includes(needle) ||
        o.lines.some((l) => l.productName.toLowerCase().includes(needle)),
    )
  }, [orders, q])

  if (selected) {
    const partial = partialLabel(selected, t)
    return (
      <SectionCard icon="fileSheet" title={t('ใบสั่งซื้อ')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-ink">{selected.supplierName}</span>
              <span className="num rounded-md bg-sunken px-2 py-0.5 text-sm font-semibold text-ink-soft">{selected.docNo}</span>
              {partial && <StatusChip tone="amber" size="sm">{partial}</StatusChip>}
            </div>
            <div className="mt-1 text-sm text-ink-soft">
              {t('สั่งวันที่ {d}', { d: formatThaiDate(selected.orderedAt) })}
              {selected.expectedAt ? ' · ' + t('กำหนดส่ง {d}', { d: formatThaiDate(selected.expectedAt) }) : ''}
            </div>
          </div>
          <Button variant="secondary" onClick={onClear}>
            <Icon name="swap" size={16} />
            {t('เปลี่ยนใบสั่งซื้อ')}
          </Button>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard icon="fileSheet" title={t('เลือกใบสั่งซื้อ')} count={orders ? t('({n} ใบที่รอรับ)', { n: orders.length }) : undefined}>
      <div className="space-y-3">
        {missing && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {t('ใบสั่งซื้อที่เลือกไว้ไม่ได้รอรับของแล้ว (รับครบ ปิด หรือยกเลิกไปแล้ว) — เลือกใบใหม่')}
          </p>
        )}
        <div ref={box}>
          <SearchInput value={q} onChange={setQ} placeholder={t('ค้นหาเลข PO / ผู้ขาย / สินค้า')} />
        </div>
        {orders === null ? (
          <div className="py-6">
            <Spinner />
          </div>
        ) : hits.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-faint">
            {orders.length === 0 ? t('ไม่มีใบสั่งซื้อที่รอรับของ — ใช้ "รับนอกใบสั่งซื้อ"') : t('ไม่พบใบสั่งซื้อที่ตรงกับคำค้น')}
          </p>
        ) : (
          <ul className="max-h-[26rem] divide-y divide-line overflow-auto rounded-xl border border-line">
            {hits.map((o) => {
              const partial = partialLabel(o, t)
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => onPick(o)}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-sunken focus-visible:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{o.supplierName}</span>
                        <span className="num text-xs font-semibold text-ink-soft">{o.docNo}</span>
                        {partial && <StatusChip tone="amber" size="sm">{partial}</StatusChip>}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">
                        {t('สั่ง {d}', { d: formatThaiDate(o.orderedAt) })}
                        {o.expectedAt ? ' · ' + t('กำหนดส่ง {d}', { d: formatThaiDate(o.expectedAt) }) : ''}
                        {' · '}
                        {t('{n} รายการ', { n: o.lines.length })}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={18} className="shrink-0 text-ink-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}
