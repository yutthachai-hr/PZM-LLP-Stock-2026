import { useRef } from 'react'
import { Icon } from './Icon'
import { dateInputToMs, formatThaiDate } from '../lib/format'
import { useT } from '../i18n/I18nContext'

/**
 * A date that reads the way the rest of the app writes one — "24/09/2569" — with the
 * browser's own calendar behind it.
 *
 * A plain `<input type="date">` shows whatever the device's locale says: on the shared
 * tablets that was "09/24/2026" beside "24/09/69" in the lists, and a day and a month
 * swapped is exactly the mistake a receiving date must not invite (owner, 24 Sep 2026).
 * So the field shows the date through formatThaiDate, and pressing it opens the native
 * picker; the value stays the same YYYY-MM-DD string every form already stores.
 */
export function ThaiDateField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
}: {
  /** YYYY-MM-DD, as `<input type="date">` gives it. Empty shows the placeholder. */
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  ariaLabel?: string
}) {
  const t = useT()
  const picker = useRef<HTMLInputElement>(null)

  function open() {
    const el = picker.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      // Older browsers: focusing the (invisible) field is the best there is.
      el.focus()
      el.click()
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={open}
        aria-label={ariaLabel}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      >
        <span className={value ? 'num' : 'text-ink-faint'}>{value ? formatThaiDate(dateInputToMs(value)) : t('เลือกวันที่')}</span>
        <Icon name="calendar" size={17} className="shrink-0 text-ink-soft" />
      </button>
      {/* The real field, under the button so the picker opens where the person pressed. */}
      <input
        ref={picker}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
      />
    </div>
  )
}
