import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n/I18nContext'
import { Icon, type IconName } from '../Icon'
import { focusRing, frameCard, toneText, type Tone } from './tones'

/**
 * A block of a page: a small brand-coloured icon, the name in bold (with an optional grey
 * count after it — "รายการสินค้า (128 รายการ)"), and the block's own controls at the right
 * — "ดูทั้งหมด →", a period dropdown, a view toggle.
 *
 * `flush` drops the body padding for a table that runs edge to edge under the heading.
 */
export function SectionCard({
  icon,
  title,
  count,
  tone = 'brand',
  actions,
  children,
  flush,
  className = '',
}: {
  icon?: IconName
  title: string
  count?: ReactNode
  tone?: Tone
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <section className={`${frameCard} ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-3 pt-4 md:px-5">
        {icon && <Icon name={icon} size={20} className={toneText[tone]} />}
        <h2 className="min-w-0 flex-1 text-base font-bold text-ink md:text-lg">
          {title}
          {count !== undefined && <span className="ml-1.5 whitespace-nowrap text-sm font-normal text-ink-soft">{count}</span>}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={flush ? '' : 'px-4 pb-4 md:px-5 md:pb-5'}>{children}</div>
    </section>
  )
}

// The red "ดูทั้งหมด →" at the right of a section heading.
export function SeeAll({ to, label }: { to: string; label?: string }) {
  const t = useT()
  return (
    <Link
      to={to}
      className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-1 text-sm font-medium text-brand hover:underline ${focusRing}`}
    >
      {label ?? t('ดูทั้งหมด')}
      <Icon name="arrowRight" size={16} />
    </Link>
  )
}
