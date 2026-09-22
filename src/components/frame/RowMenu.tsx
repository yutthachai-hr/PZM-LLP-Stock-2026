import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n/I18nContext'
import { Icon, type IconName } from '../Icon'
import { focusRing } from './tones'

/**
 * The `⋮` at the end of a table row: the row's less common actions in a small menu, so the
 * row itself carries one or two buttons instead of six.
 */
export interface RowMenuItem {
  key: string
  label: string
  icon?: IconName
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

export function RowMenu({ items, label }: { items: RowMenuItem[]; label?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    // The row itself may be clickable; a press on its menu is not a press on the row.
    <div ref={box} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? t('ตัวเลือกเพิ่มเติม')}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink ${focusRing}`}
      >
        <Icon name="moreVertical" size={18} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${
                it.danger ? 'text-danger' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {it.icon && <Icon name={it.icon} size={16} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
