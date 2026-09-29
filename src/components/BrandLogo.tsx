import type { BrandDef } from '../brand/brand'
import { useT } from '../i18n/I18nContext'

/**
 * The brand's own round logo (owner, 27 Sep 2026 — it replaced the 🍕 / 🥪 emoji), and a
 * link to the brand's website: tapping it opens the site in a new tab, leaving the app as
 * it was.
 */
export function BrandLogo({ def, size }: { def: BrandDef | null; size: number }) {
  const t = useT()
  if (!def) {
    return (
      <span className="shrink-0 leading-none" style={{ fontSize: size * 0.7 }}>
        📦
      </span>
    )
  }
  return (
    <a
      href={def.website}
      target="_blank"
      rel="noopener noreferrer"
      title={t('เปิดเว็บไซต์ {name}', { name: def.name })}
      aria-label={t('เปิดเว็บไซต์ {name}', { name: def.name })}
      className="shrink-0 rounded-full outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <img src={def.logo} alt="" width={size} height={size} className="block rounded-full" />
    </a>
  )
}
