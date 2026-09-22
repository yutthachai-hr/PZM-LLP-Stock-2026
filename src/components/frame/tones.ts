/**
 * The colour vocabulary shared by the restyle's frame (owner's mock-ups, 22 Sep 2026).
 *
 * `Tone` names what a thing IS, not what hue it happens to be: a tile for "low stock" is
 * `amber` in both brands, and `brand` follows whichever company's books are open. Kept in
 * one place so a StatTile, a StatusChip and a SummaryList row that mean the same state
 * cannot drift into three slightly different oranges.
 */
export type Tone = 'brand' | 'red' | 'green' | 'amber' | 'blue' | 'purple' | 'slate'

/** The icon circle: soft fill, strong glyph. */
export const toneIcon: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand',
  red: 'bg-tile-red-soft text-tile-red',
  green: 'bg-tile-green-soft text-tile-green',
  amber: 'bg-tile-amber-soft text-tile-amber',
  blue: 'bg-tile-blue-soft text-tile-blue',
  purple: 'bg-tile-purple-soft text-tile-purple',
  slate: 'bg-sunken text-ink-soft',
}

/** A pill: soft fill, strong text. */
export const toneChip: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand',
  red: 'bg-danger-soft text-danger',
  green: 'bg-in-soft text-in',
  amber: 'bg-warn-soft text-warn',
  blue: 'bg-tile-blue-soft text-tile-blue',
  purple: 'bg-tile-purple-soft text-tile-purple',
  slate: 'bg-sunken text-ink-soft',
}

/** Text only — a figure that carries the state's colour. */
export const toneText: Record<Tone, string> = {
  brand: 'text-brand',
  red: 'text-danger',
  green: 'text-in',
  amber: 'text-warn',
  blue: 'text-tile-blue',
  purple: 'text-tile-purple',
  slate: 'text-ink',
}

export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface'

/** The white card every block of the new frame sits in. */
export const frameCard = 'rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.04)]'
