import { useMemo, type SelectHTMLAttributes } from 'react'
import { useData } from '../data/DataContext'
import { siteTones } from '../lib/siteTone'
import { Select } from './ui'

/**
 * A site's name in its own tint, the same tint everywhere a site is named — the main
 * warehouse red, Sarasin orange, On Nut purple (see lib/siteTone.ts). The owner's rule
 * (20 Sep 2026): one colour per site across the whole system, so a row can be read
 * without reading the word.
 */
export function useSiteTone(): (locationId: string | undefined) => string {
  const { rawLocations } = useData()
  const tones = useMemo(() => siteTones(rawLocations), [rawLocations])
  return (id) => (id ? (tones.get(id) ?? 'bg-sunken text-ink-soft') : 'bg-sunken text-ink-soft')
}

export function SiteChip({ locationId, className = '' }: { locationId: string | undefined; className?: string }) {
  const { locationById } = useData()
  const tone = useSiteTone()
  if (!locationId) return null
  const name = locationById(locationId)?.name ?? '—'
  return (
    <span className={`inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tone(locationId)} ${className}`}>
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * A location picker in site colours: the closed box takes the tint of the site chosen,
 * and each option carries its own (the browser paints option colours on desktop; a
 * phone's native sheet ignores them, and the box still says which site is set).
 */
export function SiteSelect({
  value,
  onChange,
  locations,
  emptyLabel,
  className = '',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (id: string) => void
  locations: readonly { id: string; name: string }[]
  /** An "any site" first option, when the picker is a filter. */
  emptyLabel?: string
}) {
  const tone = useSiteTone()
  const toned = value ? `${tone(value)} font-medium border-transparent` : ''
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={`${toned} ${className}`} {...rest}>
      {emptyLabel !== undefined && (
        <option value="" className="bg-surface text-ink">
          {emptyLabel}
        </option>
      )}
      {locations.map((l) => (
        <option key={l.id} value={l.id} className={`${tone(l.id)} font-medium`}>
          {l.name}
        </option>
      ))}
    </Select>
  )
}
