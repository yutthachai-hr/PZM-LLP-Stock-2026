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

export function DeliveryRiskPanel() {
  const t = useT()
  const { ready, risks, shortages } = useSupplierIntel()
  const suppliers = useSuppliers()
  const [open, setOpen] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    for (const r of risks.values()) c[r.level]++
    return c
  }, [risks])

  // An order is on the list when it is at least MEDIUM, or a product it brings runs out first.
  const cards = useMemo(() => {
    const byPo = new Map<string, ShortageRisk[]>()
    for (const s of shortages) {
      const po = s.nextIncoming?.poId ?? s.incoming[0]?.poId
      if (po) byPo.set(po, [...(byPo.get(po) ?? []), s])
    }
    return [...risks.values()]
      .filter((r) => LEVEL_RANK[r.level] >= LEVEL_RANK.MEDIUM || byPo.has(r.poId))
      .map((r) => ({ risk: r, shortages: byPo.get(r.poId) ?? [] }))
      .sort((a, b) => b.risk.score - a.risk.score)
      .slice(0, 8)
  }, [risks, shortages])

  const noOrder = shortages.filter((s) => !s.incoming.length).slice(0, 5)

  return (
    <SectionCard icon="truck" tone="red" title={t('ความเสี่ยงการส่งของ')} count={t('(คะแนนจากกฎ ไม่ใช่ความน่าจะเป็น)')} flush>
      <div className="flex flex-wrap gap-2 px-4 pb-3 md:px-5">
        {LEVELS.map((l) => (
          <span key={l} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${COUNT_TONE[l]}`}>
            {t(RISK_LEVEL_LABEL[l])} <span className="num">{counts[l]}</span>
          </span>
        ))}
      </div>
      {!ready ? (
        <p className="px-5 pb-5 text-sm text-ink-faint">{t('กำลังคำนวณ...')}</p>
      ) : !cards.length && !noOrder.length ? (
        <p className="px-5 pb-6 pt-1 text-center text-sm text-ink-faint">{t('ไม่มีใบสั่งซื้อที่เสี่ยงส่งช้า')}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {cards.map(({ risk, shortages: short }) => (
            <RiskCard
              key={risk.poId}
              risk={risk}
              short={short}
              phone={suppliers.find((s) => s.id === risk.supplierId)?.contactNumber}
              expanded={open === risk.poId}
              onToggle={() => setOpen(open === risk.poId ? null : risk.poId)}
            />
          ))}
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
      )}
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
