import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { fmtMoney, fmtQty, formatThaiDateShort } from '../../lib/format'
import { bkkDayStart, bkkTimeOf } from '../../lib/inventoryRules/time'
import type { StockShortage } from '../../lib/inventoryRules/lowStock'
import { activityKind, type ActivityKind } from '../../lib/stats/periodCompare'
import type { PurchaseOrder, PurchaseRequest, StockMovement } from '../../types'
import { BarsChart } from '../charts'
import { Icon, type IconName } from '../Icon'
import { ItemCell, QtyPill, SectionCard, SeeAll, toneIcon, type Tone } from '../frame'
import type { BranchRow } from './useDashboardFigures'

/**
 * The blocks under the dashboard's figures (owner's mock-up 01, spec §2.1). Each is a
 * SectionCard; the page arranges them per screen size.
 */

// ---- weekly movement ------------------------------------------------------------------

export function WeeklyMovementCard({ weekly }: { weekly: { day: number; in: number; out: number; transfer: number }[] }) {
  const t = useT()
  const data = weekly.map((d) => {
    const dt = new Date(d.day + 7 * 3_600_000)
    return { label: `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`, in: d.in, out: d.out, transfer: d.transfer }
  })
  const empty = weekly.every((d) => d.in + d.out + d.transfer === 0)
  return (
    <SectionCard icon="chart" title={t('ความเคลื่อนไหวสินค้าคงคลัง')} count={t('(7 วันที่ผ่านมา · จำนวนรายการ)')}>
      {empty ? (
        <p className="py-10 text-center text-sm text-ink-faint">{t('ยังไม่มีความเคลื่อนไหวใน 7 วันที่ผ่านมา')}</p>
      ) : (
        <BarsChart
          data={data}
          xKey="label"
          height={280}
          series={[
            { key: 'in', label: t('รับเข้า'), color: 'var(--color-tile-green)' },
            { key: 'out', label: t('จ่ายออก'), color: 'var(--color-tile-red)' },
            { key: 'transfer', label: t('โอนย้าย'), color: 'var(--color-tile-blue)' },
          ]}
        />
      )}
    </SectionCard>
  )
}

// ---- low stock -------------------------------------------------------------------------

