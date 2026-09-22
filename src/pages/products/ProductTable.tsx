import type { Column } from '../../components/DataTable'
import { ItemCell, StatusChip, frameCard, toneIcon, type RowMenuItem } from '../../components/frame'
import { Badge } from '../../components/ui'
import { SiteChip } from '../../components/SiteChip'
import { ProductThumb } from '../../components/ProductThumb'
import { Icon } from '../../components/Icon'
import { categoryIcon } from '../../lib/categoryIcon'
import { breakdown } from '../../lib/inventoryRules/uom'
import { fmtQty, formatThaiDateTime } from '../../lib/format'
import type { Product } from '../../types'
import type { TFn } from '../../i18n/I18nContext'
import { STATE_LOOK, type StockState } from './productStatus'

/** One product as the list shows it, with everything the columns need worked out once. */
export interface ProductRow {
  p: Product
  qty: number
  min: number
  state: StockState
  /** Sites in view that hold some of it. */
  sites: string[]
  /** Newest balance change in view, 0 when it has never moved. */
  updatedAt: number
  /** Legacy balances still kept in another unit (pre-20 Sep rule) — shown, not added. */
  others: { unit: string; qty: number }[]
}

export function QtyFigure({ r, t }: { r: ProductRow; t: TFn }) {
  const extra = r.p.unitConversions?.length ? breakdown(r.qty, r.p, fmtQty) : ''
  return (
    <>
      <span className={`num font-bold ${r.state === 'out' ? 'text-danger' : r.state === 'low' ? 'text-warn' : 'text-ink'}`}>
        {fmtQty(r.qty)}
      </span>
      {/* The unit rides with the figure on a phone card, where the unit column is not shown. */}
      <span className="ml-1 text-xs font-normal text-ink-soft md:hidden">{r.p.unitType}</span>
      {/* The same figure in the product's larger units, for whoever counts by the case. */}
      {extra && <span className="block text-xs font-normal text-ink-faint">= {extra}</span>}
      {r.others.map((o) => (
        <span key={o.unit} className="mt-0.5 block" title={t('ยอดเก่าแยกหน่วย — แปลงได้ที่ ตั้งค่า → ดูแลข้อมูล')}>
          <Badge color="amber">
            {fmtQty(o.qty)} {o.unit} · {t('ยังไม่แปลง')}
          </Badge>
        </span>
      ))}
    </>
  )
}

export function productColumns(t: TFn, siteName: (id: string) => string, locId: string): Column<ProductRow>[] {
  return [
    {
      key: 'product',
      header: t('สินค้า'),
      primary: true,
      // Long catalogue names truncate rather than pushing the figures off the right edge.
      className: 'md:max-w-[260px] 2xl:max-w-[340px]',
      cell: (r) => {
        const look = categoryIcon(r.p.category)
        return (
          <ItemCell
            title={r.p.name}
            sub={
              <>
                <span className="doc-no md:hidden">{r.p.sku} · </span>
                {r.p.category} · {r.p.unitType}
                {r.p.barcode ? <span className="doc-no"> · {r.p.barcode}</span> : null}
              </>
            }
            productId={r.p.id}
            hasImage={r.p.hasImage}
            icon={look.icon}
            tone={look.tone}
          />
        )
      },
    },
    { key: 'sku', header: 'SKU', card: 'hidden', className: 'doc-no whitespace-nowrap text-ink-soft', cell: (r) => r.p.sku },
    {
      key: 'category',
      header: t('หมวดหมู่'),
      card: 'hidden',
      cell: (r) => (
        <StatusChip tone={categoryIcon(r.p.category).tone} icon={null} size="sm">
          {r.p.category}
        </StatusChip>
      ),
    },
    // Below 2xl the unit rides in the name's second line, so its own column can go.
    { key: 'unit', header: t('หน่วย'), card: 'hidden', className: 'hidden text-ink-soft 2xl:table-cell', headerClassName: 'hidden 2xl:table-cell', cell: (r) => r.p.unitType },
    {
      key: 'qty',
      header: locId ? t('คงเหลือ') : t('คงเหลือรวม'),
      card: 'value',
      align: 'right',
      className: 'num',
      cell: (r) => <QtyFigure r={r} t={t} />,
    },
    { key: 'min', header: t('จุดสั่งซื้อ'), align: 'right', className: 'num text-ink-soft', cell: (r) => fmtQty(r.min) },
    {
      key: 'status',
      header: t('สถานะ'),
      cell: (r) => (
        <StatusChip tone={STATE_LOOK[r.state].tone} size="sm">
          {t(STATE_LOOK[r.state].label)}
        </StatusChip>
      ),
    },
    {
      key: 'site',
      header: t('คลังสินค้า'),
      card: 'hidden',
      cell: (r) =>
        locId ? (
          <SiteChip locationId={locId} />
        ) : r.sites.length === 1 ? (
          <SiteChip locationId={r.sites[0]} />
        ) : r.sites.length > 1 ? (
          <span className="inline-flex items-center gap-1.5 text-ink-soft" title={r.sites.map(siteName).join(', ')}>
            <Icon name="store" size={15} />
            {t('{n} คลัง', { n: r.sites.length })}
          </span>
        ) : (
          <span className="text-ink-faint">–</span>
        ),
    },
    {
      key: 'updated',
      header: t('อัปเดตล่าสุด'),
      card: 'hidden',
      className: 'hidden whitespace-nowrap text-xs text-ink-soft 2xl:table-cell',
      headerClassName: 'hidden 2xl:table-cell',
      cell: (r) => (r.updatedAt ? formatThaiDateTime(r.updatedAt) : '–'),
    },
  ]
}

