import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { SectionCard, StatusChip, toneIcon, type Tone } from '../../components/frame'
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
}) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('general')
  const tone: Tone = supplier.active === false ? 'slate' : 'brand'
  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: t('ข้อมูลทั่วไป') },
    { key: 'orders', label: t('ประวัติการสั่งซื้อ') },
    { key: 'docs', label: t('เอกสาร') },
  ]

  return (
    <SectionCard
      icon="users"
      title={t('รายละเอียดผู้ขาย')}
      actions={
        <button type="button" onClick={onClose} aria-label={t('ปิด')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint hover:bg-sunken">
          <Icon name="x" size={18} />
        </button>
      }
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold ${toneIcon[tone]}`}>
          {supplier.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-base font-bold text-ink">{supplier.name}</div>
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

      <div role="tablist" className="mt-4 flex gap-1 rounded-lg bg-sunken p-1">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={`min-h-10 flex-1 cursor-pointer rounded-md px-2 text-sm font-medium ${tab === x.key ? 'bg-surface text-brand shadow-sm' : 'text-ink-soft hover:text-ink'}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'general' && (
          <dl className="space-y-2.5 text-sm">
            <Row icon="users" label={t('ผู้ติดต่อ')} value={supplier.contactName} />
            <Row icon="device" label={t('เบอร์ติดต่อ')} value={[supplier.contactNumber, supplier.phone2].filter(Boolean).join(' · ')} />
            <Row icon="note" label={t('อีเมล')} value={supplier.email} />
            <Row icon="building" label={t('ที่อยู่')} value={supplier.address} />
            <Row icon="fileSheet" label={t('เลขผู้เสียภาษี')} value={supplier.taxId} />
            <Row icon="cart" label={t('เงื่อนไขชำระเงิน')} value={supplier.paymentTerms} />
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
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {products.slice(0, 40).map((p) => {
                    const price = priceOf(p.id)?.buyingPrice
                    return (
                      <li key={p.id} className="flex items-center gap-2">
                        <Link to={`/products/${encodeURIComponent(p.id)}/card`} className="min-w-0 flex-1 truncate text-ink hover:text-brand hover:underline">
                          {p.name}
                        </Link>
                        {price !== undefined && <span className="num shrink-0 text-ink-soft">฿ {fmtMoney(price)}</span> /* i18n-key */}
                        <span className="doc-no shrink-0 text-ink-faint">{p.sku}</span>
                        {onUnlink && (
                          <button type="button" onClick={() => onUnlink(p)} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-danger hover:bg-danger-soft">
                            {t('ปลด')}
                          </button>
                        )}
                      </li>
                    )
                  })}
                  {products.length > 40 && <li className="text-ink-faint">{t('และอีก {n} รายการ', { n: products.length - 40 })}</li>}
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
                  <Link to={`/orders?po=${encodeURIComponent(o.id)}`} className="flex items-center gap-3 py-2.5 hover:bg-sunken">
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
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:border-line-strong"
                  >
                    <Icon name="fileSheet" size={16} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                    <Icon name="arrowRight" size={14} className="shrink-0 text-ink-faint" />
                  </a>
                </li>
              ))}
            </ul>
          ))}
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Icon name="pencil" size={16} />
            {t('แก้ไข')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onAddProduct}>
            <Icon name="plus" size={16} />
            {t('เพิ่มสินค้า')}
          </Button>
        </div>
      )}
    </SectionCard>
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
