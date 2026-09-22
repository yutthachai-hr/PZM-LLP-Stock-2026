import { StatusChip, type Tone } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { URGENCIES, type RequestUrgency } from '../../types'

const TONE: Record<RequestUrgency, Tone> = { normal: 'slate', urgent: 'amber', critical: 'red' }
const SELECT_TONE: Record<RequestUrgency, string> = {
  normal: 'border-line-strong text-ink-soft',
  urgent: 'border-warn/50 bg-warn-soft text-warn',
  critical: 'border-danger/50 bg-danger-soft text-danger',
}

/** How soon a requested line is needed, as a pill (owner, 22 Sep 2026). */
export function UrgencyChip({ value }: { value?: RequestUrgency }) {
  const t = useT()
  const u = value ?? 'normal'
  return (
    <StatusChip tone={TONE[u]} icon={u === 'normal' ? null : 'alertCircle'} size="sm">
      {t(URGENCIES.find((x) => x.value === u)!.label)}
    </StatusChip>
  )
}

/** The same, as the box a requester (while drafting) or a manager (while reviewing) changes. */
export function UrgencySelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value?: RequestUrgency
  onChange: (u: RequestUrgency) => void
  disabled?: boolean
  /** Names the box for a screen reader — the product it belongs to. */
  label: string
}) {
  const t = useT()
  const u = value ?? 'normal'
  return (
    <select
      value={u}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as RequestUrgency)}
      className={`min-h-10 cursor-pointer rounded-lg border bg-surface px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-60 ${SELECT_TONE[u]}`}
    >
      {URGENCIES.map((x) => (
        <option key={x.value} value={x.value}>
          {t(x.label)}
        </option>
      ))}
    </select>
  )
}
