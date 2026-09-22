import type { ReactNode } from 'react'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { focusRing, frameCard } from './tones'

/**
 * The filter card at the top of a list: a wide search box, two or three labelled
 * dropdowns, and a red-outlined "รีเซ็ต" at the end (owner's mock-ups). Chips of categories
 * go underneath, inside the same card, as `below`.
 *
 * The layout is a grid, not a flex row, so the fields line up with each other on a tablet
 * where they wrap onto a second line — the spec asks for exactly that at 768–1279.
 */
export function FilterBar({
  search,
  children,
  onReset,
  resetDisabled,
  below,
}: {
  /** The search field — usually a SearchInput. Takes the widest column. */
  search?: ReactNode
  /** FilterField elements. */
  children?: ReactNode
  onReset?: () => void
  resetDisabled?: boolean
  below?: ReactNode
}) {
  return (
    <div className={`${frameCard} p-4`}>
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-6 xl:flex xl:flex-nowrap">
        {search && <div className="col-span-2 md:col-span-6 xl:min-w-0 xl:flex-[2]">{search}</div>}
        {children}
        {onReset && (
          <div className="col-span-2 md:col-span-2 xl:shrink-0">
            <ResetButton onClick={onReset} disabled={resetDisabled} />
          </div>
        )}
      </div>
      {below && <div className="mt-3">{below}</div>}
    </div>
  )
}

/** One labelled control in a FilterBar: the label sits above the field, small. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="col-span-1 block min-w-0 md:col-span-2 xl:flex-1">
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  )
}

export function ResetButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger/60 bg-surface px-5 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 xl:w-auto ${focusRing}`}
    >
      <Icon name="rotateCcw" size={16} />
      {t('รีเซ็ต')}
    </button>
  )
}
