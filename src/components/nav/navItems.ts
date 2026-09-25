import type { IconName } from '../Icon'
import type { Role } from '../../types'

/**
 * Every place the app can be navigated from reads this one list: the desktop sidebar,
 * the tablet rail, the phone tab bar, the "+" sheet and the "more" page. Labels are
 * translation keys rendered through t() — marked i18n-key so the checker knows.
 */
export interface NavItem {
  to: string
  label: string
  icon: IconName
  adminOnly?: boolean
  /** The menu section it sits in; none = a page of its own. */
  group?: NavGroup
  /** Opened from the settings page, not the menu — still here for the top bar's title. */
  inSettings?: boolean
}

/**
 * The menu's sections (owner, 25 Sep 2026: "มันกระจายเกินไป ดูเยอะเกิน"). The order is
 * his: overview alone, then the stock work, purchasing and delivery, then the calendar,
 * announcements and settings on their own. Each section is a bar of its own that folds
 * open; the stock section took the box picture, its products page became "Goods".
 */
export type NavGroup = 'inventory' | 'procurement' | 'delivery'

export const NAV_GROUPS: Record<NavGroup, { label: string; icon: IconName }> = {
  inventory: { label: 'สินค้าคงคลัง', icon: 'package' }, // i18n-key
  procurement: { label: 'งานจัดซื้อ', icon: 'store' }, // i18n-key
  delivery: { label: 'งานจัดส่ง', icon: 'mapPin' }, // i18n-key
}

export const NAV: NavItem[] = [
  { to: '/', label: 'ภาพรวม', icon: 'dashboard' }, // i18n-key
  { to: '/products', label: 'ทะเบียนสินค้า', icon: 'boxes', group: 'inventory' }, // i18n-key
  { to: '/receive', label: 'รับสินค้าเข้า', icon: 'receive', group: 'inventory' }, // i18n-key
  { to: '/issue', label: 'เบิก/โอนสาขา', icon: 'send', group: 'inventory' }, // i18n-key
  { to: '/adjust', label: 'ปรับสต๊อก', icon: 'adjust', group: 'inventory' }, // i18n-key
  { to: '/movements', label: 'ประวัติ/Stock Card', icon: 'history', group: 'inventory' }, // i18n-key
  { to: '/reports', label: 'รายงาน', icon: 'report', group: 'inventory' }, // i18n-key
  { to: '/requests', label: 'รายการขอสั่งซื้อ', icon: 'note', group: 'procurement' }, // i18n-key
  { to: '/orders', label: 'สั่งซื้อ', icon: 'cart', group: 'procurement' }, // i18n-key
  { to: '/suppliers', label: 'ผู้ขาย', icon: 'users', group: 'procurement' }, // i18n-key
  { to: '/transfers', label: 'ระบบส่งสินค้า', icon: 'truck', group: 'delivery' }, // i18n-key
  { to: '/transfers/today', label: 'ใบรายการส่งสินค้า', icon: 'clipboardCheck', group: 'delivery' }, // i18n-key
  { to: '/calendar', label: 'ปฏิทินคลัง', icon: 'calendar' }, // i18n-key
  { to: '/announcements', label: 'ประกาศบริษัท', icon: 'megaphone' }, // i18n-key
  { to: '/settings', label: 'ตั้งค่า', icon: 'settings' }, // i18n-key
  { to: '/import', label: 'นำเข้า Excel', icon: 'upload', adminOnly: true, inSettings: true }, // i18n-key
]

/** A run of menu entries: one section's, or pages of their own (no group). */
export interface NavSection {
  group?: NavGroup
  items: NavItem[]
}

/** Split a menu list into its sections, keeping the list's order. */
export function navSections(items: NavItem[]): NavSection[] {
  const out: NavSection[] = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else out.push({ group: item.group, items: [item] })
  }
  return out
}

/** The phone's "more" page — a real route so the tab bar can light it. */
export const MORE: NavItem = { to: '/more', label: 'เพิ่มเติม', icon: 'menu' } // i18n-key

