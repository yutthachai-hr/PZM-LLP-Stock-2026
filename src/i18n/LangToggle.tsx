import { useI18n, type Lang } from './I18nContext'

const OPTS: { id: Lang; label: string }[] = [
  { id: 'th', label: 'ไทย' },
  { id: 'en', label: 'EN' },
]

/**
 * Two-state language switch. Used inside the app shell and on the pre-login screens,
 * so the language can be changed without an account.
 */
export function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n()
  return (
    <div
      role="group"
      aria-label="Language"
      className={`flex rounded-lg border border-line-strong bg-surface p-0.5 ${className}`}
    >
      {OPTS.map((o) => (
        <button
          key={o.id}
          onClick={() => setLang(o.id)}
          aria-pressed={lang === o.id}
          className={`min-h-9 flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            lang === o.id ? 'bg-brand text-white' : 'text-ink-soft hover:bg-sunken'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
