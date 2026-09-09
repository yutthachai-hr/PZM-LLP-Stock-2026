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

  // Choosing grams for a KG product sets factor to 0.001. The Adjust page reuses this same
  // component when the product changes, so switching to an EA product left the multiplier
  // in place with no dropdown to see it: typing 10 recorded 0.01. The multiplier belongs to
  // the unit, so it resets when the unit does.
  useEffect(() => {
    setFactor(1)
  }, [unitType])

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
    <div className="flex items-stretch gap-2">
      {/* The quantity is the number being committed to the books, so it is set larger
          than the surrounding text and in fixed-width figures — typed on a tablet, held
          at arm's length, often by someone reading off a paper delivery note. */}
      <input
        type="number"
        step="any"
        min={0}
        inputMode="decimal"
        value={text}
        onChange={(e) => handleText(e.target.value)}
        className={`num min-h-11 w-full rounded-lg border px-3 py-2 text-right text-base font-semibold text-ink outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2 ${
          invalid
            ? 'border-danger bg-danger-soft focus-visible:border-danger focus-visible:ring-danger/25'
            : 'border-line-strong focus-visible:border-brand focus-visible:ring-brand/25'
        } ${className}`}
      />
      {subs.length > 0 ? (
        <select
          value={factor}
          onChange={(e) => setFactor(Number(e.target.value))}
          className="min-h-11 shrink-0 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink-soft outline-none transition-colors duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          aria-label={t("เลือกหน่วยที่กรอก")}
        >
          <option value={1}>{unitType}</option>
          {subs.map((s) => (
            <option key={s.label} value={s.factor}>
              {t(s.label)}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex w-12 shrink-0 items-center text-sm text-ink-soft">{unitType}</span>
      )}
    </div>
  )
}
