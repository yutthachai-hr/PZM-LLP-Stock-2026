import type { Ref } from 'react'
import { shownUnit } from '../lib/ledger'
import { fmtQty, formatDateFor } from '../lib/format'
import { translatorFor, useI18n, type Lang } from '../i18n/I18nContext'
import { SegTab } from './ui'
import type { PurchaseOrder, PurchaseOrderLine } from '../types'

/**
 * The purchase order as the supplier sees it — and, once the goods are in, the receipt.
 *
 * This is the picture that goes into a LINE chat, so it is drawn the way it always has
 * been — company, number, date, supplier, the lines, who ordered — and nothing else. It is
 * rendered both on screen (the order dialog) and off screen (to be photographed by
 * html2canvas), and the two must be the same element: what the person previews is what the
 * supplier gets.
 *
 * It carries its own language. Some suppliers read English, and the person sending may be
 * reading the app in Thai, so the sheet's `lang` is chosen beside it (SheetLangToggle)
 * rather than following the screen. Dates follow the language: Buddhist year in Thai,
 * Gregorian in English.
 *
 * A received order shows both columns — ordered and received — with the receipt stamped
 * on it: what arrived, when, on which invoice, checked in by whom. The owner's words:
 * "ต้องมีระบุในใบด้วยว่ารับของแล้ว และจำนวนต้องตรงกับที่รับจริง".
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
  lang,
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
  /** The sheet's own language; the screen's when not given. */
  lang?: Lang
}) {
  const screen = useI18n()
  const L: Lang = lang ?? screen.lang
  const t = translatorFor(L)
  const received = order.status === 'received'
  const cancelled = order.status === 'cancelled'
  const date = (ms: number) => formatDateFor(ms, L)
  return (
    <div id={id} ref={ref} className="rounded-lg border border-line-strong bg-white p-4 text-ink">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-brand">{company}</div>
          <div className="text-base font-bold">{received ? t('ใบรับของ') : t('ใบสั่งซื้อ')}</div>
          <div className="doc-no text-xs text-ink-faint">
            {order.docNo}
            {order.revision ? ` · Rev.${order.revision}` : ''}
            {page && page.of > 1 ? ` · ${page.n}/${page.of}` : ''}
          </div>
        </div>
        <div className="text-right text-xs text-ink-soft">
          <div>
            {t('วันที่สั่ง')} {date(order.orderedAt)}
          </div>
          {order.expectedAt !== undefined && !received && (
            <div>
              {t('กำหนดส่ง')} {date(order.expectedAt)}
            </div>
          )}
          <div>{locationName}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span>
          <span className="text-ink-soft">{t('ผู้ขาย:')} </span>
          <span className="font-semibold">{order.supplierName}</span>
        </span>
        {received && (
          // The stamp. A plain bordered box rather than a badge token, so html2canvas
          // draws it exactly as it is here.
          <span className="rounded border-2 border-in px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-in">
            {t('รับของแล้ว')}
            {order.receivedAt ? ` · ${date(order.receivedAt)}` : ''}
          </span>
        )}
        {cancelled && (
          <span className="rounded border-2 border-out px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-out">
            {t('ยกเลิกแล้ว')}
            {order.cancelledAt ? ` · ${date(order.cancelledAt)}` : ''}
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-soft">
          <tr>
            <th className="py-1 text-left font-medium">{t('รายการสินค้า')}</th>
            <th className="py-1 text-right font-medium">{received ? t('สั่ง') : t('จำนวน')}</th>
            <th className="py-1 text-left font-medium">{t('หน่วย')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const got = l.receivedQty ?? 0
            const short = received && got !== l.orderedQty
            return (
              <tr key={l.productId} className="align-top">
                <td className="py-1 pr-2 break-words">
                  {l.productName}
                  {/* What actually arrived, on its own line under the item so the eye
                      finds it: green when it matches the order, red when it does not. */}
                  {received && (
                    <span className={`block text-xs font-semibold ${short ? 'text-out' : 'text-in'}`}>
                      {t('รับจริง')} {fmtQty(got)} {shownUnit(l)}
                      {l.note ? <span className="font-normal text-ink-soft"> · {l.note}</span> : null}
                    </span>
                  )}
                </td>
                <td className={`num whitespace-nowrap py-1 text-right ${received ? 'text-ink-soft' : 'font-semibold'}`}>
                  {fmtQty(l.orderedQty)}
                </td>
                <td className="whitespace-nowrap py-1 pl-2 text-ink-soft">{shownUnit(l)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="pt-2 text-xs text-ink-faint">
        {t('ผู้สั่ง')}: {order.createdByName}
        {received && order.receivedByName ? ` · ${t('ผู้รับของ')}: ${order.receivedByName}` : ''}
        {cancelled && order.cancelledByName ? ` · ${t('ผู้ยกเลิก')}: ${order.cancelledByName}` : ''}
        {cancelled && order.cancelReason ? ` · ${t('เหตุผล')}: ${order.cancelReason}` : ''}
        {order.invoiceNo ? ` · ${t('บิล')} ${order.invoiceNo}` : ''}
        {order.note ? ` · ${order.note}` : ''}
      </div>
    </div>
  )
}

/** TH / EN for the sheet, beside it. Starts on the screen's language. */
export function SheetLangToggle({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-soft">{t('ภาษา')}</span>
      <div className="flex gap-1 rounded-lg bg-sunken p-1">
        <SegTab grow={false} label="TH" active={value === 'th'} onClick={() => onChange('th')} />
        <SegTab grow={false} label="EN" active={value === 'en'} onClick={() => onChange('en')} />
      </div>
    </div>
  )
}
