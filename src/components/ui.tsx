import { useEffect, useId, useRef } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  WheelEvent,
} from 'react'
import { useT } from '../i18n/I18nContext'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'outline' | 'sheet' | 'pdf'

// `brand` resolves to the open brand's colour (see BrandContext), so Le Lapin stops
// borrowing Pizza Mania's red. Destructive actions keep their own red whatever the brand:
// "delete" must not change colour depending on which company you are in.
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:brightness-110',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  danger: 'bg-danger text-white hover:brightness-110',
  success: 'bg-in text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink',
  // The row actions in a list: quiet until pointed at, so a column of them reads as one
  // column rather than as a wall of buttons competing with the one filled action.
  outline: 'bg-surface text-ink-soft border border-line hover:border-line-strong hover:text-ink',
  // The two export buttons, tinted like the file each one makes (a green spreadsheet, a red
  // PDF) so they are told apart without reading. Tints, not fills: an export is not the
  // page's main action.
  sheet: 'bg-in-soft text-in border border-in/25 hover:border-in/50',
  pdf: 'bg-out-soft text-out border border-out/25 hover:border-out/50',
}

/**
 * Interactive controls are at least 44px tall.
 *
 * The branches work off a shared tablet, standing up, often one-handed while holding a
 * delivery note — iOS asks for 44pt and Android for 48dp, and these were 36px. Hitting the
 * wrong row on a stock screen costs a correction and an audit trail entry.
 */
const control = 'rounded-lg text-sm font-medium'
const sizes = {
  md: 'min-h-11 px-4',
  // Dense list rows on a desktop, where six actions share a row. Still 40px — the pointer
  // is a mouse there; on a phone the same actions render in the card at full size.
  sm: 'min-h-10 whitespace-nowrap px-3',
}

