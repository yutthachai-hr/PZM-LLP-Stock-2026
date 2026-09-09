import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
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
}: {
  label: string
  required?: boolean
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block">
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
    <select className={`${inputBase} bg-white ${className}`} {...rest}>
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
    <div className="flex items-center justify-center gap-3 p-8 text-slate-500">
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
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-ink/50 p-4 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-surface shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
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
