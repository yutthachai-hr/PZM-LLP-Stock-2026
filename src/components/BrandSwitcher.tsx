import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBrand } from '../brand/BrandContext'
import { BRANDS, brandDef, type BrandDef, type BrandId } from '../brand/brand'
import { useBrandSwitch } from '../brand/useBrandSwitch'
import { useT } from '../i18n/I18nContext'
import { focusRing } from './frame/tones'
import { Icon } from './Icon'
import { Modal } from './ui'

/**
 * Which company's books are open, and the way to the other two (owner, 9 Oct 2026): the
 * brand's own round logo at the top of the menu opens a short list of the three brands.
 * It replaces the "สลับแบรนด์" button and the full-screen picker for everyday switching.
 *
 * `sidebar` (desktop): the logo, name and "The Inventory OS" as the trigger, the list
 * dropping below it. `compact` (tablet and phone, in the top bar): the logo alone, the list
 * in a sheet. Opening either reads nothing; only choosing another brand does (see
 * brand/useBrandSwitch.ts for what is checked first).
 */
export function BrandSwitcher({ variant, tag }: { variant: 'sidebar' | 'compact'; /** A small badge on the subtitle line (Cloud / demo). */ tag?: ReactNode }) {
  const t = useT()
  const { brand } = useBrand()
  const { switchTo, busy } = useBrandSwitch()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const def = brand ? brandDef(brand) : null

  async function pick(id: BrandId) {
    if (id === brand) {
      setOpen(false)
      return
    }
    setOpen(false)
    const switched = await switchTo(id)
    // Not switched (cancelled or refused): back to where the person was.
    if (!switched) trigger.current?.focus()
  }

  const label = def ? t('แบรนด์: {name} — เปลี่ยนแบรนด์', { name: def.name }) : t('เลือกแบรนด์')

  if (variant === 'compact')
    return (
      <>
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={label}
          disabled={!!busy}
          className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:opacity-60 ${focusRing}`}
        >
          {def && <BrandMark def={def} size={34} active />}
        </button>
        <BrandSheet open={open} onClose={() => setOpen(false)} />
      </>
    )

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={!!busy}
        className={`group flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition-colors duration-150 hover:bg-sunken disabled:cursor-wait ${focusRing}`}
      >
        {def && <BrandMark def={def} size={40} active />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words font-bold leading-tight text-brand" title={def?.name}>
            {def?.name ?? 'Stock'}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-faint">
            The Inventory OS
            {tag}
          </span>
        </span>
        {busy ? (
          <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-brand motion-reduce:animate-none" />
        ) : (
          <Icon
            name="chevronDown"
            size={16}
            className={`shrink-0 text-ink-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {open && (
        <Dropdown
          id={listId}
          current={brand}
          busy={busy}
          onPick={(id) => void pick(id)}
          onClose={(refocus) => {
            setOpen(false)
            if (refocus) trigger.current?.focus()
          }}
          trigger={trigger}
        />
      )}
    </div>
  )
}

/**
 * The three brands in a sheet — from the bottom on a phone, the side on a tablet. Used by the
 * compact switcher and by the phone's "เพิ่มเติม" page. Focus returns to whatever opened it.
 */
export function BrandSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const { brand } = useBrand()
  const { switchTo, busy } = useBrandSwitch()
  async function pick(id: BrandId) {
    onClose()
    if (id !== brand) await switchTo(id)
  }
  if (!open) return null
  // Into the page's body: opened from the top bar, the sheet would otherwise sit inside the
  // bar's stacking layer (sticky, z-30), under the phone's tab bar and its + button.
  return createPortal(
    <Modal open onClose={onClose} title={t('เลือกแบรนด์')} sheet compact>
      <div className="px-3 py-3">
        <BrandList current={brand} busy={busy} onPick={(id) => void pick(id)} roomy />
        <WebsiteLink current={brand} />
      </div>
    </Modal>,
    document.body,
  )
}

