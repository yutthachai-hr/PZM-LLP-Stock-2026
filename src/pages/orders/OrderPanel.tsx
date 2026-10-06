import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { Badge, Button } from '../../components/ui'
import { ItemCell, type Tone } from '../../components/frame'
import { useI18n, useT, type TFn } from '../../i18n/I18nContext'
import { fmtQty, formatThaiDate, formatThaiDateTime } from '../../lib/format'
import { shownUnit } from '../../lib/ledger'
import { daysWaiting, needsResend } from '../../services/purchaseOrders'
import type { PurchaseOrder, Supplier } from '../../types'
import { DeliveryRiskCard, SupplierConfirmationPanel, describeActivity } from '../purchase/SupplierConfirmationPanel'
import { statusWord } from './statusWords'

/**
 * The order beside the list (owner's mock-up, 6 Oct 2026): pressing a row opens it here
 * instead of a modal, so the next order is one click (or the arrows) away and the list
 * stays in view. On a desktop it is a column on the right; on a phone it covers the screen.
 *
 * Read-only by itself: every action is the page's own (send, receive, amend, cancel, close
 * short, the printable sheet), handed in, so the panel and the row's buttons do the same
 * thing the same way.
 */
export interface OrderPanelActions {
  onSend: () => void
  onReceive: () => void
  onAmend: () => void
  onCancel: () => void
  onCloseShort: () => void
  /** The printable / shareable sheet (the A5 page and the JPG). */
  onSheet: () => void
  // A manager or admin placing a draft (plan B4).
  onApprove?: () => void
}

