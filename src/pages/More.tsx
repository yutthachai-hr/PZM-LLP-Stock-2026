import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { Icon } from '../components/Icon'
import { NAV_GROUPS, moreItemsFor, navSections } from '../components/nav/navItems'
import { useI18n, useT } from '../i18n/I18nContext'

/**
 * The rest of the menu on a phone (spec §1, 21 Sep 2026): what the tab bar and the "+"
 * do not carry, then the account actions the sidebar's foot has on a desktop.
 */
export function MorePage() {
  const t = useT()
  const { lang, setLang } = useI18n()
  const { user, logout } = useAuth()
  const { brand, reset } = useBrand()
  const def = brand ? brandDef(brand) : null
  const row =
    'flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-sm text-ink outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40'
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <span className="text-3xl">{def?.emoji ?? '📦'}</span>
        <div className="min-w-0">
          <div className="truncate font-bold text-brand">{def?.name ?? ''}</div>
          <div className="text-xs text-ink-faint">
            {user?.name} · {user?.role === 'admin' ? t('ผู้ดูแลระบบ') : user?.role === 'manager' ? t('หัวหน้า') : t('พนักงาน')}
          </div>
        </div>
      </div>
      {/* The same sections as the desktop menu, each its own card. */}
      <nav className="space-y-4" aria-label={t('เพิ่มเติม')}>
        {navSections(moreItemsFor(user?.role)).map((s) => (
          <section key={s.group ?? s.items[0].to}>
            {s.group && <h2 className="mb-1.5 px-1 text-xs font-semibold text-ink-faint">{t(NAV_GROUPS[s.group].label)}</h2>}
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {s.items.map((n) => (
                <Link key={n.to} to={n.to} className={row}>
                  <Icon name={n.icon} size={20} className="text-ink-soft" />
                  <span className="flex-1">{t(n.label)}</span>
                  <Icon name="chevronRight" size={16} className="text-ink-faint" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        <button type="button" className={row} onClick={() => setLang(lang === 'th' ? 'en' : 'th')}>
          <Icon name="globe" size={20} className="text-ink-soft" />
          <span className="flex-1 text-left">{t('ภาษา')}</span>
          <span className="text-ink-soft">{lang === 'th' ? 'TH' : 'EN'}</span>
        </button>
        <button type="button" className={row} onClick={reset}>
          <Icon name="swap" size={20} className="text-ink-soft" />
          <span className="flex-1 text-left">{t('สลับแบรนด์')}</span>
        </button>
        <button type="button" className={`${row} text-danger`} onClick={() => void logout()}>
          <Icon name="logout" size={20} />
          <span className="flex-1 text-left">{t('ออกจากระบบ')}</span>
        </button>
      </div>
    </div>
  )
}
