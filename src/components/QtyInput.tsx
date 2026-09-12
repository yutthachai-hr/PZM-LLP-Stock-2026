import { useEffect, useState } from 'react'
import { useT } from '../i18n/I18nContext'

// Quantity input that lets someone key what the delivery note says — grams, millilitres,
// or whole packs — while the VALUE handed to the parent is ALWAYS in the product's base
// unit, so every balance stays one comparable number.

interface EntryUnit {
  label: string
  /** Base units per 1 of this entry unit. 1 = the base unit itself. */
  factor: number
  /** True when the label is a translation key rather than stored data. */
  translate?: boolean
}

/**
 * Smaller units a base unit divides into cleanly.
 *
 * Only weight and volume are here because only they have a factor that is true for every
 * product. A pack does not — "1 Pack" is 12 of one thing and 300 of another — so packs
 * come from the product itself, not from this table.
 */
export function subUnitsFor(unitType: string): EntryUnit[] {
  const u = (unitType || '').trim().toUpperCase()
  if (u === 'KG') return [{ label: 'กรัม (g)', factor: 0.001, translate: true }] // i18n-key
  if (u === 'L' || u === 'LT' || u === 'LITER' || u === 'ลิตร') // i18n-key
    return [{ label: 'มล. (ml)', factor: 0.001, translate: true }] // i18n-key
  return []
}

/**
 * Every unit this product may be keyed in, base unit first.
 *
 * Exported so the entry screens and their tests agree on one answer.
 */
export function entryUnitsFor(
  unitType: string,
  packSize?: number,
  packLabel?: string,
): EntryUnit[] {
  const base: EntryUnit = { label: unitType || '-', factor: 1 }
  const out = [base]
  // A pack is only offered when it is a real multiplier. A pack of 1, or of nothing, is
  // not a unit — it is a label that would silently record the same number twice over.
  if (packSize && packSize > 0 && packSize !== 1) {
    out.push({
      label: `${packLabel || 'Pack'} (×${packSize})`, // a stored label, not UI copy
      factor: packSize,
    })
  }
  out.push(...subUnitsFor(unitType))
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function QtyInput({ // i18n-key
  unitType,
  packSize,
  packLabel,
  value,
  onChange,
  className = '',
  invalid = false,
}: {
  unitType: string
  /** Base units per pack, from the product. Enables the pack option. */
  packSize?: number
  packLabel?: string
  value: number // always base units
  onChange: (baseValue: number) => void
  className?: string
  invalid?: boolean
}) {
  const t = useT()
  const units = entryUnitsFor(unitType, packSize, packLabel)
  const [factor, setFactor] = useState(1) // 1 = base unit
  const [text, setText] = useState(value ? String(value) : '')

  // Choosing grams for a KG product sets factor to 0.001. The Adjust page reuses this same
  // component when the product changes, so switching to an EA product left the multiplier
  // in place with no dropdown to see it: typing 10 recorded 0.01. The multiplier belongs to
  // the unit, so it resets when the unit — or the pack it could convert from — does.
  useEffect(() => {
    setFactor(1)
  }, [unitType, packSize])

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

  const converted = factor !== 1 && Number(text) > 0 ? round3(Number(text) * factor) : null

  return (
    <div>
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
        {/* Always a select, even with one option. It used to fall back to plain text when
            a product had no sub-units, so every EA and Pack item simply had no unit
            control — which reads as the unit having gone missing rather than as there
            being nothing to choose. */}
        <select
          value={factor}
          onChange={(e) => setFactor(Number(e.target.value))}
          className="min-h-11 w-24 shrink-0 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink-soft outline-none transition-colors duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          aria-label={t('เลือกหน่วยที่กรอก')}
        >
          {units.map((u) => (
            <option key={`${u.label}-${u.factor}`} value={u.factor}>
              {u.translate ? t(u.label) : u.label}
            </option>
          ))}
        </select>
      </div>
      {/* What actually goes into the ledger, whenever that is not what was typed. Someone
          keying 2 cases needs to see the 600 pieces before they save it, not after. */}
      {converted !== null && (
        <p className="mt-1 text-right text-xs text-ink-soft">
          = <span className="num font-semibold text-ink">{converted}</span> {unitType}
        </p>
      )}
    </div>
  )
}