export function OrderPanel({
  order,
  supplier,
  late,
  expectedAt,
  position,
  onPrev,
  onNext,
  onClose,
  onChanged,
  actions,
}: {
  order: PurchaseOrder
  supplier?: Supplier
  late: boolean
  expectedAt?: number
  /** Where this order sits in the list being browsed, e.g. 3 of 25. */
  position: { index: number; total: number }
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  onChanged: (order: PurchaseOrder) => void
  actions: OrderPanelActions
}) {
  const t = useT()
  const { lang } = useI18n()
  const [tab, setTab] = useState<'detail' | 'history'>('detail')
  const [more, setMore] = useState(false)
  useEffect(() => setMore(false), [order.id])

  // Arrow keys step through the list, Escape closes — unless someone is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowUp' && onPrev) onPrev()
      else if (e.key === 'ArrowDown' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const live = order.status === 'ordered'
  const partial = live && !!order.receipts?.length
  const head = headBadge(order, t)
  const confirmed = order.supplierConfirmationStatus === 'confirmed' || order.supplierConfirmationStatus === 'changed'

  const steps: Step[] = [
    { label: t('สร้างใบสั่งซื้อ'), at: order.createdAt, done: true },
    { label: statusWord('lineSent', lang), at: order.sentAt, done: order.shareStatus === 'sent' && !needsResend(order) },
    { label: statusWord('confirmed', lang), at: order.supplierConfirmedAt, done: confirmed || order.status === 'received' },
    {
      label: t('รับของ'),
      at: order.receivedAt,
      done: order.status === 'received',
      hint: order.status !== 'received' && expectedAt ? `${formatThaiDate(expectedAt)}\n(${t('กำหนด')})` : undefined,
    },
  ]

  const history = historyOf(order, t)

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Top bar: step through the list, close. */}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <IconButton label={t('ใบก่อนหน้า')} icon="chevronLeft" onClick={onPrev} />
        <IconButton label={t('ใบถัดไป')} icon="chevronRight" onClick={onNext} />
        <span className="num ml-1 text-xs text-ink-faint">
          {position.index + 1} / {position.total}
        </span>
        <span className="flex-1" />
        <IconButton label={t('ปิด')} icon="x" onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="doc-no text-xl font-bold text-ink">{order.docNo}</h2>
          <Badge color={head.color}>{head.label}</Badge>
          {order.revision ? <Badge color="amber">Rev.{order.revision}</Badge> : null}
          <span className="flex-1" />
          <IconButton label={t('พิมพ์ / บันทึก PDF (A5)')} icon="download" onClick={actions.onSheet} />
        </div>

        {/* Who it is from, and how to reach them. */}
        <div className="flex items-center gap-3">
          <ItemCell title="" avatar={order.supplierName} tone={avatarTone(order.supplierName)} />
          <div className="min-w-0 flex-1 font-semibold text-ink">{order.supplierName}</div>
          {supplier?.contactNumber && (
            <a
              href={`tel:${supplier.contactNumber}`}
              title={supplier.contactNumber}
              aria-label={t('โทรหาผู้ขาย')}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-sunken"
            >
              <Icon name="phone" size={16} />
            </a>
          )}
          <Link to="/suppliers" className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-sunken">
            {t('ดูข้อมูลผู้ขาย')}
          </Link>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-faint">{t('วันที่สั่ง')}</dt>
          <dd className="num text-ink">{formatThaiDate(order.orderedAt)}</dd>
          {order.status !== 'cancelled' && (
            <>
              <dt className="text-ink-faint">{order.status === 'received' ? t('รับของเมื่อ') : t('กำหนดส่ง')}</dt>
              <dd className={`num ${late ? 'font-semibold text-danger' : 'text-ink'}`}>
                {order.status === 'received'
                  ? order.receivedAt
                    ? formatThaiDate(order.receivedAt)
                    : '—'
                  : expectedAt
                    ? formatThaiDate(expectedAt)
                    : t('ไม่ระบุ')}
                {late && ` · ${t('รอมา {days} วัน', { days: daysWaiting(order) })}`}
              </dd>
            </>
          )}
          <dt className="text-ink-faint">{t('คลังปลายทาง')}</dt>
          <dd>
            <SiteChip locationId={order.locationId} />
          </dd>
          <dt className="text-ink-faint">{t('ผู้สั่งซื้อ')}</dt>
          <dd className="text-ink">{order.createdByName}</dd>
          {order.requestId && (
            <>
              <dt className="text-ink-faint">{t('ที่มา')}</dt>
              <dd>
                <Link to={`/requests/${order.requestId}`} className="text-brand hover:underline">
                  {t('จากรายการขอสั่งซื้อ')}
                </Link>
              </dd>
            </>
          )}
          {order.invoiceNo && (
            <>
              <dt className="text-ink-faint">{t('เลขที่บิล')}</dt>
              <dd className="text-ink">{order.invoiceNo}</dd>
            </>
          )}
        </dl>

        {order.status === 'cancelled' ? (
          <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
            <p className="font-semibold text-danger">{t('ยกเลิกแล้ว')}</p>
            <p className="text-ink-soft">
              {order.cancelledByName} · {order.cancelledAt ? formatThaiDateTime(order.cancelledAt) : ''}
            </p>
            {order.cancelReason && <p className="mt-1 whitespace-pre-line text-ink">{order.cancelReason}</p>}
          </div>
        ) : (
          <Stepper steps={steps} />
        )}

        <div role="tablist" className="flex border-b border-line text-sm">
          {(
            [
              ['detail', t('รายละเอียด')],
              ['history', t('ประวัติการทำงาน ({n})', { n: history.length })],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-2 font-medium ${
                tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'detail' ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="flex items-center justify-between bg-sunken px-3 py-2 text-sm font-semibold text-ink">
                {t('รายการสินค้า ({n})', { n: order.lines.length })}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th className="w-8 px-3 py-1.5 font-medium">#</th>
                    <th className="px-1 py-1.5 font-medium">{t('สินค้า')}</th>
                    <th className="px-1 py-1.5 text-right font-medium">{t('จำนวน')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('หน่วย')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {order.lines.map((l, i) => (
                    <tr key={`${l.productId}-${i}`}>
                      <td className="num px-3 py-1.5 text-ink-faint">{i + 1}</td>
                      <td className="px-1 py-1.5 text-ink">
                        {l.productName}
                        {l.receivedQty !== undefined && (order.receipts?.length || order.status === 'received') ? (
                          <span className="block text-xs text-ink-faint">
                            {t('รับแล้ว {qty}', { qty: fmtQty(l.receivedQty) })}
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-1 py-1.5 text-right text-ink">{fmtQty(l.orderedQty)}</td>
                      <td className="px-3 py-1.5 text-ink-soft">{shownUnit(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {order.note && <p className="whitespace-pre-line rounded-lg bg-sunken p-3 text-sm text-ink-soft">{order.note}</p>}
            <SupplierConfirmationPanel order={order} onChanged={onChanged} />
            {live && <DeliveryRiskCard order={order} />}
          </div>
        ) : (
          <ol className="space-y-2">
            {history.length === 0 && <li className="text-sm text-ink-faint">{t('ยังไม่มีประวัติ')}</li>}
            {history.map((h, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="num w-32 shrink-0 text-xs text-ink-faint">{formatThaiDateTime(h.at)}</span>
                <span className="text-ink">{h.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* The actions, in the order the mock-up has them; receiving is the main one. */}
      {order.status !== 'cancelled' && (
        <div className="space-y-2 border-t border-line p-3">
          <div className="flex items-center gap-2">
            {(live || order.status === 'draft') && (
              <div className="relative">
                <Button variant="outline" onClick={() => setMore((v) => !v)} aria-expanded={more}>
                  <Icon name="moreVertical" size={16} />
                  <span className="hidden sm:inline">{t('เพิ่มเติม')}</span>
                </Button>
                {more && (
                  <div className="absolute bottom-full left-0 z-10 mb-1 w-44 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
                    {live && !partial && <MenuItem onClick={actions.onAmend}>{t('แก้ไข')}</MenuItem>}
                    {partial && <MenuItem onClick={actions.onCloseShort}>{t('ปิดยอดค้าง')}</MenuItem>}
                    {!partial && (
                      <MenuItem danger onClick={actions.onCancel}>
                        {t('ยกเลิกใบสั่งซื้อ')}
                      </MenuItem>
                    )}
                  </div>
                )}
              </div>
            )}
            {live && (
              <Button variant="outline" className="whitespace-nowrap" onClick={actions.onSend}>
                <Icon name="share" size={16} />
                {t('ส่ง LINE')}
              </Button>
            )}
            {actions.onApprove && (
              <Button variant="success" className="flex-1 whitespace-nowrap" onClick={actions.onApprove}>
                <Icon name="check" size={16} />
                {t('อนุมัติสั่งซื้อ')}
              </Button>
            )}
            {live && (
              <Button className="flex-1 whitespace-nowrap" onClick={actions.onReceive}>
                <Icon name="truck" size={16} />
                {partial ? t('รับส่วนที่เหลือ') : t('ตรวจรับของ')}
              </Button>
            )}
          </div>
          <Button variant="secondary" className="w-full" onClick={actions.onSheet}>
            <Icon name="download" size={16} />
            {t('พิมพ์ / แชร์ใบสั่งซื้อ')}
          </Button>
        </div>
      )}
    </div>
  )
}

interface Step {
  label: string
  at?: number
  done: boolean
  hint?: string
}

/** The four moments of an order, ticked as they happen. */
function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col items-center text-center">
          {i > 0 && (
            <span
              aria-hidden
              className={`absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 ${s.done ? 'bg-brand' : 'bg-line'}`}
            />
          )}
          <span
            className={`relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border-2 ${
              s.done ? 'border-brand bg-brand text-white' : 'border-line bg-surface'
            }`}
          >
            {s.done && <Icon name="check" size={13} />}
          </span>
          <span className="mt-1 text-xs font-medium text-ink">{s.label}</span>
          {/* Date and time on their own lines: four steps side by side on a phone leave no
              room for "06/10/2569 16:56" on one. */}
          <span className="num whitespace-pre-line text-[11px] leading-tight text-ink-faint">
            {s.done && s.at ? (
              <>
                {formatThaiDate(s.at)}
                <br />
                {clock(s.at)}
              </>
            ) : (
              (s.hint ?? '')
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** HH:mm in Bangkok, the time a step happened. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
}

function IconButton({ label, icon, onClick }: { label: string; icon: 'chevronLeft' | 'chevronRight' | 'x' | 'download'; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-soft hover:bg-sunken disabled:cursor-default disabled:opacity-40"
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

function MenuItem({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-sunken ${danger ? 'text-danger' : 'text-ink'}`}
    >
      {children}
    </button>
  )
}

function headBadge(o: PurchaseOrder, t: (k: string) => string): { label: string; color: 'red' | 'green' | 'slate' | 'amber' } {
  if (o.status === 'received') return o.closedShortAt ? { label: t('ปิดยอดค้าง'), color: 'amber' } : { label: t('รับของแล้ว'), color: 'green' }
  if (o.status === 'cancelled') return { label: t('ยกเลิกแล้ว'), color: 'slate' }
  if (o.status === 'draft') return { label: t('ร่าง — รออนุมัติ'), color: 'slate' }
  return { label: t('รอรับของ'), color: 'red' }
}

/** Everything that happened to the order, newest first, from the fields it already carries. */
function historyOf(o: PurchaseOrder, t: TFn): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [{ at: o.createdAt, text: t('{who} สร้างใบสั่งซื้อ', { who: o.createdByName }) }]
  if (o.approvedAt) out.push({ at: o.approvedAt, text: t('{who} อนุมัติร่าง', { who: o.approvedByName ?? '' }) })
  if (o.sentAt) out.push({ at: o.sentAt, text: t('{who} ส่งเข้า LINE', { who: o.sentByName ?? '' }) })
  for (const r of o.revisions ?? []) out.push({ at: r.at, text: t('{who} แก้ไขครั้งที่ {rev}: {reason}', { who: r.byName, rev: r.rev, reason: r.reason }) })
  for (const a of o.supplierActivity ?? []) out.push({ at: a.at, text: describeActivity(a, t) })
  for (const r of o.receipts ?? []) out.push({ at: r.date, text: t('{who} รับของ {docNo} (บิล {invoice})', { who: r.byName, docNo: r.docNo, invoice: r.invoiceNo }) })
  if (o.closedShortAt) out.push({ at: o.closedShortAt, text: t('{who} ปิดยอดค้าง', { who: o.closedShortByName ?? '' }) })
  if (o.cancelledAt) out.push({ at: o.cancelledAt, text: t('{who} ยกเลิกใบสั่งซื้อ', { who: o.cancelledByName ?? '' }) })
  return out.sort((a, b) => b.at - a.at)
}

/** A steady colour per supplier, from its name, for the initials circle. */
const AVATAR_TONES: Tone[] = ['red', 'blue', 'green', 'amber', 'purple']
export function avatarTone(name: string): Tone {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}