/** The ⋮ menu of one product. */
export function productMenu(
  r: ProductRow,
  t: TFn,
  opts: { isAdmin: boolean; locId: string; go: (to: string) => void; edit: () => void; toggleHidden: () => void; bindBarcode: () => void },
): RowMenuItem[] {
  const card = `/products/${encodeURIComponent(r.p.id)}/card`
  const items: RowMenuItem[] = [
    { key: 'card', label: t('ดู Stock Card / ประวัติ'), icon: 'history', onSelect: () => opts.go(card) },
    { key: 'edit', label: opts.isAdmin ? t('แก้ไข') : t('ดูรายละเอียด'), icon: opts.isAdmin ? 'pencil' : 'eye', onSelect: opts.edit },
    {
      key: 'order',
      label: t('ขอสั่งซื้อ'),
      icon: 'cart',
      onSelect: () => opts.go(`/requests/new?product=${encodeURIComponent(r.p.id)}${opts.locId ? `&location=${encodeURIComponent(opts.locId)}` : ''}`),
    },
  ]
  if (opts.isAdmin) {
    // Scanning one product at a time, standing at the shelf — the other way in is the
    // Barcode column of the Excel import (owner, 22 Sep 2026: both).
    items.push({
      key: 'barcode',
      label: r.p.barcode ? t('เปลี่ยนบาร์โค้ด') : t('สแกนเพื่อผูกบาร์โค้ด'),
      icon: 'barcode',
      onSelect: opts.bindBarcode,
    })
  }
  // Hide rather than delete: a hidden product keeps its balance and its history and is one
  // click from coming back; a deleted one has to be keyed in again from scratch.
  if (opts.isAdmin)
    items.push({
      key: 'hide',
      label: r.p.active === false ? t('เลิกซ่อนสินค้านี้') : t('ซ่อนสินค้านี้'),
      icon: r.p.active === false ? 'eye' : 'eyeOff',
      onSelect: opts.toggleHidden,
    })
  return items
}

/** The grid view: one card per product, four a row on a desk, two on a tablet, one on a phone. */
export function ProductGrid({ rows, onOpen, t }: { rows: ProductRow[]; onOpen: (p: Product) => void; t: TFn }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((r) => {
        const look = categoryIcon(r.p.category)
        return (
          <button
            key={r.p.id}
            type="button"
            onClick={() => onOpen(r.p)}
            className={`${frameCard} flex cursor-pointer flex-col gap-3 p-4 text-left outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-brand/40`}
          >
            <div className="flex items-start gap-3">
              {r.p.hasImage ? (
                <ProductThumb productId={r.p.id} hasImage size={48} />
              ) : (
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${toneIcon[look.tone]}`}>
                  <Icon name={look.icon} size={22} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{r.p.name}</div>
                <div className="doc-no truncate text-xs text-ink-faint">{r.p.sku}</div>
              </div>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-lg leading-tight">
                  <QtyFigure r={r} t={t} />
                  <span className="ml-1 hidden text-xs text-ink-soft md:inline">{r.p.unitType}</span>
                </div>
                <div className="text-xs text-ink-faint">
                  {t('จุดสั่งซื้อ')} {fmtQty(r.min)}
                </div>
              </div>
              <StatusChip tone={STATE_LOOK[r.state].tone} size="sm">
                {t(STATE_LOOK[r.state].label)}
              </StatusChip>
            </div>
          </button>
        )
      })}
    </div>
  )
}