/** The panel under the sidebar trigger: arrow keys, Home/End, Enter; Escape or a click outside closes it. */
function Dropdown({
  id,
  current,
  busy,
  onPick,
  onClose,
  trigger,
}: {
  id: string
  current: BrandId | null
  busy: BrandId | null
  onPick: (id: BrandId) => void
  onClose: (refocus: boolean) => void
  trigger: React.RefObject<HTMLButtonElement | null>
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Land on the open brand, so Enter straight away changes nothing.
    const items = panel.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]')
    const at = Math.max(0, BRANDS.findIndex((b) => b.id === current))
    items?.[at]?.focus()
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return
      onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onKeyDown(e: KeyboardEvent) {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      items[(n + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      // The top layer only: a dialog underneath stays open.
      e.stopPropagation()
      onClose(true)
    } else if (e.key === 'Tab') onClose(false)
  }

  return (
    <div
      ref={panel}
      id={id}
      role="menu"
      aria-label={t('เลือกแบรนด์')}
      onKeyDown={onKeyDown}
      className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border border-line bg-surface p-1.5 shadow-xl motion-safe:animate-[pzm-pop_140ms_ease-out]"
    >
      <BrandList current={current} busy={busy} onPick={onPick} />
      <WebsiteLink current={current} />
    </div>
  )
}

/** The three brands, the open one marked. */
function BrandList({
  current,
  busy,
  onPick,
  roomy,
}: {
  current: BrandId | null
  busy: BrandId | null
  onPick: (id: BrandId) => void
  roomy?: boolean
}) {
  const t = useT()
  return (
    <div role="group" className="space-y-0.5">
      {BRANDS.map((b) => {
        const selected = b.id === current
        return (
          <button
            key={b.id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            data-brand-option={b.id}
            disabled={!!busy}
            onClick={() => onPick(b.id)}
            className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left outline-none transition-colors duration-150 disabled:cursor-wait focus-visible:ring-2 focus-visible:ring-brand/40 ${
              roomy ? 'min-h-14' : 'min-h-12'
            } ${selected ? 'bg-brand-soft' : 'hover:bg-sunken focus-visible:bg-sunken'}`}
          >
            <BrandMark def={b} size={roomy ? 36 : 32} active={selected} />
            <span className="min-w-0 flex-1">
              <span className={`line-clamp-2 break-words text-sm leading-snug ${selected ? 'font-bold text-ink' : 'font-medium text-ink-soft group-hover:text-ink'}`} title={b.name}>
                {b.name}
              </span>
              {selected && <span className="block text-[11px] text-ink-faint">{t('แบรนด์ที่เปิดอยู่')}</span>}
            </span>
            {busy === b.id ? (
              <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-brand motion-reduce:animate-none" />
            ) : selected ? (
              <Icon name="check" size={18} className="shrink-0" style={{ color: b.accent }} />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** The brand's own website, as its own clearly named link — the logo no longer goes there. */
function WebsiteLink({ current }: { current: BrandId | null }) {
  const t = useT()
  const def = current ? brandDef(current) : null
  if (!def?.website) return null
  return (
    <a
      href={def.website}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-1 flex min-h-10 items-center gap-2 rounded-lg border-t border-line px-2.5 pt-1 text-xs text-ink-faint hover:text-ink ${focusRing}`}
    >
      <Icon name="globe" size={14} />
      {t('เปิดเว็บไซต์ {name}', { name: def.name })}
    </a>
  )
}

/** The round logo, ringed in the brand's own colour when it is the open one. */
function BrandMark({ def, size, active }: { def: BrandDef; size: number; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative shrink-0 rounded-full transition-transform duration-150 motion-safe:group-hover:scale-105 ${active ? 'ring-2 ring-offset-2 ring-offset-surface' : ''}`}
      style={active ? ({ ['--tw-ring-color' as string]: def.accentVivid } as React.CSSProperties) : undefined}
    >
      <img src={def.logo} alt="" width={size} height={size} className="block rounded-full" draggable={false} />
    </span>
  )
}
