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
}

export const NAV: NavItem[] = [
  { to: '/', label: 'ภาพรวม', icon: 'dashboard' }, // i18n-key
  { to: '/products', label: 'สินค้าคงคลัง', icon: 'package' }, // i18n-key
  { to: '/receive', label: 'รับสินค้าเข้า', icon: 'receive' }, // i18n-key
  { to: '/issue', label: 'เบิก/โอนสาขา', icon: 'truck' }, // i18n-key
  // Today's page first: titleFor() takes the first entry whose path starts the URL.
  { to: '/transfers/today', label: 'ของเข้าวันนี้', icon: 'receive' }, // i18n-key
  { to: '/transfers', label: 'ระบบส่งสินค้า', icon: 'truck' }, // i18n-key
  { to: '/adjust', label: 'ปรับสต๊อก', icon: 'adjust' }, // i18n-key
  { to: '/calendar', label: 'ปฏิทินคลัง', icon: 'calendar' }, // i18n-key
  { to: '/movements', label: 'ประวัติ/Stock Card', icon: 'history' }, // i18n-key
  { to: '/reports', label: 'รายงาน', icon: 'report' }, // i18n-key
  { to: '/requests', label: 'รายการขอสั่งซื้อ', icon: 'note' }, // i18n-key
  { to: '/orders', label: 'สั่งซื้อ', icon: 'truck' }, // i18n-key
  { to: '/suppliers', label: 'ผู้ขาย', icon: 'users' }, // i18n-key
  { to: '/announcements', label: 'ประกาศบริษัท', icon: 'megaphone' }, // i18n-key
  { to: '/import', label: 'นำเข้า Excel', icon: 'upload', adminOnly: true }, // i18n-key
  { to: '/settings', label: 'ตั้งค่า', icon: 'settings' }, // i18n-key
]

/** The phone's "more" page — a real route so the tab bar can light it. */
export const MORE: NavItem = { to: '/more', label: 'เพิ่มเติม', icon: 'menu' } // i18n-key

export function navFor(role: Role | undefined): NavItem[] {
  return NAV.filter((n) => !n.adminOnly || role === 'admin')
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
  return NAV.find((n) => n.to === pathname || (n.to !== '/' && pathname.startsWith(`${n.to}/`)))?.label ?? ''
}
