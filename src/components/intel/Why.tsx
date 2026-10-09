import { useState, type ReactNode } from 'react'
import { useT } from '../../i18n/I18nContext'
import { CONFIDENCE_LABEL } from '../../lib/riskCopy'
import { formatThaiDateTime } from '../../lib/format'
import { DATA_NOTE_TEXT, explain } from '../../intel/copy'
import type { DataConfidence, IntelMeta, Reason } from '../../intel/meta'
import { StatusChip } from '../frame'

/**
 * Phase G10 — the "Why?" that goes with every intelligence result on screen: the reasons
 * in words, how much the evidence can bear, and which engine said it, when. Never a
 * black box: the answer is always one press away and never hidden behind a percentage.
 */

const TONE: Record<DataConfidence, 'green' | 'blue' | 'amber' | 'slate'> = { high: 'green', medium: 'blue', low: 'amber', insufficient: 'slate' }

export function ConfidenceNote({ meta }: { meta: IntelMeta }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
      <StatusChip tone={TONE[meta.dataConfidence]} size="sm" icon={null}>
        {t(CONFIDENCE_LABEL[meta.dataConfidence])}
      </StatusChip>
      {meta.dataNotes.map((n) => (
        <span key={n}>· {t(DATA_NOTE_TEXT[n])}</span>
      ))}
      <span>· {t('{engine} {version} · คิดเมื่อ {at}', { engine: meta.engine, version: meta.engineVersion, at: formatThaiDateTime(meta.calculatedAt) })}</span>
    </div>
  )
}

export function WhyList({ reasons }: { reasons: readonly Reason[] }) {
  const t = useT()
  if (!reasons.length) return <p className="text-xs text-ink-faint">{t('ไม่มีปัจจัยที่ต้องอธิบาย')}</p>
  return (
    <ul className="space-y-0.5 text-xs text-ink-soft">
      {reasons.map((r, i) => (
        <li key={`${r.code}-${i}`} className="flex gap-1.5">
          {r.points !== undefined && <span className="num w-9 shrink-0 text-right font-semibold text-ink">{r.points > 0 ? `+${r.points}` : r.points === 0 ? '·' : r.points}</span>}
          <span>{explain(r, t)}</span>
        </li>
      ))}
    </ul>
  )
}

/** A headline with a [Why?] that opens the reasons and the confidence in place. */
export function Why({ headline, reasons, meta, children }: { headline: ReactNode; reasons: readonly Reason[]; meta: IntelMeta; children?: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">{headline}</span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-9 rounded-md px-2 text-xs font-semibold text-brand hover:bg-brand-soft">
          {open ? t('ซ่อนเหตุผล') : t('ทำไม?')}
        </button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-line bg-sunken p-2.5">
          <WhyList reasons={reasons} />
          {children}
          <ConfidenceNote meta={meta} />
        </div>
      )}
    </div>
  )
}
