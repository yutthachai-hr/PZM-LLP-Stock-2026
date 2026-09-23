import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

/** Width of the panel (w-52) and the margin kept from the edge of the screen. */
const WIDTH = 208
const GUTTER = 8

export function RowMenu({ items, label }: { items: RowMenuItem[]; label?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  /**
   * Where the panel goes, in the screen's own coordinates.
   *
   * It hangs from the button, right edges aligned, and flips above when there is no room
   * below — kept inside the screen either way. The panel is in a portal and positioned
   * `fixed` because the table it belongs to scrolls: as a child of that box the menu was
   * cut off at the edge and stretched the box into scrolling instead, which took the rows
   * themselves out of view (owner, 23 Sep 2026: "ดรอปดาวน์ไม่ถูกต้อง").
   */
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect()
    if (!b) return
    const height = panel.current?.offsetHeight ?? 0
    const below = b.bottom + 4
    const above = b.top - 4 - height
    const room = below + height <= window.innerHeight - GUTTER
    const top = room || above < GUTTER ? below : above
    // Clamped into the screen either way: the row can be scrolled half out of view, and a
    // menu hanging off the bottom edge is one nobody can reach.
    const lowest = Math.max(GUTTER, window.innerHeight - height - GUTTER)
    setAt({
      top: Math.min(Math.max(GUTTER, top), lowest),
      left: Math.min(Math.max(GUTTER, b.right - WIDTH), window.innerWidth - WIDTH - GUTTER),
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return setAt(null)
    place()
  }, [open, items.length, place])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (button.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    // Anything that moves the row moves the menu away from it, and a menu floating beside
    // the wrong row is worse than no menu: close on any scroll, the table's included
    // (capture, because a scrolling box does not bubble its scroll to the window).
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    // The row itself may be clickable; a press on its menu is not a press on the row.
    <div className="inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? t('ตัวเลือกเพิ่มเติม')}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink ${focusRing}`}
      >
        <Icon name="moreVertical" size={18} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: at?.top ?? 0, left: at?.left ?? 0, width: WIDTH }}
            className={`fixed z-50 rounded-xl border border-line bg-surface p-1.5 shadow-xl ${
              at ? '' : 'invisible'
            }`}
          >
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
          </div>,
          document.body,
        )}
    </div>
  )
}