export function LowStockCard({ low }: { low: StockShortage[] }) {
  const t = useT()
  const top = low.slice(0, 5)
  return (
    <SectionCard icon="warning" tone="red" title={t('สินค้าคงเหลือน้อย')} actions={<SeeAll to="/products" />} flush>
      {top.length === 0 ? (
        <p className="px-5 pb-6 pt-2 text-center text-sm text-ink-faint">{t('ไม่มีรายการที่ต่ำกว่าขั้นต่ำ')}</p>
      ) : (
        <>
        {/* A phone reads a list, not a four-column table. */}
        <ul className="divide-y divide-line px-4 pb-2 md:hidden">
          {top.map((s) => (
            <li key={`${s.location.id}-${s.product.id}`}>
              <Link to={`/products/${encodeURIComponent(s.product.id)}/card`} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <ItemCell title={s.product.name} sub={s.location.name} productId={s.product.id} hasImage={s.product.hasImage} />
                </span>
                <span className="shrink-0 text-right">
                  <QtyPill tone={s.out || s.qty <= s.min / 2 ? 'red' : 'amber'}>{fmtQty(s.qty)}</QtyPill>
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    {t('ขั้นต่ำ')} {fmtQty(s.min)} {s.product.unitType}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto px-4 pb-4 md:block md:px-5">
          <table className="w-full min-w-[420px] table-fixed text-sm">
            <thead className="bg-sunken text-left text-[13px] text-ink-soft">
              <tr>
                <th className="rounded-l-lg px-3 py-2.5 font-semibold">{t('สินค้า')}</th>
                <th className="w-24 px-3 py-2.5 text-center font-semibold">{t('คงเหลือ')}</th>
                <th className="w-16 px-3 py-2.5 text-center font-semibold">{t('หน่วย')}</th>
                <th className="w-20 rounded-r-lg px-3 py-2.5 text-right font-semibold">{t('ขั้นต่ำ')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {top.map((s) => (
                <tr key={`${s.location.id}-${s.product.id}`}>
                  <td className="px-3 py-2.5">
                    <Link to={`/products/${encodeURIComponent(s.product.id)}/card`} className="block hover:underline">
                      <ItemCell
                        title={s.product.name}
                        sub={`${s.product.sku} · ${s.location.name}`}
                        productId={s.product.id}
                        hasImage={s.product.hasImage}
                      />
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <QtyPill tone={s.out || s.qty <= s.min / 2 ? 'red' : 'amber'}>{fmtQty(s.qty)}</QtyPill>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-ink-soft">{s.product.unitType}</td>
                  <td className="num px-3 py-2.5 text-right text-ink-soft">{fmtQty(s.min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </SectionCard>
  )
}

// ---- branches --------------------------------------------------------------------------

export function BranchOverviewCard({ branches }: { branches: BranchRow[] }) {
  const t = useT()
  return (
    <SectionCard icon="building" title={t('ภาพรวมสาขา')} actions={<SeeAll to="/reports" />} flush>
      <div className="overflow-x-auto px-4 pb-4 md:px-5">
        <table className="w-full min-w-[360px] text-sm [&_td]:px-2 [&_th]:whitespace-nowrap [&_th]:px-2">
          <thead className="bg-sunken text-left text-[13px] text-ink-soft">
            <tr>
              <th className="rounded-l-lg px-3 py-2.5 font-semibold">{t('สาขา')}</th>
              <th className="px-3 py-2.5 text-right font-semibold">{t('สินค้าที่มีของ')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('ใกล้หมด')}</th>
              <th className="px-3 py-2.5 text-right font-semibold">{t('มูลค่าสินค้า')}</th>
              <th className="rounded-r-lg px-3 py-2.5 font-semibold">{t('สถานะ')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {branches.map((b) => (
              <tr key={b.location.id}>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 whitespace-nowrap font-medium text-ink">
                    <Icon name="store" size={17} className="text-ink-faint" />
                    {b.location.name}
                  </span>
                </td>
                <td className="num px-3 py-2.5 text-right text-ink-soft">{fmtQty(b.stocked)}</td>
                <td className="px-3 py-2.5 text-center">
                  {b.low > 0 ? <QtyPill tone="red">{b.low}</QtyPill> : <span className="num text-ink-soft">0</span>}
                </td>
                <td className="num px-3 py-2.5 text-right text-ink">฿ {fmtMoney(b.value)}</td> {/* i18n-key */}
                <td className="px-3 py-2.5">
                  {/* A dot and a word, as the mock-up draws it — a pill would not fit beside four columns. */}
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${b.low > 0 ? 'text-warn' : 'text-in'}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${b.low > 0 ? 'bg-warn' : 'bg-in'}`} />
                    {b.low > 0 ? t('มีสินค้าใกล้หมด') : t('ปกติ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

// ---- recent activity -------------------------------------------------------------------

interface Activity {
  key: string
  at: number
  icon: IconName
  tone: Tone
  title: string
  sub: string
  to: string
}

const ACTIVITY_LOOK: Record<ActivityKind, { icon: IconName; tone: Tone; label: string }> = {
  in: { icon: 'receive', tone: 'green', label: 'รับสินค้าเข้า' }, // i18n-key
  out: { icon: 'truck', tone: 'red', label: 'เบิกใช้' }, // i18n-key
  transfer: { icon: 'swap', tone: 'purple', label: 'โอนสินค้าระหว่างสาขา' }, // i18n-key
  adjust: { icon: 'adjust', tone: 'amber', label: 'ปรับสต๊อก' }, // i18n-key
}

export function RecentActivityCard({
  movements,
  requests,
  orders,
}: {
  movements: StockMovement[]
  requests: PurchaseRequest[]
  orders: PurchaseOrder[]
}) {
  const t = useT()
  const { locationById } = useData()
  const items = useMemo<Activity[]>(() => {
    const docs = new Map<string, { m: StockMovement; lines: number }>()
    for (const m of movements) {
      if (m.voided) continue
      const d = docs.get(m.docNo)
      if (d) d.lines++
      else docs.set(m.docNo, { m, lines: 1 })
    }
    const fromLedger = [...docs.values()].map(({ m, lines }) => {
      const kind = activityKind(m)
      const look = ACTIVITY_LOOK[kind]
      const from = m.fromLocationId ? locationById(m.fromLocationId)?.name : undefined
      const to = m.toLocationId ? locationById(m.toLocationId)?.name : undefined
      const where = kind === 'transfer' ? `${from ?? ''} → ${to ?? ''}` : (to ?? from ?? '')
      return {
        key: `m-${m.docNo}`,
        at: m.createdAt,
        icon: look.icon,
        tone: look.tone,
        title: t(look.label),
        sub: [m.docNo, where, t('{n} รายการ', { n: lines })].filter(Boolean).join(' • '),
        to: '/movements',
      }
    })
    const fromRequests = requests
      .filter((r) => r.status !== 'draft')
      .map((r) => ({
        key: `r-${r.id}`,
        at: r.submittedAt ?? r.createdAt,
        icon: 'note' as IconName,
        tone: 'blue' as Tone,
        title: t('ส่งรายการขอสั่งซื้อ'),
        sub: [r.docNo, locationById(r.locationId)?.name, t('{n} รายการ', { n: r.items.filter((i) => !i.removed).length })].filter(Boolean).join(' • '),
        to: `/requests/${r.id}`,
      }))
    const fromOrders = orders
      .filter((o) => o.status !== 'draft')
      .map((o) => ({
        key: `o-${o.id}`,
        at: o.orderedAt,
        icon: 'cart' as IconName,
        tone: 'brand' as Tone,
        title: t('สร้างใบสั่งซื้อ'),
        sub: [o.docNo, o.supplierName, t('{n} รายการ', { n: o.lines.length })].join(' • '),
        to: `/orders?po=${encodeURIComponent(o.id)}`,
      }))
    return [...fromLedger, ...fromRequests, ...fromOrders].sort((a, b) => b.at - a.at).slice(0, 6)
  }, [movements, requests, orders, locationById, t])

  const today = bkkDayStart(Date.now())
  return (
    <SectionCard icon="clock" title={t('กิจกรรมล่าสุด')} actions={<SeeAll to="/movements" />}>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">{t('ยังไม่มีรายการ')}</p>
      ) : (
        <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-line">
          {items.map((a) => (
            <li key={a.key} className="relative pl-5">
              <span className={`absolute left-0 top-4 h-[11px] w-[11px] rounded-full ring-2 ring-surface ${toneIcon[a.tone].split(' ')[0]}`} />
              <Link to={a.to} className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-sunken">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneIcon[a.tone]}`}>
                  <Icon name={a.icon} size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{a.title}</span>
                  <span className="block truncate text-xs text-ink-faint">{a.sub}</span>
                </span>
                <span className="num shrink-0 text-xs text-ink-faint">
                  {bkkDayStart(a.at) === today ? bkkTimeOf(a.at) : formatThaiDateShort(a.at)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}

// ---- quick menu ------------------------------------------------------------------------

const QUICK: { to: string; label: string; icon: IconName; tone: Tone; manager?: boolean; admin?: boolean }[] = [
  { to: '/receive', label: 'รับสินค้าเข้า', icon: 'receive', tone: 'green' }, // i18n-key
  { to: '/orders?new=1', label: 'สั่งซื้อใหม่', icon: 'cart', tone: 'red', manager: true }, // i18n-key
  { to: '/requests/new', label: 'ขอสั่งซื้อ', icon: 'note', tone: 'red' }, // i18n-key
  { to: '/issue', label: 'โอนสาขา', icon: 'swap', tone: 'blue' }, // i18n-key
  { to: '/adjust', label: 'ปรับสต๊อก', icon: 'adjust', tone: 'purple' }, // i18n-key
  { to: '/reports', label: 'รายงาน', icon: 'report', tone: 'slate' }, // i18n-key
  { to: '/import', label: 'นำเข้า Excel', icon: 'upload', tone: 'green', admin: true }, // i18n-key
]

export function QuickMenuCard() {
  const t = useT()
  const { user } = useAuth()
  const role = user?.role
  const manager = role === 'admin' || role === 'manager'
  // A manager orders directly, so "request" gives way to "order"; staff get the request.
  const items = QUICK.filter((q) => (q.admin ? role === 'admin' : q.manager ? manager : q.to !== '/requests/new' || !manager)).slice(0, 6)
  return (
    <SectionCard icon="zap" title={t('เมนูด่วน')}>
      <div className="grid grid-cols-3 gap-2.5">
        {items.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-center text-xs font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand/40 ${toneIcon[q.tone]}`}
          >
            <Icon name={q.icon} size={22} />
            <span className="leading-tight">{t(q.label)}</span>
          </Link>
        ))}
      </div>
    </SectionCard>
  )
}
