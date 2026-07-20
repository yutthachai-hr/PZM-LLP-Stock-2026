import { useEffect, useState } from 'react'
import { useT } from '../i18n/I18nContext'

// Quantity input that lets the user type in a smaller sub-unit (grams / millilitres) for
// products measured in KG / L. The VALUE passed to the parent is ALWAYS in the base unit,
// so all stock math stays consistent — only the input display is converted.

interface SubUnit {
  label: string
  factor: number // base units per 1 sub-unit (e.g. 1 g = 0.001 kg)
}

// `unitType` is a code stored on the product ("KG", "ลิตร"), not UI copy — the labels are
// translation keys, rendered through t() by the <select> below.
export function subUnitsFor(unitType: string): SubUnit[] {
  const u = (unitType || '').trim().toUpperCase()
  if (u === 'KG') return [{ label: 'กรัม (g)', factor: 0.001 }] // i18n-key
  if (u === 'L' || u === 'LT' || u === 'LITER' || u === 'ลิตร') // i18n-key
    return [{ label: 'มล. (ml)', factor: 0.001 }] // i18n-key
  return []
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function QtyInput({ // i18n-key
  unitType,
  value,
  onChange,
  className = '',
  invalid = false,
}: {
  unitType: string
  value: number // always base units
  onChange: (baseValue: number) => void
  className?: string
  invalid?: boolean
}) {
  const t = useT()
  const subs = subUnitsFor(unitType)
  const [factor, setFactor] = useState(1) // 1 = base unit
  const [text, setText] = useState(value ? String(value) : '')

  // Re-sync the text when the base value changes for a reason other than typing
  // (e.g. parent reset to 0, or the unit toggle changed the display scale).
  useEffect(() => {
    const shownNow = Number(text) * factor
    if (Math.abs(shownNow - value) > 1e-9) {
      setText(value ? String(round3(value / factor)) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, factor])

  function handleText(t: string) {
    setText(t)
    const n = Number(t)
    onChange(Number.isFinite(n) ? round3(n * factor) : 0)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="any"
        min={0}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-right text-sm outline-none focus:ring-2 focus:ring-red-100 ${
          invalid ? 'border-rose-400' : 'border-slate-300 focus:border-red-500'
        } ${className}`}
      />
      {subs.length > 0 ? (
        <select
          value={factor}
          onChange={(e) => setFactor(Number(e.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-red-500"
          title={t("เลือกหน่วยที่กรอก")}
        >
          <option value={1}>{unitType}</option>
          {subs.map((s) => (
            <option key={s.label} value={s.factor}>
              {t(s.label)}
            </option>
          ))}
        </select>
      ) : (
        <span className="w-12 shrink-0 text-sm text-slate-500">{unitType}</span>
      )}
    </div>
  )
}
