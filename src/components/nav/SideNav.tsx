import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useBrand } from '../../brand/BrandContext'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { FoldIcon } from './FoldIcon'
import { NAV_GROUPS, navMatches, navSections, type NavGroup, type NavItem } from './navItems'

/**
 * The desktop sidebar's menu (owner, 25 Sep 2026). Each section is a bar the size of a page
 * of its own, in the same light type, with its own picture, that folds open onto its pages
 * as two-column tiles; the brand's pizza slice or baguette stands in for the chevron.
 * The page you are on stays lit; anything under the pointer takes the brand tint too.
 *
 * Which sections are folded is remembered on this device. The section holding the page you
 * are on opens by itself, and while folded its bar is tinted, so the lit page is never lost.
 */
export function SideNav({ items, badges }: { items: NavItem[]; badges: Partial<Record<string, number>> }) {
  const t = useT()
  const { pathname } = useLocation()
  const { brand } = useBrand()
  const [closed, setClosed] = useState<NavGroup[]>(readClosed)
  const here = items.find((n) => navMatches(pathname, n.to))?.group

  // Arriving on a page (a link, the "+" sheet, the back button) opens its section.
  useEffect(() => {
    if (here) setClosed((c) => (c.includes(here) ? c.filter((g) => g !== here) : c))
  }, [here])

  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(closed))
    } catch {
      // Private window or blocked storage: the menu still works, it just forgets.
    }
  }, [closed])

  const toggle = (g: NavGroup) => setClosed((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g]))

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label={t('เมนูหลัก')}>
      {navSections(items).map((s, i) => {
        if (!s.group) {
          return (
            <div key={s.items[0].to} className={`space-y-1 ${i > 0 ? '!mt-3 border-t border-line pt-3' : ''}`}>
              {s.items.map((item) => (
                <NavRow key={item.to} item={item} badge={badges[item.to] ?? 0} />
              ))}
            </div>
          )
        }
        const group = s.group
        const open = !closed.includes(group)
        const holdsHere = !open && here === group
        const panel = `nav-section-${group}`
        return (
          <section key={group}>
            <button
              type="button"
              onClick={() => toggle(group)}
              aria-expanded={open}
              aria-controls={panel}
              className={`${rowBase} w-full cursor-pointer font-medium ${holdsHere ? 'bg-brand-soft/60 text-brand' : `text-ink-soft ${hover}`}`}
            >
              <Icon name={NAV_GROUPS[group].icon} />
              <span className="min-w-0 flex-1 truncate text-left">{t(NAV_GROUPS[group].label)}</span>
              <FoldIcon brand={brand} open={open} />
            </button>
            {/* Grid rows 0fr → 1fr animates to the content's own height; inert keeps a folded
                section's links out of the tab order. */}
            <div
              id={panel}
              inert={!open}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="grid grid-cols-2 gap-1.5 pb-2 pl-1 pt-1">
                  {s.items.map((item, j) => (
                    <NavTile key={item.to} item={item} wide={s.items.length % 2 === 1 && j === s.items.length - 1} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </nav>
  )
}

const CLOSED_KEY = 'pzm.nav.closed'

function readClosed(): NavGroup[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((g): g is NavGroup => typeof g === 'string' && g in NAV_GROUPS) : []
  } catch {
    return []
  }
}

const rowBase =
  'flex min-h-10 items-center gap-3 rounded-xl px-3.5 text-[15px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/40'
// Pointing at an entry tints it the way the lit page is, only lighter (owner, 25 Sep 2026).
const hover = 'hover:bg-brand-soft/60 hover:text-brand'
const lit = 'bg-brand-soft font-semibold text-brand ring-1 ring-inset ring-brand/20'

function NavRow({ item, badge }: { item: NavItem; badge: number }) {
  const t = useT()
  const { pathname } = useLocation()
  const on = navMatches(pathname, item.to)
  return (
    <Link
      to={item.to}
      aria-current={on ? 'page' : undefined}
      className={`${rowBase} font-medium ${on ? lit : `text-ink-soft ${hover}`}`}
    >
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      {badge > 0 && (
        <span className="num shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-bold leading-5 text-white">{badge}</span>
      )}
    </Link>
  )
}

/** A page inside a section: icon over a short label; the odd one out spans the row. */
function NavTile({ item, wide }: { item: NavItem; wide: boolean }) {
  const t = useT()
  const { pathname } = useLocation()
  const on = navMatches(pathname, item.to)
  return (
    <Link
      to={item.to}
      aria-current={on ? 'page' : undefined}
      title={t(item.label)}
      className={`flex items-center rounded-xl px-2 text-center text-[12.5px] leading-snug outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/40 ${
        wide ? 'col-span-2 min-h-10 flex-row justify-center gap-2' : 'min-h-[54px] flex-col justify-center gap-0.5 py-1'
      } ${on ? lit : `bg-sunken/60 font-medium text-ink-soft ${hover}`}`}
    >
      <Icon name={item.icon} size={19} />
      <span>{t(item.label)}</span>
    </Link>
  )
}
