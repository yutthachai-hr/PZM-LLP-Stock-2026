import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { ActionSheet } from './ActionSheet'
import { isMoreRoute, TAB_ITEMS, type NavItem } from './navItems'

/**
 * The phone's navigation (spec §1, 21 Sep 2026): four places to look — home, stock,
 * history, more — and a "+" in the middle for the things a person does. Fixed to the
 * bottom, under the thumb, above the home indicator. Hidden from `md` up, where the
 * rail or the sidebar takes over.
 */
export function BottomTabBar() {
  const t = useT()
  const { pathname } = useLocation()
  const [sheet, setSheet] = useState(false)
  const more = isMoreRoute(pathname)

  function tab(item: NavItem) {
    const active =
      item.to === '/more'
        ? more
        : item.to === '/'
          ? pathname === '/'
          : !more && (pathname === item.to || pathname.startsWith(`${item.to}/`))
    return (
      <Link
        key={item.to}
        to={item.to}
        className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
          active ? 'font-semibold text-brand' : 'text-ink-soft'
        }`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={item.icon} size={22} />
        <span>{t(item.label)}</span>
      </Link>
    )
  }

  return (
    <>
      <nav
        aria-label={t('เมนูหลัก')}
        className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--tabbar-h)] items-stretch border-t border-line bg-surface/95 backdrop-blur [padding-bottom:env(safe-area-inset-bottom)] md:hidden"
      >
        {tab(TAB_ITEMS[0])}
        {tab(TAB_ITEMS[1])}
        <div className="relative flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label={t('ทำรายการ')}
            className="absolute -top-5 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-brand text-white shadow-lg outline-none active:brightness-110 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon name="plus" size={28} />
          </button>
        </div>
        {tab(TAB_ITEMS[2])}
        {tab(TAB_ITEMS[3])}
      </nav>
      <ActionSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  )
}
