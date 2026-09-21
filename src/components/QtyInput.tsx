import { useEffect, useMemo, useState } from 'react'
import { useT } from '../i18n/I18nContext'
import { sameUnit, type UnitConversion } from '../lib/units'
import { isCountUnit, resolveFactor, type QtyEntry } from '../lib/uom'
import { blurOnWheel } from './ui'
import { DefineConversionModal } from './DefineConversionModal'

// Quantity input with the unit beside it. What is handed to the parent is a QtyEntry: the
// number as keyed, the unit it was keyed in, and the same quantity in the product's own
// unit — which is what every balance is kept in (owner's rule, 20 Sep 2026; lib/uom.ts).

export interface EntryUnit {
  /** Stable identity, and the <select> value. */
  key: string
  label: string
  /**
   * How many of the product's own unit one of these is. Null when nobody has stated it
   * for this product yet: the unit is offered, and choosing it asks for the rate.
   */
  factor: number | null
  /** The unit stamped on the row as `entryUnit`; the product's own unit for the base choice. */
  records: string
  /** True when the label is a translation key rather than stored data. */
  translate?: boolean
}

/**
 * Smaller units a base unit divides into by a rate true for every product in the world:
 * grams into kilograms, millilitres into litres. The owner asked for these two and no others.
 */
export function subUnitsFor(unitType: string): EntryUnit[] {
  const base = (unitType || '').trim()
  const g = resolveFactor({ unitType: base }, 'g')
  if (g !== null && !sameUnit(base, 'g')) return [{ key: 'sub', label: 'กรัม (g)', factor: g, translate: true, records: 'g' }] // i18n-key
  const ml = resolveFactor({ unitType: base }, 'ml')
  if (ml !== null && !sameUnit(base, 'ml')) return [{ key: 'sub', label: 'มล. (ml)', factor: ml, translate: true, records: 'ml' }] // i18n-key
  return []
}

/**
 * Units printed on the boxes people receive, offered on every product until the owner's
 * own list (Settings) loads. A unit here has no rate of its own; the product supplies it.
 */
export const PLAIN_UNITS = ['Lot', 'Pack', 'EA'] as const

/**
 * Every unit this product may be keyed in, base unit first, each with its rate for THIS
 * product or null when none is stated yet. Exported so the entry screens, the import and
 * their tests agree on one answer.
 */
