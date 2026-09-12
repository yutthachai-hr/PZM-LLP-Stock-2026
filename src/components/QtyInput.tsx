import { useEffect, useMemo, useState } from 'react'
import { useT } from '../i18n/I18nContext'

// Quantity input with the unit beside it. The VALUE handed to the parent is always in the
// product's base unit, so every balance stays one comparable number.

export interface EntryUnit {
  /** Stable identity, and the <select> value. Several units share the factor 1. */
  key: string
  label: string
  /** Multiplier applied to the typed number. Only grams and millilitres are ever not 1. */
  factor: number
  /**
   * The unit the ledger records for this choice.
   *
   * Grams convert into the product's own unit, so keying 500 g files 0.5 KG and the row
   * says KG. Everything else files the label itself, untouched.
   */
  records: string
  /** True when the label is a translation key rather than stored data. */
  translate?: boolean
}

/**
 * Smaller units a base unit divides into cleanly.
 *
 * Only weight and volume are here, because only they have a factor that is true for every
 * product in the world: a gram is a thousandth of a kilo whatever is being weighed.
 */
export function subUnitsFor(unitType: string): EntryUnit[] {
  const base = (unitType || '').trim()
  const u = base.toUpperCase()
  if (u === 'KG')
    return [{ key: 'sub', label: 'กรัม (g)', factor: 0.001, translate: true, records: base }] // i18n-key
  if (u === 'L' || u === 'LT' || u === 'LITER' || u === 'ลิตร') // i18n-key
    return [{ key: 'sub', label: 'มล. (ml)', factor: 0.001, translate: true, records: base }] // i18n-key
  return []
}

/**
 * Units printed on the boxes people receive, offered on every product.
 *
 * Nothing here converts. The owner's rule, stated plainly: the system records the unit the
 * person keyed and never rewrites it — one Lot is 10 kg from one supplier and 2 kg from
 * another, so any factor this code invented would be a guess written into the ledger.
 *
 * This is only the starting list. The owner maintains the real one in Settings, which is
 * where Carton and anything else they receive by gets added.
 */
export const PLAIN_UNITS = ['Lot', 'Pack', 'EA'] as const

/**
 * Every unit this product may be keyed in, base unit first.
 *
 * Exported so the entry screens and their tests agree on one answer.
 */
export function entryUnitsFor(
  unitType: string,
  /** The owner's list from Settings. Undefined until it loads; PLAIN_UNITS stands in. */
  plainUnits?: readonly string[],
): EntryUnit[] {
  const base = (unitType || '').trim()
  const out: EntryUnit[] = [{ key: 'base', label: base || '-', factor: 1, records: base }]
  out.push(...subUnitsFor(unitType))
  // Never list a unit the product already has under its own name.
  const taken = new Set([base.toLowerCase()])
  for (const raw of plainUnits ?? PLAIN_UNITS) {
    const label = raw.trim()
    const key = label.toLowerCase()
    if (!label || taken.has(key)) continue
    taken.add(key) // a list edited by hand can repeat itself
    out.push({ key: `plain:${label}`, label, factor: 1, records: label })
  }
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function QtyInput({ // i18n-key
  unitType,
  plainUnits,
  value,
  onChange,
  className = '',
  invalid = false,
}: {
  unitType: string
  /** The owner's unit list. Passed in rather than fetched here, so one screen reads once. */
  plainUnits?: readonly string[]
  value: number
  /**
   * The quantity, and the unit it is to be recorded under.
   *
   * The unit travels with the number because the screen above files both on the movement.
   * Handing up only a number is what made this wrong before: the row was always stamped
   * with the product's own unit, so picking EA changed nothing anyone could see afterwards.
   */
  onChange: (qty: number, unit: string) => void
  className?: string
  invalid?: boolean
}) {
  const t = useT()
  const units = useMemo(() => entryUnitsFor(unitType, plainUnits), [unitType, plainUnits])
  const [unitKey, setUnitKey] = useState('base')
  const unit = units.find((u) => u.key === unitKey) ?? units[0]
  const factor = unit.factor
  const [text, setText] = useState(value ? String(value) : '')

  // Choosing grams for a KG product sets the multiplier to 0.001. The Adjust page reuses
  // this same component when the product changes, so switching products left the previous
  // product's multiplier in place: typing 10 recorded 0.01. The multiplier belongs to the
  // unit, so it resets when the unit — or the product behind it — does.
  useEffect(() => {
    setUnitKey('base')
  }, [unitType])

  // The list can change under an open screen — someone adds Carton in Settings on another
  // tab — and a select whose value matches no option renders blank.
  useEffect(() => {
    if (!units.some((u) => u.key === unitKey)) setUnitKey('base')
  }, [units, unitKey])

  // Re-sync the text when the base value changes for a reason other than typing
  // (e.g. parent reset to 0, or the unit toggle changed the display scale).
  useEffect(() => {
    const shownNow = Number(text) * factor
    if (Math.abs(shownNow - value) > 1e-9) {
      setText(value ? String(round3(value / factor)) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, factor])

  function commit(nextText: string, next: EntryUnit) {
    const n = Number(nextText)
    onChange(Number.isFinite(n) ? round3(n * next.factor) : 0, next.records)
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
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value, unit)
          }}
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
          value={unit.key}
          onChange={(e) => {
            const next = units.find((u) => u.key === e.target.value) ?? units[0]
            setUnitKey(next.key)
            commit(text, next)
          }}
          className="min-h-11 w-28 shrink-0 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink-soft outline-none transition-colors duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          aria-label={t('เลือกหน่วยที่กรอก')}
        >
          {units.map((u) => (
            <option key={u.key} value={u.key}>
              {u.translate ? t(u.label) : u.label}
            </option>
          ))}
        </select>
      </div>
      {/* Grams are the one conversion left, so this is the one case where what is filed is
          not what was typed. Showing it before saving is the whole point. */}
      {converted !== null && (
        <p className="mt-1 text-right text-xs text-ink-soft">
          = <span className="num font-semibold text-ink">{converted}</span> {unitType}
        </p>
      )}
    </div>
  )
}
