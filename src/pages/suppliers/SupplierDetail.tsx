import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { StatusChip, toneIcon, type Tone } from '../../components/frame'
import { focusRing, frameCard } from '../../components/frame/tones'
import { Button } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { fmtMoney, fmtQty, formatThaiDate } from '../../lib/format'
import type { Product, PurchaseOrder, Supplier, SupplierItem } from '../../types'

/**
 * One supplier, read in full beside the list (owner's mock-up 10, spec §2.11): who to call,
 * where they are, how they are paid, what they last sent, and links to their papers.
 *
 * Orders come from the list the page already read — there is no baht figure on a purchase
 * order (no price per line), so an order shows how many lines it carried, which is what the
 * spec settled on.
 *
 * Two ways to show it (owner, 9 Oct 2026: the panel was off-screen after picking a supplier
 * low in a long list):
 * - `panel` (desktop): a card that holds its height to the screen — heading and close at
 *   the top, the actions at the bottom, and only the body in between scrolls;
 * - `sheet` (tablet and phone): the body alone, inside a drawer that has its own heading.
 */
type Tab = 'general' | 'orders' | 'docs'

export function SupplierDetail({
  supplier,
  products,
  orders,
  priceOf,
  onUnlink,
  canEdit,
  onEdit,
  onAddProduct,
  onClose,
  variant = 'panel',
}: {
  supplier: Supplier
  /** Products linked to this supplier. */
  products: Product[]
  /** This supplier's orders, newest first. */
  orders: PurchaseOrder[]
  /** What we pay this supplier for a product, when it is known. */
  priceOf: (productId: string) => SupplierItem | undefined
  /** Admin only: take the product off this supplier. */
  onUnlink?: (product: Product) => void
  canEdit: boolean
  onEdit: () => void
  onAddProduct: () => void
  onClose: () => void
  variant?: 'panel' | 'sheet'
}) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('general')
  const body = useRef<HTMLDivElement>(null)
  // A different supplier starts at the top of its own details — never the list's scroll.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [supplier.id, tab])
  const tone: Tone = supplier.active === false ? 'slate' : 'brand'
  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: t('ข้อมูลทั่วไป') },
    { key: 'orders', label: t('ประวัติการสั่งซื้อ') },
    { key: 'docs', label: t('เอกสาร') },
  ]

  const identity = (
    <div className="flex items-start gap-3">
      <span aria-hidden className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold ${toneIcon[tone]}`}>
        {supplier.name.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        {/* Long names wrap to two lines; the full name is in the title for the rest. */}
        <div className="line-clamp-2 break-words text-base font-bold leading-snug text-ink" title={supplier.name}>
          {supplier.name}
        </div>
        <div className="doc-no text-xs text-ink-faint">{supplier.code ?? t('ยังไม่มีรหัส')}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {supplier.active === false ? (
            <StatusChip tone="slate" size="sm">{t('ไม่ใช้งาน')}</StatusChip>
          ) : (
            <StatusChip tone="green" size="sm">{t('ใช้งานอยู่')}</StatusChip>
          )}
          {supplier.category && (
            <StatusChip tone="blue" icon={null} size="sm">
              {supplier.category}
            </StatusChip>
          )}
          <StatusChip tone={supplier.type === 'takingReturn' ? 'green' : 'red'} icon={null} size="sm">
            {supplier.type === 'takingReturn' ? t('รับคืน') : t('ไม่รับคืน')}
          </StatusChip>
        </div>
      </div>
    </div>
  )

  const tabBar = (
    <div role="tablist" aria-label={t('รายละเอียดผู้ขาย')} className="flex gap-1 rounded-lg bg-sunken p-1">
      {tabs.map((x) => (
        <button
          key={x.key}
          type="button"
          role="tab"
          aria-selected={tab === x.key}
          onClick={() => setTab(x.key)}
          className={`min-h-10 flex-1 cursor-pointer rounded-md px-2 text-sm font-medium ${focusRing} ${tab === x.key ? 'bg-surface text-brand shadow-sm' : 'text-ink-soft hover:text-ink'}`}
        >
          {x.label}
        </button>
      ))}
    </div>
  )

  const content = (
    <>
      {tab === 'general' && (
        <dl className="space-y-2.5 text-sm">
          <Row icon="users" label={t('ผู้ติดต่อ')} value={supplier.contactName} />
          <Row icon="device" label={t('เบอร์ติดต่อ')} value={[supplier.contactNumber, supplier.phone2].filter(Boolean).join(' · ')} />
          <Row icon="note" label={t('อีเมล')} value={supplier.email} />
          <Row icon="building" label={t('ที่อยู่')} value={supplier.address} />
          <Row icon="fileSheet" label={t('เลขผู้เสียภาษี')} value={supplier.taxId} />
          <Row icon="cart" label={t('เงื่อนไขชำระเงิน')} value={supplier.paymentTerms} />
          <Row icon="message" label={t('กลุ่ม LINE')} value={supplier.lineGroup} />
          <Row icon="clock" label={t('ระยะเวลาส่ง')} value={supplier.leadTimeDays === undefined ? '' : t('{n} วัน', { n: supplier.leadTimeDays })} />
          <Row icon="pin" label={t('หมายเหตุ')} value={supplier.note} />
          <div className="border-t border-line pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">{t('สินค้าที่ผูกไว้')}</span>
              <span className="num text-sm text-ink-soft">{t('{n} รายการ', { n: products.length })}</span>
            </div>
            {products.length === 0 ? (
              <p className="text-xs text-ink-faint">{t('ยังไม่ได้ผูกสินค้า')}</p>
            ) : (
              // Every product: the body around it scrolls, so the list no longer needs a
              // scroll box (and a cap at 40) of its own.
              <ul className="divide-y divide-line text-xs">
                {products.map((p) => {
                  const price = priceOf(p.id)?.buyingPrice
                  return (
                    <li key={p.id} className="flex min-h-9 items-center gap-2 py-1">
                      <Link
                        to={`/products/${encodeURIComponent(p.id)}/card`}
                        title={p.name}
                        className={`min-w-0 flex-1 truncate rounded text-ink hover:text-brand hover:underline ${focusRing}`}
                      >
                        {p.name}
                      </Link>
                      {price !== undefined && <span className="num shrink-0 text-ink-soft">฿ {fmtMoney(price)}</span> /* i18n-key */}
                      <span className="doc-no shrink-0 text-ink-faint">{p.sku}</span>
                      {onUnlink && (
                        <button
                          type="button"
                          onClick={() => onUnlink(p)}
                          aria-label={t('ปลด {name} ออกจากผู้ขายนี้', { name: p.name })}
                          className={`min-h-8 shrink-0 rounded px-2 text-[11px] font-medium text-danger hover:bg-danger-soft ${focusRing}`}
                        >
                          {t('ปลด')}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </dl>
      )}

      {tab === 'orders' &&
        (orders.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-faint">{t('ยังไม่มีใบสั่งซื้อในช่วงที่โหลด')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.slice(0, 8).map((o) => (
              <li key={o.id}>
                <Link to={`/orders?po=${encodeURIComponent(o.id)}`} className={`flex items-center gap-3 py-2.5 row-hover ${focusRing}`}>
                  <span className="min-w-0 flex-1">
                    <span className="doc-no block text-sm font-semibold text-ink">{o.docNo}</span>
                    <span className="block text-xs text-ink-faint">{formatThaiDate(o.orderedAt)}</span>
                  </span>
                  <span className="num shrink-0 text-xs text-ink-soft">{t('{n} รายการ', { n: fmtQty(o.lines.length) })}</span>
                  <StatusChip tone={o.status === 'received' ? 'green' : o.status === 'cancelled' ? 'slate' : 'amber'} size="sm">
                    {o.status === 'received' ? t('รับของแล้ว') : o.status === 'cancelled' ? t('ยกเลิกแล้ว') : t('สั่งแล้ว')}
                  </StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'docs' &&
        (!supplier.links || supplier.links.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-faint">
            {canEdit ? t('ยังไม่มีเอกสาร — เพิ่มลิงก์ได้ที่ "แก้ไข"') : t('ยังไม่มีเอกสาร')}
          </p>
        ) : (
          <ul className="space-y-2">
            {supplier.links.map((l) => (
              <li key={`${l.label}-${l.url}`}>
                {/* The papers live in Drive; this app keeps the link, never the file. */}
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:border-line-strong ${focusRing}`}
                >
                  <Icon name="fileSheet" size={16} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate" title={l.label}>
                    {l.label}
                  </span>
                  <Icon name="arrowRight" size={14} className="shrink-0 text-ink-faint" />
                </a>
              </li>
            ))}
          </ul>
        ))}
    </>
  )

  const actions = canEdit && (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={onEdit}>
        <Icon name="pencil" size={16} />
        {t('แก้ไข')}
      </Button>
      <Button variant="secondary" size="sm" onClick={onAddProduct}>
        <Icon name="plus" size={16} />
        {t('เพิ่มสินค้า')}
      </Button>
    </div>
  )

  if (variant === 'sheet')
    return (
      <div data-supplier-detail={supplier.id} className="space-y-4">
        {identity}
        {tabBar}
        <div>{content}</div>
        {actions && <div className="border-t border-line pt-3">{actions}</div>}
      </div>
    )

  return (
    <section data-supplier-detail={supplier.id} aria-label={t('รายละเอียดผู้ขาย')} className={`${frameCard} flex max-h-full min-h-0 flex-col`}>
      {/* Stays put: what this is, and how to close it. */}
      <div className="shrink-0 space-y-3 border-b border-line px-4 pb-3 pt-4 md:px-5">
        <div className="flex items-center gap-3">
          <Icon name="users" size={20} className="text-brand" />
          <h2 className="min-w-0 flex-1 text-base font-bold text-ink md:text-lg">{t('รายละเอียดผู้ขาย')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ปิด')}
            className={`inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-sunken ${focusRing}`}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        {identity}
        {tabBar}
      </div>
      {/* The only part that scrolls, inside the card's own height. */}
      <div ref={body} data-detail-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-5">
        {content}
      </div>
      {actions && <div className="shrink-0 border-t border-line px-4 py-3 md:px-5">{actions}</div>}
    </section>
  )
}

function Row({ icon, label, value }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value?: ReactNode }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-ink-faint" />
      <div className="min-w-0">
        <dt className="text-xs text-ink-faint">{label}</dt>
        <dd className="break-words text-ink">{value}</dd>
      </div>
    </div>
  )
}
