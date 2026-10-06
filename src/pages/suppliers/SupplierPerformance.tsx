import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FramePage, PageHero, SectionCard, StatRow, StatTile, frameCard } from '../../components/frame'
import { Icon } from '../../components/Icon'
import { RiskBadge } from '../../components/risk/RiskParts'
import { Badge, Input, SegTab, Spinner } from '../../components/ui'
import { orderCache } from '../../data/orderCache'
import { useSupplierIntel } from '../../data/useSupplierIntel'
import { useT } from '../../i18n/I18nContext'
import { useAuth } from '../../auth/AuthContext'
import { datasetRows, MODEL_READY, readiness, toCsv } from '../../lib/deliveryDataset'
import type { DeliveryOutcome } from '../../lib/deliveryMetrics'
import { LEVEL_RANK, type RiskLevel } from '../../lib/deliveryRisk'
import { formatThaiDate } from '../../lib/format'
import { bkkDayEnd, DAY_MS } from '../../lib/inventoryRules/time'
import { CONFIDENCE_LABEL, SCORE_COMPONENT_LABEL } from '../../lib/riskCopy'
import {
  performanceBySupplier,
  supplierStats,
  WINDOW_DAYS,
  type PerformanceWindow,
  type SupplierStats,
} from '../../lib/supplierPerformance'
import { SUPPLIER_SCORE_CONFIG, supplierScore, type SupplierScore } from '../../lib/supplierScore'
import type { PurchaseOrder } from '../../types'

/**
 * Purchasing → Supplier Performance (S2, 5 Oct 2026). Numbers come from the pure modules
 * (deliveryMetrics → supplierPerformance → supplierScore); this page only fetches orders for
 * the window — through the session's order cache, so moving between windows inside one
 * that was already read costs nothing — and lays them out.
 */

const WINDOWS: { key: PerformanceWindow; label: string }[] = [
  { key: '30d', label: '30 วัน' }, // i18n-key
  { key: '90d', label: '90 วัน' }, // i18n-key
  { key: '6m', label: '6 เดือน' }, // i18n-key
  { key: '12m', label: '12 เดือน' }, // i18n-key
  { key: 'all', label: 'ทั้งหมด' }, // i18n-key
]

type SortKey = 'score' | 'onTime' | 'delay' | 'fill' | 'acceptance' | 'response' | 'name'

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)
const days = (d: number | null) => (d === null ? '—' : `${Math.round(d * 10) / 10}`)
function minutes(m: number | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (m === null) return '—'
  if (m < 60) return t('{n} นาที', { n: Math.round(m) })
  if (m < 48 * 60) return t('{n} ชม.', { n: Math.round(m / 6) / 10 })
  return t('{n} วัน', { n: Math.round(m / 144) / 10 })
}

const GRADE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'slate'> = { 'A+': 'green', A: 'green', B: 'blue', C: 'amber', D: 'red', F: 'red' }

function useWindowOrders(window: PerformanceWindow) {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null)
  useEffect(() => {
    let alive = true
    const now = Date.now()
    const d = WINDOW_DAYS[window]
    const from = d === null ? 0 : now - d * DAY_MS
    setOrders(null)
    orderCache
      .fetchRange(from, bkkDayEnd(now))
      .then((rows) => alive && setOrders(rows))
      .catch(() => alive && setOrders([]))
    return () => {
      alive = false
    }
  }, [window])
  return orders
}

