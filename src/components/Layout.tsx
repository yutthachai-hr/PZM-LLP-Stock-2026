import type { ReactNode } from 'react'
import { useAutomation } from '../data/useAutomation'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useT } from '../i18n/I18nContext'
import { Icon } from './Icon'
import { isDemoMode } from '../firebase/config'
import { InstallHint } from '../pwa/InstallHint'
import { TopBar } from './TopBar'
import { useTodayEventCount } from '../data/useTodayEventCount'
import { Badge } from './ui'
import { navFor, navMatches, titleFor, type NavItem } from './nav/navItems'
import { BottomTabBar } from './nav/BottomTabBar'
import { NavRail } from './nav/NavRail'

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, mode } = useAuth()
  const { brand, reset } = useBrand()
  const t = useT()
  const location = useLocation()
  // The background jobs the cron Worker also runs — see data/useAutomation.ts.
  useAutomation()

  const def = brand ? brandDef(brand) : null
  const items = navFor(user?.role)
  // One read per session, shared with the calendar's own cache — see useTodayEventCount.
  const todayCount = useTodayEventCount(!!user)

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Sidebar (desktop, xl and up) — sticky so it stays put while the content scrolls.
          A tablet gets the rail, a phone the tab bar (spec, 21 Sep 2026). */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface xl:flex">
        <Brand mode={mode} def={def} />
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => (
            <NavItemLink
              key={item.to}
              item={item}
              badge={item.to === '/calendar' ? todayCount : 0}
            />
          ))}
        </nav>
        <UserBox
          name={user?.name ?? ''}
          role={user?.role ?? 'staff'}
          onLogout={() => void logout()}
          onSwitch={reset}
        />
      </aside>
      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={t(titleFor(location.pathname))} />

        {/* The page column is capped: a stock table stretched across a 27" monitor puts the
            product name and its quantity at opposite ends of the desk. */}
        {/* On a phone the tab bar is fixed over the bottom edge, so the page keeps that
            much clear below its last row (the demo pill sits above the bar too). */}
        <main className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 p-4 [padding-bottom:calc(var(--tabbar-h)+1rem)] sm:p-5 sm:[padding-bottom:calc(var(--tabbar-h)+1.25rem)] md:[padding-bottom:1.25rem] lg:p-6 lg:[padding-bottom:1.5rem]">
          <InstallHint />
          {/* On a desktop the page sits on one white sheet over the canvas (the owner's
              mock-up, 21 Sep 2026): the screen reads as one document with its sections
              inside it, rather than as loose boxes floating on grey. On a phone there is
              no room for a margin around a sheet, so the canvas is the page. */}
          {/* A page drawn in the 22 Sep frame (components/frame/FramePage) puts each block in
              its own white card on the canvas, so it gets no sheet — a card on a white sheet
              is white on white. Unconverted pages keep the sheet until their round. */}
          <div className="xl:min-h-full xl:rounded-2xl xl:border xl:border-line xl:bg-surface xl:p-6 xl:shadow-sm xl:has-[[data-frame]]:rounded-none xl:has-[[data-frame]]:border-0 xl:has-[[data-frame]]:bg-transparent xl:has-[[data-frame]]:p-0 xl:has-[[data-frame]]:shadow-none">
            {children}
          </div>
        </main>
      </div>
      <BottomTabBar />
    </div>
  )
}

function Brand({
  mode,
  def,
}: {
  mode: 'cloud' | 'local'
  def: { name: string; emoji: string } | null
}) {
  const t = useT()
  return (
    <div className="relative flex items-center gap-2.5 border-b border-line px-4 py-4">
      {/* The logo colour exactly as drawn, carried as a stripe rather than as text.
          Le Lapin's orange is 2.28:1 on white and would be unreadable set in type, but
          as a band of colour at the edge of vision it does the job the brand colour is
          for: saying which company's books are open. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-brand-vivid"
      />
      {/* The brand mark stays an emoji: it is the company's identity, at display size,
          and the owner chose 🍕 and 🥖 themselves. */}
      <span className="text-2xl leading-none">{def?.emoji ?? '📦'}</span>
      <div className="min-w-0">
        <div className="truncate font-bold leading-tight text-brand">
          {def?.name ?? 'Stock'}
        </div>
        {/* The company whose books are open, above the name of the system they are in. */}
        <div className="text-xs text-ink-faint">Inventory Pzm</div>
      </div>
      <div className="ml-auto">
        {/* A demo build is in local mode too, but the local badge reads as a network
            state — it is what the real app shows when the connection is down. A demo has
            to read as a different system, not a disconnected one. */}
        {isDemoMode() ? (
          <Badge color="red">{t('เดโม')}</Badge>
        ) : mode === 'cloud' ? (
          <Badge color="green">Cloud</Badge>
        ) : (
          <Badge color="amber">{t('ในเครื่อง')}</Badge>
        )}
      </div>
    </div>
  )
}

function NavItemLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
  const t = useT()
  const { pathname } = useLocation()
  const on = navMatches(pathname, item.to)
  return (
    <Link
      to={item.to}
      aria-current={on ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/40 ${
        on ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-soft hover:bg-sunken hover:text-ink'
      }`}
    >
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      {badge > 0 && (
        <span className="num shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-bold leading-5 text-white">
          {badge}
        </span>
      )}
    </Link>
  )
}

const sideAction =
  'inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong px-3 text-sm text-ink-soft outline-none transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40'

function UserBox({
  name,
  role,
  onLogout,
  onSwitch,
}: {
  name: string
  role: string
  onLogout: () => void
  onSwitch: () => void
}) {
  const t = useT()
  // "แก้ไขโปรไฟล์" lives only in the TopBar account menu (owner, 22 Sep 2026: one place,
  // not two) — this box keeps just the brand and session actions.
  return (
    <div className="border-t border-line p-3">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">
          {name.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{name}</div>
          <div className="text-xs text-ink-faint">
            {role === 'admin' ? t('ผู้ดูแลระบบ') : role === 'manager' ? t('หัวหน้า') : t('พนักงาน')}
          </div>
        </div>
      </div>
      <button onClick={onSwitch} className={sideAction}>
        <Icon name="swap" size={16} />
        {t('สลับแบรนด์')}
      </button>
      <button onClick={onLogout} className={`mt-2 ${sideAction}`}>
        <Icon name="logout" size={16} />
        {t('ออกจากระบบ')}
      </button>
    </div>
  )
}
