import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useTodayEventCount } from '../../data/useTodayEventCount'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { ActionSheet } from './ActionSheet'
import { navFor, navMatches } from './navItems'

/**
 * The tablet's menu (spec §1, 21 Sep 2026): every page as an icon with a short word under
 * it, in a 72px rail that stays put in both orientations, with the "+" near the top. A
 * tablet has the width for it and not the height for a bottom bar; a phone has neither,
 * a desktop has room for the full sidebar.
 */
export function NavRail() {
  const t = useT()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { brand } = useBrand()
  const [sheet, setSheet] = useState(false)
  const todayCount = useTodayEventCount(!!user)
  const def = brand ? brandDef(brand) : null
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-stretch border-r border-line bg-surface md:flex xl:hidden">
        <div className="flex h-14 shrink-0 items-center justify-center border-b border-line text-2xl" title={def?.name ?? ''}>
          {def?.emoji ?? '📦'}
        </div>
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-label={t('ทำรายการ')}
          className="mx-auto my-3 flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand text-white shadow outline-none active:brightness-110 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Icon name="plus" size={26} />
        </button>
        <nav className="flex-1 overflow-y-auto py-1" aria-label={t('เมนูหลัก')}>
          {navFor(user?.role).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={navMatches(pathname, item.to) ? 'page' : undefined}
              className={`relative mx-1.5 my-0.5 flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center text-[10px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                navMatches(pathname, item.to) ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-soft hover:bg-sunken hover:text-ink'
              }`}
            >
              <Icon name={item.icon} size={22} />
              <span className="line-clamp-2">{t(item.label)}</span>
              {item.to === '/calendar' && todayCount > 0 && (
                <span className="num absolute right-1 top-1 rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-white">{todayCount}</span>
              )}
            </Link>
          ))}
        </nav>
      </aside>
      <ActionSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  )
}
