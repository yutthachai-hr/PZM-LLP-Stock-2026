import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'
import { toneIcon, type Tone } from './tones'

/**
 * The title block at the top of a screen, as the owner's mock-ups draw it: a 56px tinted
 * square with the page's icon, the name large, one grey line under it saying what the page
 * is for, and the page's actions at the right — the filled one last.
 *
 * `tone` colours the icon by what the screen DOES rather than by which brand is open:
 * receiving is inbound green, issuing is outbound red, adjusting is amber because it is a
 * correction. Someone who has walked away mid-document and come back can tell which form
 * they are on without reading it — which matters on a shared tablet where the last person
 * may have left something half-keyed. The old names (`in`/`out`/`warn`) still work.
 *
 * On a phone the top bar already says where you are, so the block is only its actions: a
 * heading, an icon and a sentence were a screen's worth of scrolling before the work.
 */
export type HeroTone = Tone | 'in' | 'out' | 'warn'

const legacy: Record<string, Tone> = { in: 'green', out: 'red', warn: 'amber' }

export function PageHero({
  icon,
  title,
  subtitle,
  tone = 'brand',
  actions,
}: {
  icon: IconName
  title: string
  subtitle?: ReactNode
  tone?: HeroTone
  actions?: ReactNode
}) {
  const t = legacy[tone] ?? (tone as Tone)
  return (
    <div className="flex flex-wrap items-center gap-3 md:gap-4">
      <span
        className={`hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl md:flex ${toneIcon[t]}`}
      >
        <Icon name={icon} size={28} />
      </span>
      <div className="hidden min-w-0 flex-1 md:block">
        <h1 className="text-balance text-2xl font-bold leading-tight text-ink xl:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap gap-2 md:w-auto md:justify-end">{actions}</div>
      )}
    </div>
  )
}
