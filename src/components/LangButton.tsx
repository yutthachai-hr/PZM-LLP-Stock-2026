import { useI18n, useT } from '../i18n/I18nContext'
import { Icon } from './Icon'

/**
 * The language switch, as one control in the top bar.
 *
 * It used to render twice — once in the sidebar and once in the top bar — so on a desktop
 * two different controls did the same thing, and the sidebar copy was the only one a phone
 * ever saw, because the top-bar one was `md:` and up.
 *
 * A globe rather than a flag: one of the two languages is English, which is not a country.
 *
 * The label shows the language you are IN, and the tooltip says what tapping does. With
 * exactly two languages a toggle is one tap, where a menu would be two — but that makes
 * "TH" ambiguous on its own (is it the state or the button's effect?), which is what
 * `aria-label` and `title` are there to settle.
 *
 * This file lives in components/, not i18n/, on purpose: `scripts/i18n-check.mjs` skips
 * everything under `src/i18n/`, so a `t()` call in there is invisible to it — the key would
 * be reported as unused and a missing translation would never be caught.
 */
export function LangButton({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n()
  const t = useT()
  const next = lang === 'th' ? 'en' : 'th'
  const action = next === 'en' ? t('เปลี่ยนเป็นภาษาอังกฤษ') : t('เปลี่ยนเป็นภาษาไทย')

  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={action}
      title={action}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-ink-soft outline-none transition-colors duration-150 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
    >
      <Icon name="globe" size={19} />
      <span className="text-xs font-semibold">{lang === 'th' ? 'TH' : 'EN'}</span>
    </button>
  )
}
