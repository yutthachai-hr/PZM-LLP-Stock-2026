import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { EN } from './en'

// ---------------------------------------------------------------------------
// Translation, gettext-style: the Thai copy IS the lookup key.
//
// Thai was the app's only language for its whole life, so keying off it means
// retrofitting a screen is just wrapping strings in t() — no inventing a thousand
// key names, and no screen can render a raw "products.title" if a key is missed:
// an untranslated string falls back to the Thai it was written as.
//
// The trade-off: editing Thai copy silently drops its English. Run
// `npm run i18n:check` to list strings that reached t() without an EN entry.
// ---------------------------------------------------------------------------

export type Lang = 'th' | 'en'

/** Interpolates {name} placeholders so counts/names stay out of the phrase table. */
export type TFn = (thai: string, vars?: Record<string, string | number>) => string

interface I18nState {
  lang: Lang
  setLang: (l: Lang) => void
  t: TFn
}

const LS_KEY = 'pmstock:lang'
const Ctx = createContext<I18nState | null>(null)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved === 'th' || saved === 'en') return saved
  } catch {
    /* ignore */
  }
  return 'th'
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, key) => {
    const v = vars[key]
    return v === undefined ? whole : String(v)
  })
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(LS_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])

  const t = useCallback<TFn>(
    (thai, vars) => fill(lang === 'en' ? (EN[thai] ?? thai) : thai, vars),
    [lang],
  )

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export function useI18n(): I18nState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

/** Shorthand for the common case of only needing the translate function. */
export function useT(): TFn {
  return useI18n().t
}
