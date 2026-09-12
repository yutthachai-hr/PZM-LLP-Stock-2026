import { useEffect, useMemo, useState } from 'react'
import { useT } from '../i18n/I18nContext'

// Quantity input that lets someone key what the delivery note says — grams, whole packs,
// a lot — while the VALUE handed to the parent is ALWAYS in the product's base unit, so
// every balance stays one comparable number.

export interface EntryUnit {
  /** Stable identity, and the <select> value. Two units can share a factor, or have none. */
  key: string
  label: string
  /** Base units per 1 of this entry unit. 0 means nobody has said yet — see `ask`. */
  factor: number
  /** True when the label is a translation key rather than stored data. */
  translate?: boolean
  /** True when the size has to be keyed in before the quantity means anything. */
  ask?: boolean
}

/**
 * Smaller units a base unit divides into cleanly.
 *
 * Only weight and volume are here, because only they have a factor that is true for every
 * product in the world: a gram is a thousandth of a kilo whatever is being weighed.
 */
export function subUnitsFor(unitType: string): EntryUnit[] {
  const u = (unitType || '').trim().toUpperCase()
  if (u === 'KG') return [{ key: 'sub', label: 'กรัม (g)', factor: 0.001, translate: true }] // i18n-key
  if (u === 'L' || u === 'LT' || u === 'LITER' || u === 'ลิตร') // i18n-key
    return [{ key: 'sub', label: 'มล. (ml)', factor: 0.001, translate: true }] // i18n-key
  return []
}

/**
 * Units that are printed on boxes but have no size of their own.
 *
 * A lot, a pack and a piece are each "however many the supplier put in it" — one Lot of
 * mozzarella is 10 kg from one supplier and 2 kg from another, and RICOTTA 250 GR is a
 * quarter of a kilo per piece while a sack of flour is twenty-two.
 *
 * They are offered on every product regardless, because that is what the delivery note in
 * the person's hand actually says. The size is asked for at the moment it is keyed rather
 * than guessed here, so the number that reaches the ledger is still a real quantity.
 */
export const ASK_UNITS = ['Lot', 'Pack', 'EA'] as const

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
  const hasPack = !!packSize && packSize > 0 && packSize !== 1
  const out: EntryUnit[] = [{ key: 'base', label: unitType || '-', factor: 1 }]
  // A configured pack is a real multiplier, so it is offered with its size showing. A pack
  // of 1, or of nothing, is not a unit — it is a label that would record the same number
  // twice over.
  if (hasPack) {
    out.push({
      key: 'pack',
      label: `${packLabel || 'Pack'} (×${packSize})`, // a stored label, not UI copy
      factor: packSize,
    })
  }
  out.push(...subUnitsFor(unitType))
  // Never offer a unit the product already has under its own name: an EA product listing
  // "EA" twice, one of which asks for a size, is worse than not offering it at all.
  const taken = new Set([(unitType || '').trim().toLowerCase()])
  if (hasPack) {
    taken.add('pack')
    taken.add((packLabel || 'Pack').trim().toLowerCase())
  }
  for (const label of ASK_UNITS) {
    if (taken.has(label.toLowerCase())) continue
    out.push({ key: `ask:${label}`, label, factor: 0, ask: true })
  }
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Sizes someone has already keyed, on this device.
 *
 * Typing "1 Lot = 10 KG" on every line of a twelve-line delivery is the kind of thing that
 * gets a feature abandoned. It is remembered here rather than written to the product,
 * because a lot size is what one supplier sent this week, not a fact about the product —
 * the fact about the product is ขนาดบรรจุ, which is shared and stays where it is.
 */
const SIZE_KEY = 'pmstock:v1:unit-size'

function readSizes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SIZE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export function recallSize(productId: string | undefined, unitLabel: string): number {
  if (!productId) return 0
  const n = readSizes()[`${productId}|${unitLabel}`]
  return typeof n === 'number' && n > 0 ? n : 0
}

function rememberSize(productId: string | undefined, unitLabel: string, size: number): void {
  if (!productId || !(size > 0)) return
  try {
    const all = readSizes()
    all[`${productId}|${unitLabel}`] = size
    localStorage.setItem(SIZE_KEY, JSON.stringify(all))
  } catch {
    // A full or blocked store only costs the person one extra keystroke next time.
  }
}