export function SupplierPerformancePage() {
  const t = useT()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [window, setWindow] = useState<PerformanceWindow>('90d')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true })
  const [q, setQ] = useState('')
  const orders = useWindowOrders(window)
  const { risks } = useSupplierIntel()
  const selected = params.get('supplier')
  const now = useMemo(() => Date.now(), [orders])

  const rows = useMemo(() => {
    if (!orders) return []
    return performanceBySupplier(orders, window, now).map((s) => ({ stats: s, score: supplierScore(s) }))
  }, [orders, window, now])

  const worstRisk = useMemo(() => {
    const m = new Map<string, RiskLevel>()
    for (const r of risks.values()) {
      const cur = m.get(r.supplierId)
      if (!cur || LEVEL_RANK[r.level] > LEVEL_RANK[cur]) m.set(r.supplierId, r.level)
    }
    return m
  }, [risks])

  const summary = useMemo(() => {
    const delivered = rows.flatMap((r) => r.stats.outcomes.filter((o) => o.completed && o.deliveryStatus !== 'cancelled'))
    const all = supplierStats('all', 'all', delivered, now)
    return {
      suppliers: rows.length,
      completed: rows.reduce((s, r) => s + r.stats.completed, 0),
      onTime: all.onTime,
      avgDelay: all.delay.avg,
      atRisk: [...risks.values()].filter((r) => LEVEL_RANK[r.level] >= LEVEL_RANK.HIGH).length,
    }
  }, [rows, risks, now])

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]): number | string | null => {
      switch (sort.key) {
        case 'score':
          return r.score.score
        case 'onTime':
          return r.stats.onTime.rate
        case 'delay':
          return r.stats.delay.avg
        case 'fill':
          return r.stats.fill.rate
        case 'acceptance':
          return r.stats.requestedAcceptance.rate
        case 'response':
          return r.stats.response.avgMinutes
        case 'name':
          return r.stats.supplierName
      }
    }
    const needle = q.trim().toLowerCase()
    return rows
      .filter((r) => !needle || r.stats.supplierName.toLowerCase().includes(needle))
      .sort((a, b) => {
        // Too little data never outranks enough data, whatever its numbers.
        const ia = a.stats.confidence === 'insufficient' ? 1 : 0
        const ib = b.stats.confidence === 'insufficient' ? 1 : 0
        if (ia !== ib && sort.key === 'score') return ia - ib
        const va = val(a)
        const vb = val(b)
        if (va === null && vb === null) return 0
        if (va === null) return 1
        if (vb === null) return -1
        const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
        return sort.desc ? -c : c
      })
  }, [rows, sort, q])

  const detail = selected ? rows.find((r) => r.stats.supplierId === selected) : undefined

  const head = (key: SortKey, label: string, align = 'text-right') => (
    <th className={`px-3 py-2.5 font-semibold ${align}`}>
      <button
        className="inline-flex items-center gap-0.5 hover:text-ink"
        onClick={() => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: key !== 'name' && key !== 'delay' && key !== 'response' })}
      >
        {t(label)}
        {sort.key === key && <Icon name={sort.desc ? 'arrowDown' : 'arrowUp'} size={12} />}
      </button>
    </th>
  )

  return (
    <FramePage>
      <PageHero
        icon="chart"
        title={t('ผลงานผู้ขาย')}
        subtitle={t('วัดจากวันส่งที่ผู้ขายยืนยัน · คะแนนจากกฎที่อธิบายได้')}
        actions={user?.role === 'admin' && orders ? <DatasetButton orders={orders} /> : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-sunken p-1">
          {WINDOWS.map((w) => (
            <SegTab key={w.key} grow={false} label={t(w.label)} active={window === w.key} onClick={() => setWindow(w.key)} />
          ))}
        </div>
        <Input className="max-w-xs" placeholder={t('ค้นหาผู้ขาย')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!orders ? (
        <Spinner label={t('กำลังโหลด...')} />
      ) : (
        <>
          <StatRow columns={5}>
            <StatTile icon="users" label={t('ผู้ขาย')} value={summary.suppliers} />
            <StatTile icon="checkCircle" label={t('ใบสั่งซื้อที่จบแล้ว')} value={summary.completed} tone="green" />
            <StatTile icon="clock" label={t('ส่งตรงเวลารวม')} value={pct(summary.onTime.rate)} hint={t('{hits} จาก {n}', { hits: summary.onTime.hits, n: summary.onTime.n })} />
            <StatTile icon="history" label={t('ช้าเฉลี่ย (เฉพาะที่ช้า)')} value={days(summary.avgDelay)} unit={t('วัน')} tone="amber" />
            <StatTile icon="warning" label={t('ใบที่เสี่ยงสูง')} value={summary.atRisk} tone="red" />
          </StatRow>

          {detail && <SupplierDetail stats={detail.stats} score={detail.score} onClose={() => setParams({}, { replace: true })} />}

          <section className={frameCard}>
            {/* A phone gets a card per supplier (plan D5'); the ten-column table needs 920px. */}
            <ul className="divide-y divide-line md:hidden">
              {sorted.map(({ stats: s, score }) => (
                <li key={s.supplierId}>
                  <button
                    type="button"
                    onClick={() => setParams({ supplier: s.supplierId })}
                    className={`w-full space-y-1.5 px-4 py-3 text-left row-hover ${selected === s.supplierId ? 'bg-brand-soft' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.supplierName}</span>
                      {worstRisk.get(s.supplierId) && <RiskBadge level={worstRisk.get(s.supplierId)!} />}
                      {score.grade && <Badge color={GRADE_TONE[score.grade]}>{score.grade}</Badge>}
                      <span className="num w-9 text-right text-lg font-bold text-ink">{score.score === null ? '—' : Math.round(score.score)}</span>
                    </span>
                    <span className="grid grid-cols-3 gap-x-2 text-xs text-ink-soft">
                      <span>
                        {t('ตรงเวลา')} <b className="num text-ink">{pct(s.onTime.rate)}</b>
                      </span>
                      <span>
                        {t('ส่งครบ')} <b className="num text-ink">{pct(s.fill.rate)}</b>
                      </span>
                      <span>
                        {t('ช้าเฉลี่ย (วัน)')} <b className="num text-ink">{days(s.delay.avg)}</b>
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-ink-faint">
                      {t(CONFIDENCE_LABEL[s.confidence])}
                      <Trend dir={s.trend.direction} />
                    </span>
                  </button>
                </li>
              ))}
              {!sorted.length && <li className="px-4 py-8 text-center text-sm text-ink-faint">{t('ยังไม่มีใบสั่งซื้อในช่วงนี้')}</li>}
            </ul>
            <div className="hidden overflow-x-auto px-2 pb-3 pt-2 md:block md:px-4">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-sunken text-[13px] text-ink-soft">
                  <tr>
                    {head('name', 'ผู้ขาย', 'text-left') /* i18n-key */}
                    {head('score', 'คะแนน') /* i18n-key */}
                    <th className="px-3 py-2.5 text-center font-semibold">{t('เกรด')}</th>
                    <th className="px-3 py-2.5 text-left font-semibold">{t('ความเชื่อมั่น')}</th>
                    {head('onTime', 'ตรงเวลา') /* i18n-key */}
                    {head('delay', 'ช้าเฉลี่ย (วัน)') /* i18n-key */}
                    {head('fill', 'ส่งครบ') /* i18n-key */}
                    {head('acceptance', 'รับวันที่ขอ') /* i18n-key */}
                    {head('response', 'ตอบเฉลี่ย') /* i18n-key */}
                    <th className="px-3 py-2.5 text-left font-semibold">{t('ความเสี่ยง / แนวโน้ม')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sorted.map(({ stats: s, score }) => (
                    <tr key={s.supplierId} className={`row-hover cursor-pointer ${selected === s.supplierId ? 'bg-brand-soft' : ''}`} onClick={() => setParams({ supplier: s.supplierId })}>
                      <td className="px-3 py-2.5 font-medium text-ink">{s.supplierName}</td>
                      <td className="num px-3 py-2.5 text-right font-semibold">{score.score === null ? '—' : Math.round(score.score)}</td>
                      <td className="px-3 py-2.5 text-center">{score.grade ? <Badge color={GRADE_TONE[score.grade]}>{score.grade}</Badge> : '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-soft">{t(CONFIDENCE_LABEL[s.confidence])}</td>
                      <td className="num px-3 py-2.5 text-right">{pct(s.onTime.rate)}</td>
                      <td className="num px-3 py-2.5 text-right">{days(s.delay.avg)}</td>
                      <td className="num px-3 py-2.5 text-right">{pct(s.fill.rate)}</td>
                      <td className="num px-3 py-2.5 text-right">{pct(s.requestedAcceptance.rate)}</td>
                      <td className="num px-3 py-2.5 text-right">{minutes(s.response.avgMinutes, t)}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {worstRisk.get(s.supplierId) && <RiskBadge level={worstRisk.get(s.supplierId)!} />}
                          <Trend dir={s.trend.direction} />
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!sorted.length && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-ink-faint">
                        {t('ยังไม่มีใบสั่งซื้อในช่วงนี้')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </FramePage>
  )
}

function Trend({ dir }: { dir: SupplierStats['trend']['direction'] }) {
  const t = useT()
  if (!dir) return null
  if (dir === 'flat') return <span className="text-xs text-ink-faint">{t('คงที่')}</span>
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${dir === 'up' ? 'text-in' : 'text-out'}`}>
      <Icon name={dir === 'up' ? 'trendUp' : 'trendDown'} size={14} />
      {dir === 'up' ? t('ดีขึ้น') : t('แย่ลง')}
    </span>
  )
}

function SupplierDetail({ stats: s, score, onClose }: { stats: SupplierStats; score: SupplierScore; onClose: () => void }) {
  const t = useT()
  const delayed = s.items.filter((i) => i.late > 0).sort((a, b) => (b.lateRate ?? 0) - (a.lateRate ?? 0)).slice(0, 5)
  const reliable = s.items
    .filter((i) => i.deliveries >= 2 && i.late === 0)
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, 5)
  const monthly = monthlyOnTime(s.outcomes)
  return (
    <SectionCard
      icon="users"
      title={s.supplierName}
      count={t(CONFIDENCE_LABEL[s.confidence])}
      actions={
        <span className="flex items-center gap-2">
          <Link to={`/suppliers?id=${encodeURIComponent(s.supplierId)}`} className="text-sm font-medium text-brand hover:underline">
            {t('ข้อมูลผู้ขาย')}
          </Link>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-faint hover:bg-sunken" aria-label={t('ปิด')} onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </span>
      }
    >
      <div className="grid gap-4 px-4 pb-4 md:px-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-sunken p-3">
          <p className="text-xs text-ink-soft">{t('คะแนนผู้ขาย')}</p>
          <p className="num text-4xl font-bold text-ink">
            {score.score === null ? '—' : Math.round(score.score)}
            <span className="text-base font-normal text-ink-faint">/100</span>
          </p>
          <p className="mt-1">{score.grade ? <Badge color={GRADE_TONE[score.grade]}>{t('เกรด {g}', { g: score.grade })}</Badge> : <span className="text-xs text-ink-faint">{t('ข้อมูลยังไม่พอให้เกรด (ต้องมี {n} ใบขึ้นไป)', { n: SUPPLIER_SCORE_CONFIG.confidence.low })}</span>}</p>
          <table className="mt-3 w-full text-xs">
            <tbody>
              {score.components.map((c) => (
                <tr key={c.key} className="border-t border-line">
                  <td className="py-1 text-ink-soft">{t(SCORE_COMPONENT_LABEL[c.key])}</td>
                  <td className="num py-1 text-right">{c.value === null ? '—' : Math.round(c.value)}</td>
                  <td className="num py-1 text-right text-ink-faint">×{Math.round(c.effectiveWeight)}%</td>
                  <td className="num py-1 text-right font-semibold">{c.value === null ? '—' : Math.round(c.points * 10) / 10}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {score.components.some((c) => c.value === null) && <p className="mt-1 text-[11px] text-ink-faint">{t('ส่วนที่ไม่มีข้อมูลถูกตัดออก แล้วปรับน้ำหนักที่เหลือให้รวมเป็น 100')}</p>}
        </div>

        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Metric label={t('ส่งตรงเวลา')} value={pct(s.onTime.rate)} sub={t('{hits} จาก {n}', { hits: s.onTime.hits, n: s.onTime.n })} />
            <Metric label={t('ส่งครบจำนวน')} value={pct(s.fill.rate)} />
            <Metric label={t('ช้าเฉลี่ย / มัธยฐาน')} value={`${days(s.delay.avg)} / ${days(s.delay.median)}`} sub={t('วัน · เฉพาะ {n} ครั้งที่ช้า', { n: s.delay.lateCount })} />
            <Metric label={t('P90 / สูงสุด')} value={`${days(s.delay.p90)} / ${days(s.delay.max)}`} sub={t('วัน')} />
            <Metric label={t('รับวันที่ขอ')} value={pct(s.requestedAcceptance.rate)} sub={t('{hits} จาก {n}', { hits: s.requestedAcceptance.hits, n: s.requestedAcceptance.n })} />
            <Metric label={t('ตอบเฉลี่ย')} value={minutes(s.response.avgMinutes, t)} sub={s.response.unanswered ? t('ยังไม่ตอบ {n} ใบ', { n: s.response.unanswered }) : undefined} />
            <Metric label={t('ยกเลิก')} value={pct(s.cancellation.rate)} sub={t('{hits} จาก {n}', { hits: s.cancellation.hits, n: s.cancellation.n })} />
            <Metric label={t('ค้างส่ง')} value={String(s.open)} />
          </dl>

          {monthly.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-soft">{t('ส่งตรงเวลารายเดือน')}</p>
              <div className="flex items-end gap-2">
                {monthly.map((m) => (
                  <div key={m.label} className="flex w-12 flex-col items-center gap-1">
                    <div className="flex h-16 w-6 items-end rounded bg-sunken">
                      <div className="w-full rounded bg-in" style={{ height: `${Math.round((m.rate ?? 0) * 100)}%` }} />
                    </div>
                    <span className="num text-[11px] text-ink-soft">{pct(m.rate)}</span>
                    <span className="text-[10px] text-ink-faint">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <ItemList title={t('สินค้าที่ส่งช้าบ่อย')} items={delayed.map((i) => ({ id: i.productId, name: i.productName, note: t('ช้า {late}/{n} ครั้ง · เฉลี่ย {avg} วัน', { late: i.late, n: i.deliveries, avg: days(i.avgDelayWhenLate) }) }))} />
            <ItemList title={t('สินค้าที่ส่งตรงเสมอ')} items={reliable.map((i) => ({ id: i.productId, name: i.productName, note: t('ตรงเวลา {n}/{n} ครั้ง', { n: i.deliveries }) }))} />
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-ink-soft">{t('ประวัติการส่งล่าสุด')}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-left text-ink-soft">
                  <tr>
                    <th className="py-1 pr-2 font-semibold">PO</th>
                    <th className="py-1 pr-2 font-semibold">{t('ขอส่ง')}</th>
                    <th className="py-1 pr-2 font-semibold">{t('ยืนยัน')}</th>
                    <th className="py-1 pr-2 font-semibold">{t('ส่งจริง')}</th>
                    <th className="py-1 pr-2 font-semibold">{t('ผล')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.outcomes.slice(0, 12).map((o) => (
                    <tr key={o.poId}>
                      <td className="py-1 pr-2">
                        <Link className="doc-no text-brand hover:underline" to={`/orders?po=${encodeURIComponent(o.poId)}`}>
                          {o.docNo}
                        </Link>
                      </td>
                      <td className="num py-1 pr-2">{o.requestedDeliveryDate !== null ? formatThaiDate(o.requestedDeliveryDate) : '—'}</td>
                      <td className="num py-1 pr-2">
                        {o.confirmedDeliveryDate !== null ? formatThaiDate(o.confirmedDeliveryDate) : '—'}
                        {o.requestedAccepted === false && <span className="ml-1 text-warn">*</span>}
                      </td>
                      <td className="num py-1 pr-2">
                        {o.actualFullyReceivedAt !== null ? formatThaiDate(o.actualFullyReceivedAt) : o.actualFirstReceivedAt !== null ? `${formatThaiDate(o.actualFirstReceivedAt)} (${t('บางส่วน')})` : '—'}
                      </td>
                      <td className="py-1 pr-2">
                        <Outcome o={o} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-ink-faint">{t('* วันยืนยันต่างจากวันที่ขอ — ตรงเวลาวัดจากวันยืนยัน')}</p>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="num text-lg font-semibold text-ink">{value}</dd>
      {sub && <dd className="text-[11px] text-ink-faint">{sub}</dd>}
    </div>
  )
}

function ItemList({ title, items }: { title: string; items: { id: string; name: string; note: string }[] }) {
  const t = useT()
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-1 text-xs font-semibold text-ink-soft">{title}</p>
      {!items.length ? (
        <p className="text-xs text-ink-faint">{t('ยังไม่มีข้อมูลพอ')}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {items.map((i) => (
            <li key={i.id}>
              <span className="text-ink">{i.name}</span> <span className="text-ink-faint">· {i.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const OUTCOME_UI: Record<DeliveryOutcome['deliveryStatus'], { label: string; color: 'green' | 'blue' | 'amber' | 'red' | 'slate' }> = {
  early: { label: 'ก่อนกำหนด', color: 'green' }, // i18n-key
  on_time: { label: 'ตรงเวลา', color: 'green' }, // i18n-key
  late: { label: 'ช้า', color: 'red' }, // i18n-key
  partial: { label: 'ส่งไม่ครบ', color: 'amber' }, // i18n-key
  cancelled: { label: 'ยกเลิก', color: 'slate' }, // i18n-key
  open: { label: 'ค้างส่ง', color: 'blue' }, // i18n-key
  undated: { label: 'ไม่มีวันกำหนด', color: 'slate' }, // i18n-key
}

function Outcome({ o }: { o: DeliveryOutcome }) {
  const t = useT()
  const ui = OUTCOME_UI[o.deliveryStatus]
  return (
    <span className="inline-flex items-center gap-1">
      <Badge color={ui.color}>{t(ui.label)}</Badge>
      {o.delayDays !== null && o.delayDays > 0 && <span className="num text-out">+{o.delayDays}</span>}
      {o.deliveries > 1 && <span className="text-ink-faint">{t('{n} รอบ', { n: o.deliveries })}</span>}
    </span>
  )
}

/** On-time rate by the month the delivery finished, last six months with data. */
function monthlyOnTime(outcomes: readonly DeliveryOutcome[]) {
  const m = new Map<string, { hits: number; n: number }>()
  for (const o of outcomes) {
    if (!o.completed || o.deliveryStatus === 'cancelled' || o.deliveryStatus === 'undated') continue
    const at = o.actualFullyReceivedAt ?? o.lastReceivedAt
    if (at === null) continue
    const d = new Date(at + 7 * 3_600_000)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const e = m.get(key) ?? { hits: 0, n: 0 }
    e.n++
    if (o.deliveryStatus === 'early' || o.deliveryStatus === 'on_time') e.hits++
    m.set(key, e)
  }
  return [...m]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([k, v]) => ({ label: `${Number(k.slice(5))}/${k.slice(2, 4)}`, rate: v.n ? v.hits / v.n : null }))
}

/**
 * Model readiness (S5): the versioned feature dataset of the window as a CSV, and whether
 * there is enough of it yet. Nothing is trained in the app.
 */
function DatasetButton({ orders }: { orders: PurchaseOrder[] }) {
  const t = useT()
  const rows = useMemo(() => datasetRows(orders), [orders])
  const r = readiness(rows)
  function download() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `delivery-dataset-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      <button className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-medium text-ink hover:bg-sunken" onClick={download} disabled={!rows.length}>
        <Icon name="download" size={16} />
        {t('ชุดข้อมูลสำหรับโมเดล (CSV)')}
      </button>
      <span className="text-[11px] text-ink-faint">
        {r.ready
          ? t('{n} แถว ({late} ช้า) — พอเริ่มทดลองโมเดลได้', { n: r.rows, late: r.late })
          : t('{n} แถว ({late} ช้า) — ยังไม่พอ (ต้องการ {min} / {minLate})', { n: r.rows, late: r.late, min: MODEL_READY.minRows, minLate: MODEL_READY.minLate })}
      </span>
    </span>
  )
}
