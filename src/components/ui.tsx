import { useEffect, useId, useRef } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useT } from '../i18n/I18nContext'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'

// `brand` resolves to the open brand's colour (see BrandContext), so Le Lapin stops
// borrowing Pizza Mania's red. Destructive actions keep their own red whatever the brand:
// "delete" must not change colour depending on which company you are in.
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:brightness-110',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  danger: 'bg-danger text-white hover:brightness-110',
  success: 'bg-in text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink',
}

/**
 * Interactive controls are at least 44px tall.
 *
 * The branches work off a shared tablet, standing up, often one-handed while holding a
 * delivery note — iOS asks for 44pt and Android for 48dp, and these were 36px. Hitting the
 * wrong row on a stock screen costs a correction and an audit trail entry.
 */
const control = 'min-h-11 rounded-lg px-4 text-sm font-medium'

// focus-visible, not focus: a mouse user clicking a button should not get a keyboard
// focus ring, but a keyboard user must never lose track of where they are.
const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface'

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 py-2 transition-[background-color,box-shadow,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${control} ${focusRing} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * A panel.
 *
 * `tone` exists because every section of every page used to be the same white rounded box
 * with the same border and the same shadow, which told the reader nothing about what
 * mattered. Now weight carries rank: `plain` for the ordinary majority, `raised` for the
 * one thing a page is actually about, `quiet` for supporting detail.
 */
export function Card({
  children,
  className = '',
  tone = 'plain',
}: {
  children: ReactNode
  className?: string
  tone?: 'plain' | 'raised' | 'quiet'
}) {
  const tones = {
    plain: 'border border-line bg-surface',
    raised: 'border border-line bg-surface shadow-md',
    quiet: 'border border-line/70 bg-sunken',
  }
  return <div className={`rounded-xl ${tones[tone]} ${className}`}>{children}</div>
}

export function Field({
  label,
  required,
  children,
  hint,
  className = '',
}: {
  label: string
  required?: boolean
  children: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-ink-soft">{hint}</span>}
    </label>
  )
}

// Same 44px floor as buttons — these are the fields staff key quantities into on a tablet.
const inputBase =
  'w-full min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:bg-sunken disabled:text-ink-soft'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input className={`${inputBase} ${className}`} {...rest} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea className={`${inputBase} ${className}`} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select className={`${inputBase} bg-surface ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Badge({
  children,
  color = 'slate',
}: {
  children: ReactNode
  color?: 'slate' | 'red' | 'green' | 'amber' | 'blue'
}) {
  const map = {
    slate: 'bg-sunken text-ink-soft ring-line',
    red: 'bg-out-soft text-out ring-out/20',
    green: 'bg-in-soft text-in ring-in/20',
    amber: 'bg-warn-soft text-warn ring-warn/20',
    blue: 'bg-brand-soft text-brand ring-brand/20',
  }
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${map[color]}`}
    >
      {children}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-ink-soft">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  side,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
  /**
   * Slide in from the right instead of appearing in the middle.
   *
   * Same dialog in every respect that matters — focus trap, Escape, overlay, focus
   * restore — only the geometry differs. A calendar entry is read alongside the calendar,
   * so covering the middle of the screen with it hides the thing it belongs to; a drawer
   * leaves the grid visible behind. On a phone there is no "beside", so it takes the
   * whole width.
   */
  side?: boolean
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // A dialog that is only a dialog visually: with no role, screen readers announced it as
  // ordinary page content; with no focus handling, Tab walked out of it into the page
  // behind, and Escape did nothing. None of that is visible to someone using a mouse,
  // which is why it survived this long.
  useEffect(() => {
    if (!open) return
    const returnTo = document.activeElement as HTMLElement | null

    // Focus the first thing worth landing on, so keyboard users start inside the dialog.
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)

    focusables()[0]?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Keep Tab inside: wrap at both ends rather than letting focus escape behind the
      // overlay, where clicking is blocked but tabbing was not.
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.current?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Put focus back where it was, so closing a dialog does not dump the caret at the
      // top of the page.
      returnTo?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className={
        side
          ? 'fixed inset-0 z-50 flex justify-end overscroll-contain bg-ink/50 backdrop-blur-[2px]'
          : 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-ink/50 p-4 backdrop-blur-[2px] sm:items-center'
      }
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          side
            ? 'flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface shadow-2xl'
            : `w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-surface shadow-2xl`
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          <h3 id={titleId} className="text-balance text-lg font-bold text-ink">
            {title}
          </h3>
          <button
            onClick={onClose}
            className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-sunken hover:text-ink ${focusRing}`}
            aria-label={t("ปิด")}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

/**
 * The title block at the top of a screen.
 *
 * `tone` colours the icon by what the screen DOES rather than by which brand is open:
 * receiving is inbound green, issuing is outbound red, adjusting is amber because it is a
 * correction. Someone who has walked away mid-document and come back can tell which form
 * they are on without reading it — which matters on a shared tablet where the last person
 * may have left something half-keyed.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  tone = 'brand',
  actions,
}: {
  icon: IconName
  title: string
  subtitle?: string
  tone?: 'brand' | 'in' | 'out' | 'warn'
  actions?: ReactNode
}) {
  const tones = {
    brand: 'bg-brand-soft text-brand',
    in: 'bg-in-soft text-in',
    out: 'bg-out-soft text-out',
    warn: 'bg-warn-soft text-warn',
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
      >
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-balance text-xl font-bold leading-tight text-ink sm:text-2xl">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">{actions}</div>
      )}
    </div>
  )
}

/**
 * The class for a text action at the end of a list row — "แก้ไข", "ลบ", "ปิดใช้".
 *
 * These were bare <button> text at 20px tall. They sit inches from each other in the
 * locations and users lists, and one of them deletes a location, so the tap has to be
 * hard to get wrong. The negative margin keeps the row's visual rhythm while the hit
 * area grows to 44px.
 */
export const rowAction =
  `-my-2 inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`

/**
 * One option in a segmented control.
 *
 * The dashboard's location scope, Issue's transfer/consume switch and Reports' report
 * kind were three copies of the same twelve lines, all 32px tall — below the floor for a
 * control someone taps standing at a bench with a box in the other hand. One copy, 40px,
 * and a focus ring that works for a keyboard.
 */
export function SegTab({
  label,
  active,
  onClick,
  grow = true,
}: {
  label: string
  active: boolean
  onClick: () => void
  /** Fill the group evenly. Off when the options are a variable-length list. */
  grow?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-10 cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${grow ? 'flex-1' : ''} ${focusRing} ${
        active ? 'bg-surface text-brand shadow-sm' : 'text-ink-soft hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * The heading of a section inside a page.
 *
 * Settings is five stacked cards and every one of them used to open with the same
 * `font-semibold` line, so finding "backup" meant reading all five. The icon gives each
 * section a shape to scan for, and `description` says what the section does so the
 * buttons underneath do not have to be read to find out.
 */
export function SectionHeader({
  icon,
  title,
  description,
  badge,
  actions,
}: {
  icon: IconName
  title: string
  description?: string
  badge?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-soft">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold leading-tight text-ink">{title}</h2>
          {badge}
        </div>
        {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">{actions}</div>
      )}
    </div>
  )
}

/**
 * The commit bar for a keying form.
 *
 * On a phone it sticks to the bottom of the viewport, because the forms in this app run
 * longer than a screen once a few lines are on them and the save button would otherwise
 * sit below the fold — with the person scrolling back down to find it after every line.
 * `env(safe-area-inset-bottom)` keeps it clear of the home indicator.
 */
export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-2 flex justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-filter-none [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] sm:[padding-bottom:0]">
      {children}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: IconName
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      {icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-faint">
          <Icon name={icon} size={24} />
        </span>
      )}
      <div className="font-medium text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm leading-relaxed text-ink-soft">{hint}</div>}
    </div>
  )
}

/**
 * A card's title, with room for one action on the right.
 *
 * Lighter than SectionHeader, which carries an icon chip and a description and is built for
 * a settings panel. A panel on a dashboard usually needs a name and a way out of it.
 */
export function CardTitle({
  title,
  action,
  className = '',
}: {
  title: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {action}
    </div>
  )
}

/**
 * One figure in a row of figures.
 *
 * The number leads and the label follows, because the row is read at a glance and the
 * numbers are what someone is glancing at. Figures are tabular so a value that updates does
 * not shuffle the ones beside it sideways.
 *
 * The icon sits in a tinted chip rather than beside the label. At the size these appear it
 * is the fastest thing on the card to tell apart, which is what carries the row when four of
 * them sit in a line and the labels are all about the same length.
 */
export function StatTile({
  icon,
  label,
  value,
  hint,
  tone = 'plain',
}: {
  icon: IconName
  label: string
  value: string
  hint?: string
  tone?: 'plain' | 'brand' | 'in' | 'out' | 'warn'
}) {
  const chips = {
    plain: 'bg-sunken text-ink-soft',
    brand: 'bg-brand-soft text-brand',
    in: 'bg-in-soft text-in',
    out: 'bg-out-soft text-out',
    warn: 'bg-warn-soft text-warn',
  }
  const values = {
    plain: 'text-ink',
    brand: 'text-ink',
    in: 'text-in',
    out: 'text-out',
    warn: 'text-warn',
  }
  return (
    <div className="flex min-w-0 items-center gap-3 px-1 py-1">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chips[tone]}`}
      >
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0">
        <div className={`num truncate text-xl font-bold leading-tight ${values[tone]}`}>
          {value}
        </div>
        <div className="truncate text-xs text-ink-soft">{label}</div>
        {hint && <div className="truncate text-xs text-ink-faint">{hint}</div>}
      </div>
    </div>
  )
}

/**
 * A card holding a row of StatTiles, divided.
 *
 * One card rather than one card per figure: four separate boxes read as four separate
 * things, and these are four readings of the same thing. The dividers only appear once the
 * tiles are actually side by side — stacked on a phone they would be horizontal rules
 * between unrelated lines.
 */
export function StatGroup({
  title,
  action,
  children,
  columns = 4,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  columns?: 2 | 3 | 4
}) {
  const grid = {
    2: 'sm:grid-cols-2 sm:divide-x',
    3: 'sm:grid-cols-2 xl:grid-cols-3 sm:divide-x',
    4: 'sm:grid-cols-2 xl:grid-cols-4 sm:divide-x',
  }
  return (
    <Card className="p-4">
      {title && <CardTitle title={title} action={action} className="mb-3" />}
      <div className={`grid grid-cols-1 gap-3 divide-y divide-line sm:gap-0 sm:divide-y-0 sm:divide-line ${grid[columns]}`}>
        {children}
      </div>
    </Card>
  )
}