export function QtyInput({ // i18n-key
  unitType,
  productId,
  packSize,
  packLabel,
  value,
  onChange,
  className = '',
  invalid = false,
}: {
  unitType: string
  /** Used only to remember a keyed-in lot or pack size for next time. */
  productId?: string
  /** Base units per pack, from the product. Offers the pack with its size already known. */
  packSize?: number
  packLabel?: string
  value: number // always base units
  onChange: (baseValue: number) => void
  className?: string
  invalid?: boolean
}) {
  const t = useT()
  const units = useMemo(
    () => entryUnitsFor(unitType, packSize, packLabel),
    [unitType, packSize, packLabel],
  )
  const [unitKey, setUnitKey] = useState('base')
  const unit = units.find((u) => u.key === unitKey) ?? units[0]
  const [sizeText, setSizeText] = useState('')
  const [text, setText] = useState(value ? String(value) : '')

  const typedSize = Number(sizeText)
  const factor = unit.ask
    ? Number.isFinite(typedSize) && typedSize > 0
      ? typedSize
      : 0
    : unit.factor

  // Choosing grams for a KG product sets the multiplier to 0.001. The Adjust page reuses
  // this same component when the product changes, so switching products left the previous
  // product's multiplier in place: typing 10 recorded 0.01. The multiplier belongs to the
  // unit, so it resets when the unit — or the product behind it — does.
  useEffect(() => {
    setUnitKey('base')
    setSizeText('')
  }, [unitType, packSize, productId])

  // Re-sync the text when the base value changes for a reason other than typing
  // (e.g. parent reset to 0, or the unit toggle changed the display scale).
  useEffect(() => {
    if (!(factor > 0)) return
    const shownNow = Number(text) * factor
    if (Math.abs(shownNow - value) > 1e-9) {
      setText(value ? String(round3(value / factor)) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, factor])

  // One place decides what the parent is told, so quantity, unit and size all reach it the
  // same way. A size that has not been given yet means the quantity is not yet known, so
  // it reports 0 and the screen's own "nothing to save" guard does the rest.
  function commit(nextText: string, nextFactor: number) {
    const n = Number(nextText)
    onChange(Number.isFinite(n) && nextFactor > 0 ? round3(n * nextFactor) : 0)
  }

  function handleUnit(key: string) {
    const next = units.find((u) => u.key === key) ?? units[0]
    setUnitKey(key)
    if (next.ask) {
      const known = recallSize(productId, next.label)
      setSizeText(known ? String(known) : '')
      commit(text, known)
    } else {
      setSizeText('')
      commit(text, next.factor)
    }
  }

  function handleSize(raw: string) {
    setSizeText(raw)
    const n = Number(raw)
    const ok = Number.isFinite(n) && n > 0 ? n : 0
    rememberSize(productId, unit.label, ok)
    commit(text, ok)
  }

  const converted =
    factor !== 1 && factor > 0 && Number(text) > 0 ? round3(Number(text) * factor) : null

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
            commit(e.target.value, factor)
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
          onChange={(e) => handleUnit(e.target.value)}
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
      {/* Asked once, then remembered: how big this supplier's lot or pack actually is. */}
      {unit.ask && (
        <div className="mt-1 flex items-center justify-end gap-2">
          <label className="text-xs text-ink-soft" htmlFor={`size-${unit.key}`}>
            {t('1 {unit} คิดเป็น', { unit: unit.label })}
          </label>
          <input
            id={`size-${unit.key}`}
            type="number"
            step="any"
            min={0}
            inputMode="decimal"
            value={sizeText}
            placeholder="?"
            onChange={(e) => handleSize(e.target.value)}
            className={`num min-h-9 w-20 rounded-lg border px-2 py-1 text-right text-sm font-semibold text-ink outline-none focus-visible:ring-2 ${
              sizeText.trim() === ''
                ? 'border-warn bg-warn-soft focus-visible:border-warn focus-visible:ring-warn/25'
                : 'border-line-strong focus-visible:border-brand focus-visible:ring-brand/25'
            }`}
          />
          <span className="text-xs text-ink-soft">{unitType}</span>
        </div>
      )}
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
