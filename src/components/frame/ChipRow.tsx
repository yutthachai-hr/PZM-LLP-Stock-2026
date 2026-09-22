import { focusRing } from './tones'

/**
 * A row of round chips — "ทั้งหมด (128)" "วัตถุดิบ (42)" … — the chosen one filled with the
 * brand colour. On a phone the row scrolls sideways instead of wrapping into four lines of
 * chips above the list it filters.
 */
export interface Chip<K extends string> {
  key: K
  label: string
  count?: number
}

export function ChipRow<K extends string>({
  chips,
  value,
  onChange,
  label,
}: {
  chips: Chip<K>[]
  value: K
  onChange: (key: K) => void
  /** Names the group for a screen reader. */
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible"
    >
      {chips.map((c) => {
        const on = c.key === value
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.key)}
            className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 ${focusRing} ${
              on
                ? 'border-brand bg-brand text-white'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {c.label}
            {c.count !== undefined && <span className="num ml-1">({c.count})</span>}
          </button>
        )
      })}
    </div>
  )
}
