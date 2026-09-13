import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useT } from '../i18n/I18nContext'
import { Icon, type IconName } from './Icon'
import { isDemoMode } from '../firebase/config'
import { InstallHint } from '../pwa/InstallHint'
import { TopBar } from './TopBar'
import { useTodayEventCount } from '../data/useTodayEventCount'
import { Badge } from './ui'

interface NavItem {
  to: string
  label: string
  icon: IconName
  adminOnly?: boolean
}

// Labels are translation keys — NavItemLink renders them through t(). i18n-key
const NAV: NavItem[] = [
  { to: '/', label: 'ภาพรวม', icon: 'dashboard' }, // i18n-key
  { to: '/products', label: 'สินค้าคงคลัง', icon: 'package' }, // i18n-key
  { to: '/receive', label: 'รับสินค้าเข้า', icon: 'receive' }, // i18n-key
  { to: '/issue', label: 'เบิก/โอนสาขา', icon: 'truck' }, // i18n-key
  { to: '/adjust', label: 'ปรับสต๊อก', icon: 'adjust' }, // i18n-key
  { to: '/calendar', label: 'ปฏิทินคลัง', icon: 'calendar' }, // i18n-key
  { to: '/movements', label: 'ประวัติ/Stock Card', icon: 'history' }, // i18n-key
  { to: '/reports', label: 'รายงาน', icon: 'report' }, // i18n-key
  { to: '/orders', label: 'สั่งซื้อ', icon: 'truck' }, // i18n-key
  { to: '/suppliers', label: 'ผู้ขาย', icon: 'users' }, // i18n-key
  { to: '/import', label: 'นำเข้า Excel', icon: 'upload', adminOnly: true }, // i18n-key
  { to: '/notes', label: 'บันทึกช่วยจำ', icon: 'note' }, // i18n-key
  { to: '/settings', label: 'ตั้งค่า', icon: 'settings' }, // i18n-key
]

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, mode } = useAuth()
  const { brand, reset } = useBrand()
  const t = useT()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const drawer = useRef<HTMLElement>(null)

  // Close the drawer on Escape and keep Tab inside it while it is open, matching Modal.
  useEffect(() => {
    if (!open) return
    const returnTo = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(
        drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      ).filter((el) => el.offsetParent !== null)
    focusables()[0]?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !drawer.current?.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      returnTo?.focus?.()
    }
  }, [open])

  const def = brand ? brandDef(brand) : null
  const items = NAV.filter((n) => !n.adminOnly || user?.role === 'admin')
  // One read per session, shared with the calendar's own cache — see useTodayEventCount.
  const todayCount = useTodayEventCount(!!user)

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Sidebar (desktop) — sticky so it stays put while the content scrolls */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand mode={mode} def={def} />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
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
          onLogout={logout}
          onSwitch={reset}
        />
      </aside>

      {/* Mobile drawer — same dialog treatment as Modal: it covers the page, so it has
          to announce itself, hold focus, and close on Escape. */}
      {open && (
        <div
          className="fixed inset-0 z-40 overscroll-contain lg:hidden"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-ink/50" />
          <aside
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label={t('เมนู')}
            className="absolute left-0 top-0 flex h-full w-72 flex-col bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Brand mode={mode} def={def} />
            <nav className="flex-1 space-y-1 overflow-y-auto p-3" onClick={() => setOpen(false)}>
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
          onLogout={logout}
          onSwitch={reset}
        />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenu={() => setOpen(true)}
          title={t(NAV.find((n) => n.to === location.pathname)?.label ?? '')}
        />

        {/* The page column is capped: a stock table stretched across a 27" monitor puts the
            product name and its quantity at opposite ends of the desk. */}
        {/* The demo pill is pinned to the bottom-left, so a demo build needs room under the
            last row for it to sit over nothing. */}
        <main
          className={`mx-auto w-full min-w-0 max-w-[1600px] flex-1 p-4 sm:p-5 lg:p-6 ${
            isDemoMode() ? 'pb-16 sm:pb-6' : ''
          }`}
        >
          <InstallHint />
          {children}
        </main>
      </div>
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
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/40 ${
          isActive
            ? 'bg-brand-soft text-brand'
            : 'text-ink-soft hover:bg-sunken hover:text-ink'
        }`
      }
    >
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      {badge > 0 && (
        <span className="num shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-bold leading-5 text-white">
          {badge}
        </span>
      )}
    </NavLink>
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
  return (
    <div className="border-t border-line p-3">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">
          {name.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{name}</div>
          <div className="text-xs text-ink-faint">
            {role === 'admin' ? t('ผู้ดูแลระบบ') : t('พนักงาน')}
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