// focus-visible, not focus: a mouse user clicking a button should not get a keyboard
// focus ring, but a keyboard user must never lose track of where they are.
const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 py-2 transition-[background-color,border-color,color,box-shadow,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${control} ${sizes[size]} ${focusRing} ${variants[variant]} ${className}`}
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

/**
 * Stop a mouse wheel from editing a focused number field.
 *
 * A browser treats a scroll over a focused `type="number"` as a nudge to its value. Someone
 * keyed a quantity, scrolled the page to reach the save button, and the quantity they had
 * just checked silently became a different one. Blurring hands the scroll back to the page,
 * which is what the person meant by it.
 *
 * Exported so the handful of inputs that are written out by hand can use it too.
 */
export function blurOnWheel(e: WheelEvent<HTMLInputElement>): void {
  if (e.currentTarget.type === 'number') e.currentTarget.blur()
}

// React 19 passes `ref` to a function component like any other prop; it only has to be
// declared. The receiving screen uses it to put the cursor back after a save.
export function Input(
  props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> },
) {
  const { className = '', onWheel, ...rest } = props
  return (
    <input
      className={`${inputBase} ${className}`}
      onWheel={(e) => {
        blurOnWheel(e)
        onWheel?.(e)
      }}
      {...rest}
    />
  )
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
  sheet,
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
  /**
   * On a phone, rise from the bottom as a sheet instead of covering the screen from the
   * side — a thumb reaches the bottom, and the list behind stays half in view. At `sm`
   * and up it is the side drawer. Implies `side`.
   */
  sheet?: boolean
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Where the last mouse press began. A click "on the overlay" that started inside the
  // panel is somebody selecting text and letting go past its edge — the browser reports
  // that as a click on the common ancestor, which used to close the dialog and lose the
  // selection (the owner: "คลุมข้อความแล้วหลุดกรอบ มันหลุดเลย"). Only a press that both
  // begins and ends on the backdrop closes it.
  const pressedOnOverlay = useRef(false)

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
        sheet
          ? 'fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-ink/50 backdrop-blur-[2px] sm:items-stretch sm:justify-end'
          : side
            ? 'fixed inset-0 z-50 flex justify-end overscroll-contain bg-ink/50 backdrop-blur-[2px]'
            : 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-ink/50 p-4 backdrop-blur-[2px] sm:items-center'
      }
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnOverlay.current) onClose()
        pressedOnOverlay.current = false
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          sheet
            ? 'flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none'
            : side
              ? 'flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface shadow-2xl'
              : `w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-surface shadow-2xl`
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          {sheet && <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" />}
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
    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14 ${tones[tone]}`}
      >
        <Icon name={icon} size={26} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-balance text-2xl font-bold leading-tight text-ink sm:text-[1.75rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
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

/**
 * The status filter at the top of a list: one big tab per state, each with its count.
 *
 * The owner's mock-up (21 Sep 2026) put these as cards rather than as a row of small pills,
 * because the count is the reason someone opens the screen — "how many are still waiting" —
 * and a number inside a pill the size of a word was being read past. The icon's tint is the
 * state's own colour, so the tab reads before its label does.
 */
export interface StatusTabItem<K extends string> {
  key: K
  label: string
  icon: IconName
  count?: number
  tone?: 'brand' | 'in' | 'out' | 'warn' | 'plain'
}

export function StatusTabs<K extends string>({
  items,
  value,
  onChange,
}: {
  items: StatusTabItem<K>[]
  value: K
  onChange: (key: K) => void
}) {
  const chips = {
    brand: 'bg-brand-soft text-brand',
    in: 'bg-in-soft text-in',
    out: 'bg-out-soft text-out',
    warn: 'bg-warn-soft text-warn',
    plain: 'bg-sunken text-ink-soft',
  }
  return (
    <div role="tablist" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap sm:gap-3 sm:overflow-visible">
      {items.map((it) => {
        const on = it.key === value
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            className={`flex min-h-12 shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors duration-150 sm:min-w-40 sm:px-4 ${focusRing} ${
              on
                ? 'border-brand/30 bg-brand-soft text-brand shadow-sm'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                on ? 'bg-surface text-brand' : chips[it.tone ?? 'plain']
              }`}
            >
              <Icon name={it.icon} size={17} />
            </span>
            <span className="whitespace-nowrap">
              {it.label}
              {it.count !== undefined && <span className="num"> ({it.count})</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A line across the page that something needs doing — late deliveries, a failed sync.
 *
 * One shape for all of them, with the way to act on it at the right, so it is read as an
 * instruction rather than as decoration.
 */
export function AlertBanner({
  tone = 'danger',
  icon = 'warning',
  children,
  action,
}: {
  tone?: 'danger' | 'warn' | 'info'
  icon?: IconName
  children: ReactNode
  action?: ReactNode
}) {
  const tones = {
    danger: 'border-danger/30 bg-danger-soft text-danger',
    warn: 'border-warn/30 bg-warn-soft text-warn',
    info: 'border-brand/20 bg-brand-soft text-brand',
  }
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}
    >
      <Icon name={icon} size={20} className="shrink-0" />
      <div className="min-w-0 flex-1 font-medium">{children}</div>
      {action}
    </div>
  )
}

/** The small bordered button that sits at the right end of an AlertBanner. */
export const bannerAction = `inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-current/25 bg-surface px-3 text-sm font-medium ${focusRing}`

/** A search field with the magnifier inside it — the list pages' filter box. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        <Icon name="search" size={17} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputBase} pl-10`}
      />
    </div>
  )
}

/**
 * Page through a long list: where you are, how many at once, and the pages.
 *
 * Pair with `usePaged` (lib/usePaged). Hidden when everything fits on one page of the
 * smallest size, so a short list does not carry controls that do nothing.
 */
export function Pagination({
  page,
  pages,
  total,
  from,
  to,
  pageSize,
  onPage,
  onPageSize,
  sizes = [10, 20, 50, 100],
}: {
  page: number
  pages: number
  total: number
  from: number
  to: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  sizes?: number[]
}) {
  const t = useT()
  if (total <= sizes[0]) return null
  // First, last, and one either side of where you are — enough to jump without a row of
  // forty numbers.
  const shown = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - page) <= 1,
  )
  const btn = `inline-flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`
  return (
    <div className="flex flex-wrap items-center gap-3 px-1 pt-3 text-sm text-ink-soft">
      <span className="num">{t('แสดง {from} - {to} จาก {total} รายการ', { from, to, total })}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <select
          aria-label={t('จำนวนต่อหน้า')}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className={`${inputBase} min-h-10 w-auto py-1.5`}
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              {t('แสดง {n} รายการ', { n })}
            </option>
          ))}
        </select>
        <button
          className={`${btn} border-line bg-surface text-ink-soft hover:bg-sunken`}
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label={t('หน้าก่อน')}
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        {shown.map((n, i) => (
          <span key={n} className="contents">
            {i > 0 && n - shown[i - 1] > 1 && <span className="px-1 text-ink-faint">…</span>}
            <button
              className={`${btn} num ${
                n === page
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-surface text-ink-soft hover:bg-sunken'
              }`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          </span>
        ))}
        <button
          className={`${btn} border-line bg-surface text-ink-soft hover:bg-sunken`}
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label={t('หน้าถัดไป')}
        >
          <Icon name="chevronRight" size={18} />
        </button>
      </div>
    </div>
  )
}
