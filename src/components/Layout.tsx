import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useT } from '../i18n/I18nContext'
import { LangToggle } from '../i18n/LangToggle'
import { Badge } from './ui'

interface NavItem {
  to: string
  label: string
  icon: string
  adminOnly?: boolean
}

// Labels are translation keys — NavItemLink renders them through t(). i18n-key
const NAV: NavItem[] = [
  { to: '/', label: 'ภาพรวม', icon: '📊' }, // i18n-key
  { to: '/products', label: 'สินค้าคงคลัง', icon: '📦' }, // i18n-key
  { to: '/receive', label: 'รับสินค้าเข้า', icon: '📥' }, // i18n-key
  { to: '/issue', label: 'เบิก/โอนสาขา', icon: '🚚' }, // i18n-key
  { to: '/adjust', label: 'ปรับสต๊อก', icon: '🔧' }, // i18n-key
  { to: '/movements', label: 'ประวัติ/Stock Card', icon: '📜' }, // i18n-key
  { to: '/reports', label: 'รายงาน', icon: '📄' }, // i18n-key
  { to: '/notes', label: 'บันทึกช่วยจำ', icon: '📝' }, // i18n-key
  { to: '/settings', label: 'ตั้งค่า', icon: '⚙️' }, // i18n-key
]

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, mode } = useAuth()
  const { brand, reset } = useBrand()
  const t = useT()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  const def = brand ? brandDef(brand) : null
  const items = NAV.filter((n) => !n.adminOnly || user?.role === 'admin')

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar (desktop) — sticky so it stays put while the content scrolls */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <Brand mode={mode} def={def} />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </nav>
        <UserBox
          name={user?.name ?? ''}
          role={user?.role ?? 'staff'}
          onLogout={logout}
          onSwitch={reset}
        />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute left-0 top-0 flex h-full w-64 flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Brand mode={mode} def={def} />
            <nav className="flex-1 space-y-1 overflow-y-auto p-3" onClick={() => setOpen(false)}>
              {items.map((item) => (
                <NavItemLink key={item.to} item={item} />
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
        {/* Mobile top bar (sticky) */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="rounded-md p-1 text-2xl leading-none text-slate-600"
            aria-label={t('เมนู')}
          >
            ☰
          </button>
          <span className="font-bold text-red-700">
            {def?.emoji} {def?.name ?? 'Stock'}
          </span>
          <span className="ml-auto text-sm text-slate-500">
            {t(NAV.find((n) => n.to === location.pathname)?.label ?? '')}
          </span>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
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
    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
      <span className="text-2xl">{def?.emoji ?? '📦'}</span>
      <div className="min-w-0">
        <div className="truncate font-bold leading-tight text-red-700">
          {def?.name ?? 'Stock'}
        </div>
        <div className="text-xs text-slate-400">{t('ระบบบริหารสต๊อก')}</div>
      </div>
      <div className="ml-auto">
        {mode === 'cloud' ? (
          <Badge color="green">Cloud</Badge>
        ) : (
          <Badge color="amber">{t('ในเครื่อง')}</Badge>
        )}
      </div>
    </div>
  )
}

function NavItemLink({ item }: { item: NavItem }) {
  const t = useT()
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <span className="text-lg">{item.icon}</span>
      {t(item.label)}
    </NavLink>
  )
}

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
    <div className="border-t border-slate-200 p-3">
      <LangToggle className="mb-3" />
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 font-semibold text-red-700">
          {name.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-700">{name}</div>
          <div className="text-xs text-slate-400">
            {role === 'admin' ? t('ผู้ดูแลระบบ') : t('พนักงาน')}
          </div>
        </div>
      </div>
      <button
        onClick={onSwitch}
        className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
      >
        {t('🔄 สลับแบรนด์')}
      </button>
      <button
        onClick={onLogout}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
      >
        {t('ออกจากระบบ')}
      </button>
    </div>
  )
}
