import { useEffect, useMemo, useRef, useState } from 'react'
import { shortages } from '../lib/inventoryRules/lowStock'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { fmtQty, formatThaiDateShort } from '../lib/format'
import { Icon, type IconName } from './Icon'
import { LangButton } from './LangButton'
import { NotificationBell } from './notifications/NotificationBell'
import { MessagesButton } from './messages/MessagesButton'
import { ProductThumb } from './ProductThumb'
import { ProfileModal } from './ProfileModal'
import { globalSearch, MIN_QUERY, type SearchGroup, type SearchHit } from '../lib/globalSearch'
import { navFor } from './nav/navItems'
import { useLoadedSuppliers } from '../services/suppliers'

/**
 * The bar across the top of every screen: find a product, and see what is running out.
 *
 * Until now the only way to reach an item was to open the right page and filter it there —
 * Products to see the balance, History to see what happened to it, each with its own search
 * box and neither reachable from the other. The question people actually arrive with is
 * about a thing, not a page, so the search is global and its results carry the answer to
 * "how much have we got" before you click anything.
 *
 * The warning sign is the low-stock count. The dashboard has always had that number; it was
 * only visible once you were already looking at the dashboard. The bell beside it is the
 * notification centre (components/notifications).
 */

const GROUP_LABEL: Record<SearchGroup, string> = {
  pages: 'หน้า', // i18n-key
  products: 'สินค้า', // i18n-key
  documents: 'เอกสาร', // i18n-key
  suppliers: 'ผู้ขาย', // i18n-key
  locations: 'คลัง / สาขา', // i18n-key
}

const GROUP_ICON: Record<SearchGroup, IconName> = {
  pages: 'menu',
  products: 'package',
  documents: 'fileSheet',
  suppliers: 'users',
  locations: 'mapPin',
}

