import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../Icon'
import { focusRing, frameCard, toneIcon, toneText, type Tone } from './tones'

/**
 * One figure on a row of figures, as the owner's mock-ups draw it: a white card with a
 * pastel circle, a small label, the number large, and one line underneath that either
 * compares it with the period before ("↑ +12% จากเมื่อวาน") or puts it in proportion
 * ("71.9% ของทั้งหมด").
 *
 * The comparison is optional on purpose. A number the ledger cannot honestly compare
 * (the window does not reach back far enough) shows no line at all rather than a made-up
 * one — see lib/stats/periodCompare.
 *
 * A tile with `to` carries the arrow the mock-up draws in its corner and is a link; one with
 * `onClick` is a filter (Products' "ใกล้หมด" tile) and shows `selected` with the brand tint.
 */
export interface Trend {
  // Shown as written after the arrow: "+12%", "+2 รายการ".
  text: string
  up: boolean
  /** Whether going up is good news. Stock value up is green; low-stock count up is red. */
  goodWhenUp?: boolean
  // Words after the figure, in grey: "จากเมื่อวาน".
  suffix?: string
}

export function StatTile({
  icon,
  label,
  value,
  unit,
  tone = 'brand',
  valueTone,
  trend,
  hint,
  to,
  onClick,
  selected,
}: {
  icon: IconName
  label: string
  value: ReactNode
  // Smaller, after the number: "รายการ".
  unit?: string
  tone?: Tone
  // Colour the number (and label) with the state, as the mock-up does for ใกล้หมด/หมด.
  valueTone?: Tone
  trend?: Trend
  hint?: ReactNode
  to?: string
  onClick?: () => void
  selected?: boolean
}) {
  const good = trend ? (trend.goodWhenUp ?? true) === trend.up : true
  const body = (
    <>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${toneIcon[tone]}`}>
        <Icon name={icon} size={22} />
      </span>
      <div className={`min-w-0 flex-1 ${to ? 'pr-3' : ''}`}>
        <div className={`line-clamp-2 text-[13px] font-medium leading-snug ${valueTone ? toneText[valueTone] : 'text-ink-soft'}`}>
          {label}
        </div>
        <div className={`num mt-0.5 truncate text-2xl font-bold leading-tight ${valueTone ? toneText[valueTone] : 'text-ink'}`}>
          {value}
          {unit && <span className="ml-1.5 text-base font-semibold">{unit}</span>}
        </div>
        {trend ? (
          <div className="mt-1 flex items-center gap-1 truncate text-xs">
            <span className={`inline-flex items-center gap-0.5 font-semibold ${good ? 'text-in' : 'text-danger'}`}>
              <Icon name={trend.up ? 'arrowUp' : 'arrowDown'} size={13} />
              <span className="num">{trend.text}</span>
            </span>
            {trend.suffix && <span className="truncate text-ink-faint">{trend.suffix}</span>}
          </div>
        ) : (
          hint && <div className="mt-1 truncate text-xs text-ink-faint">{hint}</div>
        )}
      </div>
      {to && (
        <span className="absolute bottom-3 right-3 text-brand" aria-hidden>
          <Icon name="arrowRight" size={16} />
        </span>
      )}
    </>
  )
  const shell = `relative flex min-w-0 items-center gap-3 p-4 text-left transition-colors duration-150 ${frameCard} ${
    selected ? '!border-brand/30 !bg-brand-soft' : ''
  }`
  if (to)
    return (
      <Link to={to} className={`${shell} hover:border-line-strong ${focusRing}`}>
        {body}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-pressed={selected} className={`${shell} cursor-pointer hover:border-line-strong ${focusRing}`}>
        {body}
      </button>
    )
  return <div className={shell}>{body}</div>
}

/**
 * The row the tiles sit in. Desktop: all in one line (4 or 5). Tablet: two or three a row.
 * Phone: two columns that scroll with the page — never sideways (spec §1).
 */
export function StatRow({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 | 5 }) {
  const cols = {
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-2 lg:grid-cols-4',
    5: 'md:grid-cols-3 xl:grid-cols-5',
  }
  return <div className={`grid grid-cols-2 gap-3 xl:gap-4 ${cols[columns]}`}>{children}</div>
}
