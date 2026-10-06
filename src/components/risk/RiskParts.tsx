import { useT } from '../../i18n/I18nContext'
import type { DeliveryRisk, RiskLevel } from '../../lib/deliveryRisk'
import { formatThaiDate } from '../../lib/format'
import type { ShortageRisk } from '../../lib/inventoryRisk'
import { RISK_LEVEL_COLOR, RISK_LEVEL_LABEL, RISK_REASON_TEXT, SHORTAGE_REASON_TEXT } from '../../lib/riskCopy'
import { Icon } from '../Icon'
import { Badge } from '../ui'

/**
 * The pieces every risk display shares (5 Oct 2026). A risk is a score out of 100 from
 * rules, so it is always written "72/100", never "72%" — a percentage would read as a
 * probability nobody has calibrated.
 */

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const t = useT()
  return (
    <Badge color={RISK_LEVEL_COLOR[level]}>
      {level === 'CRITICAL' && <Icon name="alertCircle" size={12} className="mr-0.5" />}
      {t('ความเสี่ยง{level}', { level: t(RISK_LEVEL_LABEL[level]) })}
      {score !== undefined && <span className="num ml-1">{score}/100</span>}
    </Badge>
  )
}

/** "Why": every reason with its points, the largest first. */
export function RiskReasons({ risk, limit }: { risk: DeliveryRisk; limit?: number }) {
  const t = useT()
  const shown = risk.reasons.filter((r) => r.points > 0 || r.code === 'noHistory').slice(0, limit)
  if (!shown.length) return <p className="text-xs text-ink-faint">{t('ไม่พบปัจจัยเสี่ยง')}</p>
  return (
    <ul className="space-y-0.5 text-xs text-ink-soft">
      {shown.map((r) => (
        <li key={r.code} className="flex gap-1.5">
          <span className="num w-8 shrink-0 text-right font-semibold text-ink">{r.points > 0 ? `+${r.points}` : '·'}</span>
          <span>{t(RISK_REASON_TEXT[r.code], r.params)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ShortageSummary({ s }: { s: ShortageRisk }) {
  const t = useT()
  return (
    <div className="text-xs text-ink-soft">
      <p>
        <span className="font-semibold text-ink">{s.productName}</span> · {s.locationName}
      </p>
      <p>
        {t('คาดว่าหมด {date}', { date: formatThaiDate(s.stockoutDate) })}
        {s.gapDays > 0 && (
          <span className="ml-1 font-semibold text-out">· {t('ขาด {days} วัน ({qty} {unit})', { days: s.gapDays, qty: s.shortageQty, unit: s.unit })}</span>
        )}
      </p>
      {s.reasons.map((r) => (
        <p key={r.code}>{t(SHORTAGE_REASON_TEXT[r.code], r.params)}</p>
      ))}
    </div>
  )
}