export function TopBar({ title }: { title: string }) {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { products, locations, qtyAt, minFor, tracksProduct, movements, movementsFrom } = useData()
  // Only if a screen has read them already: the bar is on every screen, so it never reads.
  const suppliers = useLoadedSuppliers()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [mobileSearch, setMobileSearch] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // Same rule as the dashboard and the calendar, so the badge and the lists cannot disagree.
  const lowCount = useMemo(
    () => shortages({ products, locations, qtyAt, minFor, tracksProduct }).length,
    [products, locations, qtyAt, minFor, tracksProduct],
  )

  // Pages, products, documents, suppliers and places, grouped, from memory only (lib/globalSearch).
  // Loose: "siam food" finds SIAMFOOD, words match in any order, best matches first. Hidden
  // products are out of the catalogue's way; their history is still reachable from
  // สินค้าคงคลัง with the "ที่ซ่อนไว้" filter. The menu is the person's own (role-aware).
  const found = useMemo(
    () => globalSearch(q, { pages: navFor(user?.role), products, locations, suppliers, movements, label: t }),
    [q, user?.role, products, locations, suppliers, movements, t],
  )
  const results = found.hits

  useEffect(() => setActive(0), [q])

  // Ctrl+K / ⌘K puts the cursor in the search from anywhere, the shortcut the hint in the
  // field advertises. Only above sm, where the field is on screen to receive it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close on a click anywhere else. The results overlay the page, so leaving them up while
  // someone reads what is underneath makes the page feel stuck.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(to: string) {
    setOpen(false)
    setMobileSearch(false)
    setQ('')
    // A product opens its stock card: what it is, where it is, and everything that moved it.
    navigate(to)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      // The top layer only: a dialog underneath must not close along with the results.
      e.stopPropagation()
      if (open && q) {
        setOpen(false)
        return
      }
      setOpen(false)
      setMobileSearch(false)
      input.current?.blur()
      return
    }
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active].to)
    }
  }

  const search = (
    <div ref={box} className="relative min-w-0 flex-1 md:max-w-lg xl:max-w-2xl">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        <Icon name="search" size={17} />
      </span>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="topbar-results"
        aria-autocomplete="list"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('ค้นหาสินค้า หน้า เอกสาร ผู้ขาย…')}
        className="w-full min-h-11 rounded-xl border border-line bg-sunken pl-10 pr-3 text-sm sm:pr-16 text-ink placeholder:text-ink-faint outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-brand/25"
      />
      {!q && (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-faint sm:block">
          Ctrl K
        </kbd>
      )}
      {open && q.trim().length >= MIN_QUERY && (
        <div
          id="topbar-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface shadow-xl"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-ink-soft">{t('ไม่พบในข้อมูลที่โหลดไว้')}</p>
          ) : (
            results.map((hit: SearchHit, i) => {
              const head = i === 0 || results[i - 1].group !== hit.group
              const product = hit.productId ? products.find((p) => p.id === hit.productId) : undefined
              const total = product ? locations.reduce((sum, l) => sum + qtyAt(l.id, product.id), 0) : 0
              return (
                <div key={hit.key} role="presentation">
                  {head && (
                    <div role="presentation" className="px-3 pb-1 pt-2.5 text-[11px] font-semibold tracking-wide text-ink-faint">
                      {t(GROUP_LABEL[hit.group])}
                      {found.capped.includes(hit.group) && <span className="ml-1 font-normal">· {t('แสดงบางส่วน')}</span>}
                    </div>
                  )}
                  <button
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(hit.to)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? 'bg-brand-soft' : ''}`}
                  >
                    {product ? (
                      <ProductThumb productId={product.id} hasImage={product.hasImage} size={32} zoom={false} />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-soft">
                        <Icon name={GROUP_ICON[hit.group]} size={16} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{hit.label}</span>
                      {hit.sub && <span className="doc-no block truncate text-xs text-ink-faint">{hit.sub}</span>}
                    </span>
                    {product && (
                      <span className="num shrink-0 text-right text-sm font-semibold text-ink">
                        {fmtQty(total)}
                        <span className="ml-1 text-xs font-normal text-ink-faint">{product.unitType}</span>
                      </span>
                    )}
                  </button>
                </div>
              )
            })
          )}
          {/* What was not searched, so a short or empty list never reads as "there is none". */}
          <div role="presentation" className="border-t border-line px-3 py-2 text-xs text-ink-faint">
            <p>
              {t('ค้นจากข้อมูลที่โหลดไว้ — เอกสารตั้งแต่ {date}', { date: formatThaiDateShort(movementsFrom) })}
              {!found.suppliersSearched && ` · ${t('ยังไม่ได้โหลดรายชื่อผู้ขาย')}`}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {t('ใบขอสั่งซื้อและการส่งสินค้า ค้นในหน้าของมัน:')}
              <button type="button" className="cursor-pointer text-brand hover:underline" onClick={() => choose('/requests')}>
                {t('รายการขอสั่งซื้อ')}
              </button>
              <button type="button" className="cursor-pointer text-brand hover:underline" onClick={() => choose('/transfers')}>
                {t('ระบบส่งสินค้า')}
              </button>
              {!found.suppliersSearched && (
                <button type="button" className="cursor-pointer text-brand hover:underline" onClick={() => choose('/suppliers')}>
                  {t('ผู้ขาย')}
                </button>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-2 py-2 sm:px-4 lg:px-6 xl:py-2.5">
        {/* On a phone the field would leave no room for anything else, so it opens over
            the bar instead of sitting in it. */}
        <div className={`min-w-0 flex-1 ${mobileSearch ? '' : 'hidden sm:block'}`}>{search}</div>

        {!mobileSearch && (
          <span className="truncate text-base font-bold text-ink sm:hidden">{title}</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              setMobileSearch((v) => !v)
              setTimeout(() => input.current?.focus(), 0)
            }}
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 sm:hidden"
            aria-label={t('ค้นหา')}
          >
            <Icon name={mobileSearch ? 'x' : 'search'} size={20} />
          </button>

          <button
            onClick={() => navigate('/')}
            className="relative hidden h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 md:inline-flex"
            aria-label={t('สินค้าใกล้หมด ({n} รายการ)', { n: lowCount })}
          >
            <Icon name="warning" size={19} />
            {lowCount > 0 && (
              <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">
                {lowCount > 99 ? '99+' : lowCount}
              </span>
            )}
          </button>

          <NotificationBell />

          <MessagesButton />

          <span className="hidden md:contents">
            <LangButton />
          </span>

          <UserMenu />
        </div>
      </div>
    </header>
  )
}

/**
 * Who is signed in, at the right of the bar, with the two things a person does about it.
 *
 * The sidebar carries the same two buttons, but below lg the sidebar is a drawer, and
 * "which account is this tablet on" is a question asked before opening any menu.
 */
function UserMenu() {
  const t = useT()
  const { user, logout } = useAuth()
  const { reset } = useBrand()
  const [open, setOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  const role = user.role === 'admin' ? t('ผู้ดูแลระบบ') : user.role === 'manager' ? t('หัวหน้า') : t('พนักงาน')
  const item =
    'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm text-ink-soft outline-none row-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40'

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('บัญชีผู้ใช้')}
        className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-lg pl-1 pr-1.5 text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">
          {user.name.charAt(0).toUpperCase() || '?'}
        </span>
        {/* Which account this tablet is on, readable without opening the menu (mock-up). */}
        <span className="hidden max-w-32 truncate pl-1 text-sm font-semibold text-ink xl:block">{user.name}</span>
        <Icon name="chevronDown" size={16} className="hidden sm:block" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-xl"
        >
          <div className="border-b border-line px-3 pb-2 pt-1.5">
            <div className="truncate text-sm font-semibold text-ink">{user.name}</div>
            <div className="text-xs text-ink-faint">{role}</div>
          </div>
          <div className="pt-1.5">
            <button role="menuitem" className={item} onClick={() => { setOpen(false); setEditingProfile(true) }}>
              <Icon name="pencil" size={16} />
              {t('แก้ไขโปรไฟล์')}
            </button>
            <button role="menuitem" className={item} onClick={() => { setOpen(false); reset() }}>
              <Icon name="swap" size={16} />
              {t('สลับแบรนด์')}
            </button>
            <button role="menuitem" className={item} onClick={() => { setOpen(false); void logout() }}>
              <Icon name="logout" size={16} />
              {t('ออกจากระบบ')}
            </button>
          </div>
        </div>
      )}
      {editingProfile && <ProfileModal onClose={() => setEditingProfile(false)} />}
    </div>
  )
}
