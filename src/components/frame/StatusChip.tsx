import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'
import { toneChip, type Tone } from './tones'

/**
 * A state, as a round pill with a round icon in front: ปกติ (green), ใกล้หมด (amber),
 * หมด (red), ส่งเข้า LINE แล้ว (green), ล่าช้า (red), ร่าง (grey).
 *
 * The icon defaults from the tone so the three stock states read by shape as well as by
 * colour — a tick, an exclamation, a cross — for anyone who does not tell green from red.
 */
const defaultIcon: Record<Tone, IconName> = {
  green: 'checkCircle',
  amber: 'alertCircle',
  red: 'xCircle',
  brand: 'info',
  blue: 'info',
  purple: 'info',
  slate: 'clock',
}

export function StatusChip({
  tone,
  children,
  icon,
  size = 'md',
}: {
  tone: Tone
  children: ReactNode
  /** `null` for a chip with no icon. */
  icon?: IconName | null
  size?: 'sm' | 'md'
}) {
  const glyph = icon === null ? null : (icon ?? defaultIcon[tone])
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ${toneChip[tone]} ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]'
      }`}
    >
      {glyph && <Icon name={glyph} size={size === 'sm' ? 13 : 15} />}
      {children}
    </span>
  )
}

// A quantity in a tinted pill — the "คงเหลือ" column of the dashboard's low-stock table.
export function QtyPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`num inline-flex min-w-12 justify-center rounded-full px-2.5 py-0.5 text-sm font-bold ${toneChip[tone]}`}>
      {children}
    </span>
  )
}
