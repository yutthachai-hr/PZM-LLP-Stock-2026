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
      className={`flex rounded-lg border border-slate-300 p-0.5 ${className}`}
    >
      {OPTS.map((o) => (
        <button
          key={o.id}
          onClick={() => setLang(o.id)}
          aria-pressed={lang === o.id}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            lang === o.id ? 'bg-red-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