/**
 * Whether a menu entry is the page you are on.
 *
 * A path lights its entry and everything under it — except where another entry is more
 * specific: "/transfers/today" is an entry of its own, so it must not light
 * "ระบบส่งสินค้า" (/transfers) as well (owner saw both lit, 25 Sep 2026), while
 * "/transfers/<id>" still does.
 */
export function navMatches(pathname: string, to: string): boolean {
  const under = (p: string) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`))
  if (!under(to)) return false
  return !NAV.some((n) => n.to !== to && n.to.startsWith(`${to}/`) && under(n.to))
}

/** The menu for a role — without what lives inside settings (Excel import, since 25 Sep 2026). */
export function navFor(role: Role | undefined): NavItem[] {
  return NAV.filter((n) => !n.inSettings && (!n.adminOnly || role === 'admin'))
}

/** Phone tab bar, left to right; the "+" sits between stock and history. */
export const TAB_ITEMS: NavItem[] = [
  { to: '/', label: 'หน้าแรก', icon: 'dashboard' }, // i18n-key
  { to: '/products', label: 'สต๊อก', icon: 'package' }, // i18n-key
  { to: '/movements', label: 'ประวัติ', icon: 'history' }, // i18n-key
  MORE,
]

/** What the "+" opens: the things a person does, as opposed to the things they look at. */
export interface ActionItem {
  to: string
  label: string
  icon: IconName
  hint: string
}

const ACTIONS: ActionItem[] = [
  { to: '/receive', label: 'รับเข้า', icon: 'receive', hint: 'คีย์ของที่ส่งมา' }, // i18n-key
  { to: '/issue', label: 'เบิก / โอน', icon: 'truck', hint: 'ออกจากคลังไปสาขาหรือหน้าร้าน' }, // i18n-key
  { to: '/adjust', label: 'ปรับสต๊อก', icon: 'adjust', hint: 'นับจริง ของเสีย หมดอายุ' }, // i18n-key
  { to: '/requests/new', label: 'ขอสั่งซื้อ', icon: 'note', hint: 'ส่งให้หัวหน้าอนุมัติ' }, // i18n-key
]
const ORDER_ACTION: ActionItem = { to: '/orders?new=1', label: 'สั่งของใหม่', icon: 'cart', hint: 'สั่งกับผู้ขายเอง' } // i18n-key

export function actionsFor(role: Role | undefined): ActionItem[] {
  return role === 'manager' || role === 'admin' ? [...ACTIONS, ORDER_ACTION] : ACTIONS
}

/** Everything not already on the tab bar or in the "+" sheet, in menu order. */
export function moreItemsFor(role: Role | undefined): NavItem[] {
  const covered = new Set([...TAB_ITEMS.map((t) => t.to), ...ACTIONS.map((a) => a.to)])
  return navFor(role).filter((n) => !covered.has(n.to))
}

const TAB_ROOTS = TAB_ITEMS.filter((t) => t.to !== '/more').map((t) => t.to)
const ACTION_ROOTS = ACTIONS.map((a) => a.to.split('?')[0])

/**
 * The "more" tab lights on its own page and on every page only reachable through it.
 * An action's page (`/requests/new`) is under a list page (`/requests`), so actions are
 * checked before the menu.
 */
export function isMoreRoute(pathname: string): boolean {
  if (pathname === '/more') return true
  const root = (to: string) => pathname === to || pathname.startsWith(`${to}/`)
  if (pathname === '/' || TAB_ROOTS.some((to) => to !== '/' && root(to))) return false
  if (ACTION_ROOTS.some(root)) return false
  return NAV.some((n) => n.to !== '/' && root(n.to))
}

/** The section's label for the top bar; a sub-page keeps its section's name. */
export function titleFor(pathname: string): string {
  if (pathname === '/more') return MORE.label
  // The bar's title is read on phones only, where "/" is the home screen, not the overview.
  if (pathname === '/') return TAB_ITEMS[0].label
  return NAV.find((n) => n.to !== '/' && navMatches(pathname, n.to))?.label ?? ''
}
