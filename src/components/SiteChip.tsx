import { useMemo } from 'react'
import { useData } from '../data/DataContext'
import { siteTones } from '../lib/siteTone'

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
