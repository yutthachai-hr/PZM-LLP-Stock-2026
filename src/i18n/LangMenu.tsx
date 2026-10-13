import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useI18n, type Lang } from './I18nContext'
import { useT } from './I18nContext'

const LANGS: { id: Lang; label: string }[] = [
  { id: 'th', label: 'ไทย' },
  { id: 'en', label: 'English' },
]

/**
 * Accessible language dropdown with Lucide Globe icon.
 * Replaces the two-button segmented toggle on the pre-login page.
 */
export function LangMenu({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n()
  const t = useT()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const current = LANGS.find((l) => l.id === lang) ?? LANGS[0]

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('ภาษา')}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Icon name="globe" size={15} className="text-ink-soft" />
        <span>{current.label}</span>
        <Icon
          name="chevronDown"
          size={13}
          className={`text-ink-soft transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('ภาษา')}
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[130px] rounded-xl border border-line bg-surface p-1 shadow-lg ring-1 ring-black/5"
        >
          {LANGS.map((item) => {
            const isSelected = item.id === lang
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => {
                  setLang(item.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setLang(item.id)
                    setOpen(false)
                    triggerRef.current?.focus()
                  }
                }}
                className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors outline-none hover:bg-sunken focus:bg-sunken ${
                  isSelected ? 'bg-brand-soft font-bold text-brand' : 'text-ink'
                }`}
              >
                <span>{item.label}</span>
                {isSelected && <Icon name="check" size={14} className="shrink-0 text-brand" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