export function entryUnitsFor(
  unitType: string,
  /** The owner's list from Settings. Undefined until it loads; PLAIN_UNITS stands in. */
  plainUnits?: readonly string[],
  /** This product's rates. */
  conversions?: readonly UnitConversion[],
): EntryUnit[] {
  const base = (unitType || '').trim()
  const product = { unitType: base, unitConversions: conversions }
  const out: EntryUnit[] = [{ key: 'base', label: base || '-', factor: 1, records: base }]
  out.push(...subUnitsFor(unitType))
  // Never list a unit already on `out` — its own name, or a metric sub-unit — twice.
  const taken = new Set([base.toLowerCase(), ...out.map((u) => u.records.toLowerCase()), ...out.map((u) => u.label.toLowerCase())])
  // The owner's shared list, plus this product's own rated units, whether or not the owner
  // ever added them in Settings: a rate set on one product ("1 ลัง = 288 EA" on this ice
  // cream) says nothing about any other product, so it belongs on the product.
  const labels = [...(plainUnits ?? PLAIN_UNITS), ...(conversions ?? []).map((c) => c.label)]
  for (const raw of labels) {
    const label = raw.trim()
    const key = label.toLowerCase()
    if (!label || taken.has(key)) continue
    taken.add(key) // a list edited by hand can repeat itself
    out.push({ key: `plain:${label}`, label, factor: resolveFactor(product, label), records: label })
  }
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** The entry for a typed number in a unit, converted for the product. */
export function entryOf(text: string, unit: EntryUnit, factor: number): QtyEntry {
  const n = Number(text)
  const entryQty = Number.isFinite(n) && n > 0 ? round3(n) : 0
  const base = unit.key === 'base'
  return { qty: round3(entryQty * factor), entryQty, ...(base ? {} : { entryUnit: unit.records }), factor }
}

export function QtyInput({ // i18n-key
  unitType,
  plainUnits,
  conversions,
  value,
  onChange,
  product,
  onRateDefined,
  className = '',
  invalid = false,
}: {
  unitType: string
  /** The owner's unit list. Passed in rather than fetched here, so one screen reads once. */
  plainUnits?: readonly string[]
  /** This product's rates — `product.unitConversions`, if it has any. */
  conversions?: readonly UnitConversion[]
  /** The current quantity in the product's own unit. */
  value: number
  /** The quantity as keyed, the unit, and the same in the product's own unit. */
  onChange: (entry: QtyEntry) => void
  /**
   * The product, so a unit with no rate yet can have one stated on the spot ("1 Pack =
   * ? EA") and saved to the product. Without it such a unit is offered but cannot be picked.
   */
  product?: { id: string; name: string; unitType: string; unitConversions?: UnitConversion[] }
  /** Called after a rate is saved, with the product's new list, so the screen's copy follows. */
  onRateDefined?: (conversions: UnitConversion[]) => void
  className?: string
  invalid?: boolean
}) {
  const t = useT()
  const units = useMemo(
    () => entryUnitsFor(unitType, plainUnits, conversions),
    [unitType, plainUnits, conversions],
  )
  const [unitKey, setUnitKey] = useState('base')
  const unit = units.find((u) => u.key === unitKey) ?? units[0]
  const factor = unit.factor ?? 1
  const [text, setText] = useState(value ? String(value) : '')
  const [asking, setAsking] = useState<EntryUnit | null>(null)

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

  function commit(nextText: string, next: EntryUnit, f: number) {
    onChange(entryOf(nextText, next, f))
  }

  function pick(next: EntryUnit) {
    if (next.factor === null) {
      // No rate for this product yet. Ask for it once; the product remembers.
      if (product) setAsking(next)
      return
    }
    setUnitKey(next.key)
    commit(text, next, next.factor)
  }

  const converted = unit.key !== 'base' && Number(text) > 0 ? round3(Number(text) * factor) : null

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
          onWheel={blurOnWheel}
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value, unit, factor)
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
          onChange={(e) => pick(units.find((u) => u.key === e.target.value) ?? units[0])}
          className="min-h-11 w-32 shrink-0 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink-soft outline-none transition-colors duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          aria-label={t('เลือกหน่วยที่กรอก')}
        >
          {units.map((u) => (
            <option key={u.key} value={u.key} disabled={u.factor === null && !product}>
              {u.translate ? t(u.label) : u.label}
              {u.factor === null ? ` ${t('(ยังไม่มีอัตรา)')}` : ''}
            </option>
          ))}
        </select>
      </div>
      {/* What gets filed, when it differs from what was typed. Definitive, not a hint. */}
      {converted !== null && (
        <p className="mt-1 text-right text-xs text-ink-soft">
          = <span className="num font-semibold text-ink">{converted}</span> {unitType}
        </p>
      )}
      {/* A count unit cannot really hold 0.368 of itself. Said, not blocked: the person
          may know the piece was cut, or may have the wrong unit. */}
      {converted !== null && isCountUnit(unitType) && !Number.isInteger(converted) && (
        <p className="mt-0.5 text-right text-xs font-medium text-warn">
          {t('จะบันทึก {qty} {unit} (ไม่เต็มหน่วย) — ตรวจสอบหน่วยอีกครั้ง', { qty: converted, unit: unitType })}
        </p>
      )}
      {asking && product && (
        <DefineConversionModal
          product={product}
          label={asking.records}
          onClose={() => setAsking(null)}
          onSaved={(list, size) => {
            setAsking(null)
            onRateDefined?.(list)
            setUnitKey(asking.key)
            commit(text, asking, size)
          }}
        />
      )}
    </div>
  )
}

/**
 * A bare unit picker for screens that keep the number elsewhere (order lines, requests,
 * the import review): the same list as QtyInput, the same "state the rate once" prompt.
 * `value` is the entryUnit ('' = the product's own unit).
 */
export function UnitSelect({
  units,
  value,
  onChange,
  product,
  onRateDefined,
  className = '',
}: {
  units: EntryUnit[]
  value: string
  onChange: (entryUnit: string) => void
  product?: { id: string; name: string; unitType: string; unitConversions?: UnitConversion[] }
  onRateDefined?: (conversions: UnitConversion[]) => void
  className?: string
}) {
  const t = useT()
  const [asking, setAsking] = useState<EntryUnit | null>(null)
  const base = units[0]?.records ?? ''
  const current = units.find((u) => sameUnit(u.records, value || base)) ?? units[0]
  return (
    <>
      <select
        value={current?.key ?? 'base'}
        onChange={(e) => {
          const next = units.find((u) => u.key === e.target.value) ?? units[0]
          if (next.factor === null) {
            if (product) setAsking(next)
            return
          }
          onChange(next.key === 'base' ? '' : next.records)
        }}
        className={`min-h-11 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 ${className}`}
        aria-label={t('เลือกหน่วยที่กรอก')}
      >
        {units.map((u) => (
          <option key={u.key} value={u.key} disabled={u.factor === null && !product}>
            {u.translate ? t(u.label) : u.label}
            {u.factor === null ? ` ${t('(ยังไม่มีอัตรา)')}` : ''}
          </option>
        ))}
      </select>
      {asking && product && (
        <DefineConversionModal
          product={product}
          label={asking.records}
          onClose={() => setAsking(null)}
          onSaved={(list) => {
            setAsking(null)
            onRateDefined?.(list)
            onChange(asking.records)
          }}
        />
      )}
    </>
  )
}
