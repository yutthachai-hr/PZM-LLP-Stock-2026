import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSupplierIntel } from '../../data/useSupplierIntel'
import { useT } from '../../i18n/I18nContext'
import { LEVEL_RANK, type DeliveryRisk, type RiskLevel } from '../../lib/deliveryRisk'
import { formatThaiDate } from '../../lib/format'
import type { ShortageRisk } from '../../lib/inventoryRisk'
import { RISK_LEVEL_LABEL } from '../../lib/riskCopy'
import { useSuppliers } from '../../services/suppliers'
import { Icon } from '../Icon'
import { RiskBadge, RiskReasons, ShortageSummary } from '../risk/RiskParts'
import { SectionCard } from '../frame'

/**
 * The dashboard's Delivery Risk section (S3/S4, 5 Oct 2026): open orders by risk level,
 * each with the products it leaves short and what to do. Recommendations only — every
 * button opens a screen where a person decides; nothing here moves stock or orders.
 */

const LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const COUNT_TONE: Record<RiskLevel, string> = {
  CRITICAL: 'bg-out text-white',
  HIGH: 'bg-out-soft text-out',
  MEDIUM: 'bg-warn-soft text-warn',
  LOW: 'bg-sunken text-ink-soft',
}

const btn = 'inline-flex min-h-9 items-center gap-1 rounded-md border border-line-strong px-2.5 text-xs font-medium text-ink hover:bg-sunken'

const OPEN_KEY = 'pmstock:v1:dash-risk-open'

function rememberedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export function DeliveryRiskPanel() {
  const t = useT()
  const { ready, failed, retry, risks, shortages } = useSupplierIntel()
  const suppliers = useSuppliers()
  const [open, setOpen] = useState<string | null>(null)
  // Folded by default (owner, 6 Oct 2026): the counts say enough at a glance; the list opens
  // on demand — the toggle, or a level chip, which also picks that level.
  const [expanded, setExpanded] = useState(rememberedOpen)
  const [level, setLevel] = useState<RiskLevel | 'ALL'>('ALL')

  function toggle(next: boolean) {
    setExpanded(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const counts = useMemo(() => {
    const c: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    for (const r of risks.values()) c[r.level]++
    return c
  }, [risks])

  const shortByPo = useMemo(() => {
    const byPo = new Map<string, ShortageRisk[]>()
    for (const s of shortages) {
      const po = s.nextIncoming?.poId ?? s.incoming[0]?.poId
      if (po) byPo.set(po, [...(byPo.get(po) ?? []), s])
    }
    return byPo
  }, [shortages])

  // "All" lists what needs attention (MEDIUM and up, or leaving a product short); a level
  // chip lists exactly that level — LOW included.
  const cards = useMemo(
    () =>
      [...risks.values()]
        .filter((r) => (level === 'ALL' ? LEVEL_RANK[r.level] >= LEVEL_RANK.MEDIUM || shortByPo.has(r.poId) : r.level === level))
        .map((r) => ({ risk: r, shortages: shortByPo.get(r.poId) ?? [] }))
        .sort((a, b) => b.risk.score - a.risk.score),
    [risks, shortByPo, level],
  )
  const [limit, setLimit] = useState(8)
  const shown = cards.slice(0, limit)
  const noOrder = level === 'ALL' ? shortages.filter((s) => !s.incoming.length).slice(0, 5) : []

  return (
    <SectionCard
      icon="truck"
      tone="red"
      title={t('ความเสี่ยงการส่งของ')}
      count={t('(คะแนนจากกฎ ไม่ใช่ความน่าจะเป็น)')}
      flush
      actions={
        <button
          type="button"
          onClick={() => toggle(!expanded)}
          aria-expanded={expanded}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand hover:bg-sunken"
        >
          {expanded ? t('ซ่อนรายการ') : t('แสดงรายการ')}
          <Icon name="chevronDown" size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      }
    >
      {/* Plan C1: a read that failed is no verdict — never counts of zero. */}
      {failed && (
        <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger md:mx-5">
          <span className="min-w-0 flex-1">{t('อ่านใบสั่งซื้อ/ใบโอนไม่สำเร็จ — ยังประเมินความเสี่ยงไม่ได้')}</span>
          <button type="button" onClick={retry} className="min-h-9 rounded-lg px-2 font-semibold underline">
            {t('ลองใหม่')}
          </button>
        </div>
      )}
      {!failed && (
      <div className="flex flex-wrap gap-2 px-4 pb-3 md:px-5" role="group" aria-label={t('เลือกระดับความเสี่ยง')}>
        <button
          type="button"
          onClick={() => {
            setLevel('ALL')
            setLimit(8)
            toggle(true)
          }}
          aria-pressed={expanded && level === 'ALL'}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
            expanded && level === 'ALL' ? 'bg-ink text-white' : 'bg-sunken text-ink-soft hover:text-ink'
          }`}
        >
          {t('ที่ต้องดู')} <span className="num">{counts.CRITICAL + counts.HIGH + counts.MEDIUM}</span>
        </button>
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => {
              setLevel(l)
              setLimit(8)
              toggle(true)
            }}
            aria-pressed={expanded && level === l}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-offset-1 ${COUNT_TONE[l]} ${
              expanded && level === l ? 'ring-2 ring-ink/60' : 'hover:brightness-95'
            }`}
          >
            {t(RISK_LEVEL_LABEL[l])} <span className="num">{counts[l]}</span>
          </button>
        ))}
      </div>
      )}
      {expanded && !failed &&
        (!ready ? (
          <p className="px-5 pb-5 text-sm text-ink-faint">{t('กำลังคำนวณ...')}</p>
        ) : !shown.length && !noOrder.length ? (
          <p className="px-5 pb-6 pt-1 text-center text-sm text-ink-faint">
            {level === 'ALL' ? t('ไม่มีใบสั่งซื้อที่เสี่ยงส่งช้า') : t('ไม่มีใบสั่งซื้อในระดับนี้')}
          </p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {shown.map(({ risk, shortages: short }) => (
              <RiskCard
                key={risk.poId}
                risk={risk}
                short={short}
                phone={suppliers.find((s) => s.id === risk.supplierId)?.contactNumber}
                expanded={open === risk.poId}
                onToggle={() => setOpen(open === risk.poId ? null : risk.poId)}
              />
            ))}
            {cards.length > shown.length && (
              <li className="px-4 py-2 text-center md:px-5">
                <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => setLimit(limit + 20)}>
                  {t('ดูเพิ่มอีก {n} ใบ', { n: cards.length - shown.length })}
                </button>
              </li>
            )}
            {noOrder.map((s) => (
              <li key={s.key} className="px-4 py-3 md:px-5">
                <div className="flex items-start justify-between gap-2">
                  <ShortageSummary s={s} />
                  <RiskBadge level={s.level} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Link className={btn} to="/requests/new">
                    {t('สร้างใบขอสั่งซื้อด่วน')}
                  </Link>
                  {s.transfer && (
                    <Link className={btn} to="/transfers/new">
                      {t('โอน {qty} {unit} จาก{from}', { qty: s.transfer.qty, unit: s.unit, from: s.transfer.fromLocationName })}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </SectionCard>
  )
}

function RiskCard({
  risk,
  short,
  phone,
  expanded,
  onToggle,
}: {
  risk: DeliveryRisk
  short: ShortageRisk[]
  phone?: string
  expanded: boolean
  onToggle: () => void
}) {
  const t = useT()
  const transfers = short.filter((s) => s.transfer)
  return (
    <li className="px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {risk.supplierName} <span className="doc-no text-xs font-normal text-ink-faint">{risk.docNo}</span>
          </p>
          <p className="text-xs text-ink-soft">
            {risk.dueDate !== null ? t('ส่ง {date}', { date: formatThaiDate(risk.dueDate) }) : t('ไม่มีวันส่ง')}
          </p>
        </div>
        <RiskBadge level={risk.level} score={risk.score} />
      </div>
      <div className="mt-1.5">
        <RiskReasons risk={risk} limit={expanded ? undefined : 2} />
      </div>
      {short.map((s) => (
        <div key={s.key} className="mt-2 rounded-md bg-out-soft/60 px-2.5 py-1.5">
          <ShortageSummary s={s} />
        </div>
      ))}
      {expanded && transfers.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-md border border-line bg-sunken px-2.5 py-2 text-xs">
          {transfers.map((s) => (
            <li key={s.key}>
              {t('โอน {qty} {unit} {product} จาก{from} → {to}', {
                qty: s.transfer!.qty,
                unit: s.unit,
                product: s.productName,
                from: s.transfer!.fromLocationName,
                to: s.locationName,
              })}
              <span className="text-ink-faint"> · {t('ต้นทางเหลือ {after} (เก็บไว้ {keep})', { after: Math.floor(s.transfer!.sourceAfter), keep: Math.ceil(s.transfer!.sourceKeeps) })}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Link className={btn} to={`/orders?po=${encodeURIComponent(risk.poId)}`}>
          {t('ดูใบสั่งซื้อ')}
        </Link>
        <Link className={btn} to={`/suppliers?id=${encodeURIComponent(risk.supplierId)}`}>
          {t('ดูผู้ขาย')}
        </Link>
        {phone && (
          <a className={btn} href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
            <Icon name="message" size={12} />
            {t('ติดต่อผู้ขาย')}
          </a>
        )}
        {transfers.length > 0 && (
          <button className={btn} onClick={onToggle}>
            {expanded ? t('ซ่อนตัวเลือกโอน') : t('ตัวเลือกโอนของ')}
          </button>
        )}
        {!transfers.length && risk.reasons.length > 2 && (
          <button className={btn} onClick={onToggle}>
            {expanded ? t('ย่อ') : t('ดูเหตุผลทั้งหมด')}
          </button>
        )}
      </div>
    </li>
  )
}
