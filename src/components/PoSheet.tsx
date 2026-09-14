import type { Ref } from 'react'
import { shownUnit } from '../lib/ledger'
import { fmtQty, formatThaiDate } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import type { PurchaseOrder, PurchaseOrderLine } from '../types'

/**
 * The purchase order as the supplier sees it.
 *
 * This is the picture that goes into a LINE chat, so it is drawn the way it always has
 * been — company, number, date, supplier, the lines, who ordered — and nothing else. It is
 * rendered both on screen (the order dialog) and off screen (to be photographed by
 * html2canvas), and the two must be the same element: what the person previews is what the
 * supplier gets.
 *
 * Two constraints come from the photographing:
 *   - No opacity modifiers on colours (`border-line/60`). Tailwind writes those as
 *     color-mix(in oklab, …), the browser computes an oklab() value, and html2canvas
 *     cannot parse one. Plain tokens only.
 *   - White background, always. A dark-theme card photographed as a dark picture is
 *     unreadable in a bright chat window.
 */

/** Lines per picture before the sheet is split — see paginateLines in lib/poImage.ts. */
export interface SheetPage {
  n: number
  of: number
}

export function PoSheet({
  order,
  lines = order.lines,
  locationName,
  company,
  page,
  ref,
  id = 'order-sheet',
}: {
  order: PurchaseOrder
  /** A subset of the order's lines, when the sheet is split into pages. */
  lines?: readonly PurchaseOrderLine[]
  locationName: string
  /** The company placing the order. One install serves two, so it is on the sheet. */
  company: string
  page?: SheetPage
  ref?: Ref<HTMLDivElement>
  id?: string
}) {
  const t = useT()
  return (
    <div id={id} ref={ref} className="rounded-lg border border-line-strong bg-white p-4 text-ink">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-brand">{company}</div>
          <div className="text-base font-bold">{t('ใบสั่งซื้อ')}</div>
          <div className="doc-no text-xs text-ink-faint">
            {order.docNo}
            {page && page.of > 1 ? ` · ${page.n}/${page.of}` : ''}
          </div>
        </div>
        <div className="text-right text-xs text-ink-soft">
          <div>{formatThaiDate(order.orderedAt)}</div>
          <div>{locationName}</div>
        </div>
      </div>
      <div className="py-2 text-sm">
        <span className="text-ink-soft">{t('ผู้ขาย')}: </span>
        <span className="font-semibold">{order.supplierName}</span>
      </div>
      <table className="w-full text-sm">
        <thead className="border-y border-line text-xs text-ink-soft">
          <tr>
            <th className="py-1 text-left font-medium">{t('รายการ')}</th>
            <th className="py-1 text-right font-medium">{t('จำนวน')}</th>
            <th className="py-1 text-left font-medium">{t('หน่วย')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.productId} className="border-b border-line align-top">
              <td className="py-1 pr-2 break-words">{l.productName}</td>
              <td className="num whitespace-nowrap py-1 text-right font-semibold">{fmtQty(l.orderedQty)}</td>
              <td className="whitespace-nowrap py-1 pl-2 text-ink-soft">{shownUnit(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pt-2 text-xs text-ink-faint">
        {t('ผู้สั่ง')}: {order.createdByName}
        {order.invoiceNo ? ` · ${t('บิล')} ${order.invoiceNo}` : ''}
        {order.note ? ` · ${order.note}` : ''}
      </div>
    </div>
  )
}
