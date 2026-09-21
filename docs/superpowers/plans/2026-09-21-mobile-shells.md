# Mobile/Tablet UI — Round 1: Shells — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app three navigation shells — phone (bottom tab bar + "+" action sheet), tablet (left rail), desktop (unchanged sidebar) — plus full-screen modals and a save bar that sits above the tab bar, so every later round has a frame to build in.

**Architecture:** One source of truth for navigation (`src/components/nav/navItems.ts`) feeds the sidebar, the rail, the tab bar, the action sheet and the new `/more` page. Breakpoints move from `lg` (1024) to the spec's: phone `< md` (768), tablet `md`–`xl` (768–1279), desktop `xl+` (1280). Shell chrome is pure Tailwind responsive classes — no JS viewport branching except where a component's *behaviour* differs (Modal full-screen on phones), which reads `useViewport()`.

**Tech Stack:** React 19, react-router-dom 7, Tailwind v4 (`@theme` tokens in `src/index.css`), vitest (node; no DOM component tests — visual checks are done in the demo browser at 375 / 768 / 1024 / 1280 px). Thai strings must have an English entry in `src/i18n/en.ts` (`npm run i18n:check`).

## Global Constraints

- Desktop `≥ 1280px` looks and behaves exactly as today (256px sidebar, white page sheet).
- Every tap target ≥ 44px (`min-h-11` / `h-11 w-11`).
- No horizontal page scroll at 375px.
- Every new Thai UI string gets an `en.ts` entry; markers `// i18n-key` on data-only Thai labels.
- No data, service or rules changes.
- Gate before every commit: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test && npm run build`.
- Files in this repo are CRLF; edits with Python scripts must preserve line endings (read with `newline=''`).

---

### Task 1: `viewportFor` and `useViewport()`

**Files:**
- Create: `src/lib/viewport.ts`
- Test: `tests/viewport.test.ts`

**Interfaces:**
- Produces: `type Viewport = 'phone' | 'tablet' | 'desktop'`, `viewportFor(width: number): Viewport`, `useViewport(): Viewport`, constants `PHONE_MAX = 767`, `TABLET_MAX = 1279`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/viewport.test.ts
// Which shell a screen width gets — the spec's three sizes (21 Sep 2026).
import { describe, expect, test } from 'vitest'
import { viewportFor } from '../src/lib/viewport'

describe('viewportFor', () => {
  test('phones are below 768, tablets below 1280, desktops from 1280', () => {
    expect(viewportFor(375)).toBe('phone')
    expect(viewportFor(767)).toBe('phone')
    expect(viewportFor(768)).toBe('tablet')
    expect(viewportFor(1024)).toBe('tablet')
    expect(viewportFor(1279)).toBe('tablet')
    expect(viewportFor(1280)).toBe('desktop')
    expect(viewportFor(1920)).toBe('desktop')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/viewport.test.ts`
Expected: FAIL — cannot find module `../src/lib/viewport`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/viewport.ts
import { useEffect, useState } from 'react'

/**
 * The three shells of the interface (spec, 21 Sep 2026): a phone gets the bottom tab bar,
 * a tablet the left rail, a desktop the sidebar it has always had. The numbers are
 * Tailwind's `md` and `xl` breakpoints, so classes and code agree on where each begins.
 */
export type Viewport = 'phone' | 'tablet' | 'desktop'

export const PHONE_MAX = 767
export const TABLET_MAX = 1279

export function viewportFor(width: number): Viewport {
  if (width <= PHONE_MAX) return 'phone'
  if (width <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

/** The current shell, following window resizes. Only for behaviour that differs; layout is CSS. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => (typeof window === 'undefined' ? 'desktop' : viewportFor(window.innerWidth)))
  useEffect(() => {
    const mqPhone = window.matchMedia(`(max-width: ${PHONE_MAX}px)`)
    const mqTablet = window.matchMedia(`(max-width: ${TABLET_MAX}px)`)
    const update = () => setVp(viewportFor(window.innerWidth))
    mqPhone.addEventListener('change', update)
    mqTablet.addEventListener('change', update)
    update()
    return () => {
      mqPhone.removeEventListener('change', update)
      mqTablet.removeEventListener('change', update)
    }
  }, [])
  return vp
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/viewport.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewport.ts tests/viewport.test.ts
git commit -m "Viewport: the three shells by width"
```

---

### Task 2: One source of navigation — `navItems.ts`

**Files:**
- Create: `src/components/nav/navItems.ts`
- Modify: `src/components/Layout.tsx:15-36` (delete the local `NavItem`/`NAV`, import from navItems)
- Test: `tests/nav-items.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface NavItem { to: string; label: string; icon: IconName; adminOnly?: boolean }
  const NAV: NavItem[]                                  // full menu, sidebar/rail order (as today)
  function navFor(role: Role | undefined): NavItem[]   // NAV minus adminOnly unless admin
  const TAB_ITEMS: NavItem[]                            // phone tab bar: / , /products, /movements, /more
  interface ActionItem { to: string; label: string; icon: IconName; hint: string }
  function actionsFor(role: Role | undefined): ActionItem[]  // the "+" sheet
  function moreItemsFor(role: Role | undefined): NavItem[]   // /more page: NAV minus tab-bar pages
  function isMoreRoute(pathname: string): boolean       // true when the tab bar should light "เพิ่มเติม"
  function titleFor(pathname: string): string           // label key for the top bar (moved from Layout)
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/nav-items.test.ts
// Who sees which menu entries, and which tab lights up where (spec §1, 21 Sep 2026).
import { describe, expect, test } from 'vitest'
import { actionsFor, isMoreRoute, moreItemsFor, navFor, TAB_ITEMS, titleFor } from '../src/components/nav/navItems'

describe('navigation', () => {
  test('Excel import is for admins only, everywhere', () => {
    expect(navFor('admin').some((n) => n.to === '/import')).toBe(true)
    expect(navFor('manager').some((n) => n.to === '/import')).toBe(false)
    expect(navFor('staff').some((n) => n.to === '/import')).toBe(false)
    expect(moreItemsFor('staff').some((n) => n.to === '/import')).toBe(false)
  })

  test('the tab bar is home, stock, history, more', () => {
    expect(TAB_ITEMS.map((t) => t.to)).toEqual(['/', '/products', '/movements', '/more'])
  })

  test('the "+" sheet offers the four transactions; placing an order is for managers up', () => {
    expect(actionsFor('staff').map((a) => a.to)).toEqual(['/receive', '/issue', '/adjust', '/requests/new'])
    expect(actionsFor('manager').map((a) => a.to)).toEqual(['/receive', '/issue', '/adjust', '/requests/new', '/orders?new=1'])
    expect(actionsFor('admin').map((a) => a.to)).toContain('/orders?new=1')
  })

  test('the "more" page lists what the tab bar and the sheet do not', () => {
    const more = moreItemsFor('staff').map((n) => n.to)
    expect(more).toEqual(['/calendar', '/reports', '/requests', '/orders', '/suppliers', '/settings'])
  })

  test('pages reached from "more" light the more tab; keying pages light nothing', () => {
    expect(isMoreRoute('/orders')).toBe(true)
    expect(isMoreRoute('/settings/users')).toBe(true)
    expect(isMoreRoute('/more')).toBe(true)
    expect(isMoreRoute('/')).toBe(false)
    expect(isMoreRoute('/products')).toBe(false)
    expect(isMoreRoute('/receive')).toBe(false)
  })

  test('the top bar title is the section label, also on sub-pages', () => {
    expect(titleFor('/requests/abc')).toBe('รายการขอสั่งซื้อ')
    expect(titleFor('/more')).toBe('เพิ่มเติม')
    expect(titleFor('/nowhere')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nav-items.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the module**

```ts
// src/components/nav/navItems.ts
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
  { to: '/adjust', label: 'ปรับสต๊อก', icon: 'adjust' }, // i18n-key
  { to: '/calendar', label: 'ปฏิทินคลัง', icon: 'calendar' }, // i18n-key
  { to: '/movements', label: 'ประวัติ/Stock Card', icon: 'history' }, // i18n-key
  { to: '/reports', label: 'รายงาน', icon: 'report' }, // i18n-key
  { to: '/requests', label: 'รายการขอสั่งซื้อ', icon: 'note' }, // i18n-key
  { to: '/orders', label: 'สั่งซื้อ', icon: 'truck' }, // i18n-key
  { to: '/suppliers', label: 'ผู้ขาย', icon: 'users' }, // i18n-key
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

/** The "more" tab lights on its own page and on every page only reachable through it. */
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
  return NAV.find((n) => n.to === pathname || (n.to !== '/' && pathname.startsWith(`${n.to}/`)))?.label ?? ''
}
```

Note `/requests/new` is under `/requests`, so `isMoreRoute('/requests/new')` must be false (an action) while `/requests` (the list) is true — the ACTION_ROOTS check runs before the NAV check, which is why the order above matters.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nav-items.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Point Layout at it**

In `src/components/Layout.tsx` delete the `interface NavItem` block and the `const NAV` block (lines 15–36) and add `import { navFor, titleFor, type NavItem } from './nav/navItems'`. Replace `const items = NAV.filter((n) => !n.adminOnly || user?.role === 'admin')` with `const items = navFor(user?.role)` and the TopBar title expression with `title={t(titleFor(location.pathname))}`.

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run i18n:check`
Expected: clean; the checker still sees every label because the `// i18n-key` markers moved with them. If it reports `เพิ่มเติม`, `หน้าแรก`, `สต๊อก`, `ประวัติ`, `รับเข้า`, `เบิก / โอน`, `ขอสั่งซื้อ`, `สั่งของใหม่` or the hints as missing, add English entries to `src/i18n/en.ts` (append before the final `}`; keep CRLF):

```ts
  'หน้าแรก': 'Home',
  'สต๊อก': 'Stock',
  'ประวัติ': 'History',
  'เพิ่มเติม': 'More',
  'รับเข้า': 'Receive',
  'เบิก / โอน': 'Issue / transfer',
  'ขอสั่งซื้อ': 'Request',
  'สั่งของใหม่': 'New order',
  'คีย์ของที่ส่งมา': 'Key in a delivery',
  'ออกจากคลังไปสาขาหรือหน้าร้าน': 'Out of the warehouse to a branch or the shop',
  'นับจริง ของเสีย หมดอายุ': 'Count, waste, expiry',
  'ส่งให้หัวหน้าอนุมัติ': 'Send to a manager to approve',
  'สั่งกับผู้ขายเอง': 'Order from a supplier yourself',
```

(Some of these keys may already exist — the checker says which are missing; add only those.)

- [ ] **Step 6: Commit**

```bash
git add src/components/nav/navItems.ts src/components/Layout.tsx src/i18n/en.ts tests/nav-items.test.ts
git commit -m "Navigation: one list feeds every menu"
```

---

### Task 3: Phone shell — `BottomTabBar` and `ActionSheet`

**Files:**
- Create: `src/components/nav/BottomTabBar.tsx`, `src/components/nav/ActionSheet.tsx`
- Modify: `src/index.css` (`@theme` block — add `--tabbar-h`), `src/components/Layout.tsx` (mount the bar, bottom padding), `src/components/TopBar.tsx:190-196` (hamburger removed), `src/components/DemoBanner.tsx:30,59` (pill above the bar)

**Interfaces:**
- Consumes: `TAB_ITEMS`, `actionsFor`, `isMoreRoute` from Task 2; `Modal` (`sheet` prop) from `ui.tsx`.
- Produces: `<BottomTabBar />` (renders nothing at `md+` via `md:hidden`), CSS variable `--tabbar-h: 4rem`.

- [ ] **Step 1: The tab bar height as a token**

In `src/index.css`, inside the `@theme { … }` block, add:

```css
  /* The phone tab bar; the page and the save bar leave this much room above the bottom. */
  --tabbar-h: 4rem;
```

- [ ] **Step 2: The action sheet**

```tsx
// src/components/nav/ActionSheet.tsx
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { Modal } from '../ui'
import { actionsFor } from './navItems'

/**
 * What the "+" opens: the four things a person does with stock, one tap each. Reuses the
 * Modal in sheet mode so it has the same focus trap, Escape and backdrop as every dialog.
 */
export function ActionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  return (
    <Modal open={open} onClose={onClose} title={t('ทำรายการ')} sheet>
      <div className="grid grid-cols-2 gap-3 p-4 [padding-bottom:calc(1rem+env(safe-area-inset-bottom))]">
        {actionsFor(user?.role).map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => {
              onClose()
              navigate(a.to)
            }}
            className="flex min-h-24 flex-col items-start justify-end gap-1 rounded-xl border border-line bg-surface p-3 text-left outline-none active:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon name={a.icon} size={24} className="text-brand" />
            <span className="text-sm font-semibold text-ink">{t(a.label)}</span>
            <span className="text-xs text-ink-soft">{t(a.hint)}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: The tab bar**

```tsx
// src/components/nav/BottomTabBar.tsx
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { ActionSheet } from './ActionSheet'
import { isMoreRoute, TAB_ITEMS } from './navItems'

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
  const tab = (item: (typeof TAB_ITEMS)[number]) => {
    const active = item.to === '/more' ? more : item.to === '/' ? pathname === '/' : !more && (pathname === item.to || pathname.startsWith(`${item.to}/`))
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${active ? 'font-semibold text-brand' : 'text-ink-soft'}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={item.icon} size={22} />
        <span>{t(item.label)}</span>
      </NavLink>
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
            className="absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg outline-none active:brightness-110 focus-visible:ring-2 focus-visible:ring-brand/40"
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
```

- [ ] **Step 4: Mount it and make room**

In `src/components/Layout.tsx`:
- import `{ BottomTabBar } from './nav/BottomTabBar'`;
- render `<BottomTabBar />` as the last child inside the outer `<div className="flex min-h-screen bg-canvas">`;
- change the `<main>` class to leave room on phones: replace `flex-1 p-4 sm:p-5 lg:p-6 ${isDemoMode() ? 'pb-16 sm:pb-6' : ''}` with `flex-1 p-4 sm:p-5 lg:p-6 [padding-bottom:calc(var(--tabbar-h)+1rem)] md:[padding-bottom:1.25rem] lg:[padding-bottom:1.5rem]` (the demo pill moves above the bar in step 6, so its extra padding goes).

In `src/components/TopBar.tsx` delete the hamburger `<button onClick={onMenu} …>` block (lines 190–196) and its comment; change the signature to `export function TopBar({ title }: { title: string })` and drop `onMenu` from the Layout call site. The drawer's `open` state, `drawer` ref and the focus-trap `useEffect` in Layout, and the `{open && (…)}` block, are deleted in Task 4 together with the drawer.

- [ ] **Step 5: The demo pill above the bar**

In `src/components/DemoBanner.tsx`, both `className="fixed bottom-3 left-3 …"` become `className="fixed left-3 z-[35] … [bottom:calc(var(--tabbar-h)+0.75rem)] md:bottom-3"` (drop `bottom-3` from the front, keep everything else).

- [ ] **Step 6: Strings**

Run `npm run i18n:check`; add to `src/i18n/en.ts` whatever it lists, expected:

```ts
  'ทำรายการ': 'New transaction',
  'เมนูหลัก': 'Main menu',
```

- [ ] **Step 7: Gate and look**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test`
Expected: clean, all tests pass.

Then in the demo (`preview_start` name `pizza-stock-demo`, pick Pizza Mania) at **375×812**: the tab bar shows หน้าแรก · สต๊อก · + · ประวัติ · เพิ่มเติม; tapping + opens the sheet with four tiles (five as admin); tapping รับเข้า navigates and closes; on `/orders` the เพิ่มเติม tab is lit; no horizontal scroll (`document.documentElement.scrollWidth === window.innerWidth`); the demo pill sits above the bar. At **1280**: nothing changed.

- [ ] **Step 8: Commit**

```bash
git add src/components/nav src/components/Layout.tsx src/components/TopBar.tsx src/components/DemoBanner.tsx src/index.css src/i18n/en.ts
git commit -m "Phone shell: bottom tab bar with a + action sheet"
```

---

### Task 4: Tablet rail; desktop moves to `xl`; drawer removed

**Files:**
- Create: `src/components/nav/NavRail.tsx`
- Modify: `src/components/Layout.tsx` (sidebar `lg:` → `xl:`, page sheet `lg:` → `xl:`, drawer deleted, rail mounted)

**Interfaces:**
- Consumes: `navFor`, `actionsFor` (Task 2), `ActionSheet` (Task 3), `useTodayEventCount`.
- Produces: `<NavRail />` visible only `md` to `xl` (`hidden md:flex xl:hidden`).

- [ ] **Step 1: The rail**

```tsx
// src/components/nav/NavRail.tsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useTodayEventCount } from '../../data/useTodayEventCount'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { ActionSheet } from './ActionSheet'
import { navFor } from './navItems'

/**
 * The tablet's menu (spec §1): every page as an icon with a short word under it, in a
 * 72px rail that stays put in both orientations, with the "+" near the top. A tablet has
 * the width for it and not the height for a bottom bar; a phone has neither, a desktop
 * has room for the full sidebar.
 */
export function NavRail() {
  const t = useT()
  const { user } = useAuth()
  const { brand } = useBrand()
  const [sheet, setSheet] = useState(false)
  const todayCount = useTodayEventCount(!!user)
  const def = brand ? brandDef(brand) : null
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-stretch border-r border-line bg-surface md:flex xl:hidden">
        <div className="flex h-14 items-center justify-center border-b border-line text-2xl" title={def?.name ?? ''}>
          {def?.emoji ?? '📦'}
        </div>
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-label={t('ทำรายการ')}
          className="mx-auto my-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow outline-none active:brightness-110 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Icon name="plus" size={26} />
        </button>
        <nav className="flex-1 overflow-y-auto py-1" aria-label={t('เมนูหลัก')}>
          {navFor(user?.role).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `relative mx-1.5 my-0.5 flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center text-[10px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  isActive ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-soft hover:bg-sunken hover:text-ink'
                }`
              }
            >
              <Icon name={item.icon} size={22} />
              <span className="line-clamp-2">{t(item.label)}</span>
              {item.to === '/calendar' && todayCount > 0 && (
                <span className="num absolute right-1 top-1 rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-white">{todayCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <ActionSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  )
}
```

- [ ] **Step 2: Layout: sidebar and sheet at `xl`, rail at `md`, drawer gone**

In `src/components/Layout.tsx`:
- sidebar `<aside className="sticky top-0 hidden h-screen w-64 … lg:flex">` → `… xl:flex`;
- page sheet `<div className="lg:min-h-full lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-6 lg:shadow-sm">` → the same with every `lg:` replaced by `xl:`;
- delete the whole `{open && ( … )}` drawer block, the `open`/`setOpen` state, the `drawer` ref, and the focus-trap `useEffect` (keep `useAutomation()`);
- import and render `<NavRail />` right after the desktop `<aside>`;
- remove now-unused imports (`useEffect`, `useRef`, `useState` if unused, `Badge` stays for Brand).

- [ ] **Step 3: Gate and look**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test`
Expected: clean.

Demo at **768×1024**: rail on the left with 13 icons (12 for non-admin), + button, no hamburger, no tab bar, tables shown; at **1024×768** same; at **1280**: full sidebar, no rail; at **375**: tab bar, no rail.

- [ ] **Step 4: Commit**

```bash
git add src/components/nav/NavRail.tsx src/components/Layout.tsx
git commit -m "Tablet shell: a rail of icons; desktop begins at xl; the drawer is gone"
```

---

### Task 5: The `/more` page

**Files:**
- Create: `src/pages/More.tsx`
- Modify: `src/App.tsx:70-89` (route)

**Interfaces:**
- Consumes: `moreItemsFor` (Task 2), `useAuth` (`logout`), `useBrand` (`reset`), `useI18n` (`lang`, `setLang`).

- [ ] **Step 1: The page**

```tsx
// src/pages/More.tsx
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { Icon } from '../components/Icon'
import { moreItemsFor } from '../components/nav/navItems'
import { useI18n, useT } from '../i18n/I18nContext'

/**
 * The rest of the menu on a phone (spec §1): what the tab bar and the "+" do not carry,
 * then the account actions the sidebar's foot has on a desktop.
 */
export function MorePage() {
  const t = useT()
  const { lang, setLang } = useI18n()
  const { user, logout } = useAuth()
  const { brand, reset } = useBrand()
  const def = brand ? brandDef(brand) : null
  const row = 'flex min-h-14 items-center gap-3 px-4 text-sm text-ink outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40'
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <span className="text-3xl">{def?.emoji ?? '📦'}</span>
        <div className="min-w-0">
          <div className="truncate font-bold text-brand">{def?.name ?? ''}</div>
          <div className="text-xs text-ink-faint">{user?.name} · {user?.role === 'admin' ? t('ผู้ดูแลระบบ') : user?.role === 'manager' ? t('หัวหน้า') : t('พนักงาน')}</div>
        </div>
      </div>
      <nav className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {moreItemsFor(user?.role).map((n) => (
          <Link key={n.to} to={n.to} className={row}>
            <Icon name={n.icon} size={20} className="text-ink-soft" />
            <span className="flex-1">{t(n.label)}</span>
            <Icon name="chevronRight" size={16} className="text-ink-faint" />
          </Link>
        ))}
      </nav>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        <button type="button" className={`${row} w-full`} onClick={() => setLang(lang === 'th' ? 'en' : 'th')}>
          <Icon name="globe" size={20} className="text-ink-soft" />
          <span className="flex-1 text-left">{t('ภาษา')}</span>
          <span className="text-ink-soft">{lang === 'th' ? 'ไทย' : 'English'}</span>
        </button>
        <button type="button" className={`${row} w-full`} onClick={reset}>
          <Icon name="swap" size={20} className="text-ink-soft" />
          <span className="flex-1 text-left">{t('สลับแบรนด์')}</span>
        </button>
        <button type="button" className={`${row} w-full text-danger`} onClick={() => void logout()}>
          <Icon name="logout" size={20} />
          <span className="flex-1 text-left">{t('ออกจากระบบ')}</span>
        </button>
      </div>
    </div>
  )
}
```

Check `useI18n()` exposes `lang` and `setLang` (`grep -n "setLang" src/i18n/I18nContext.tsx`); if the setter has another name, use that.

- [ ] **Step 2: Route**

In `src/App.tsx` add `import { MorePage } from './pages/More'` and, before the `*` route, `<Route path="/more" element={<MorePage />} />`.

- [ ] **Step 3: Gate and look**

Run the gate. Demo at 375: tap เพิ่มเติม → the page lists ปฏิทินคลัง, รายงาน, รายการขอสั่งซื้อ, สั่งซื้อ, ผู้ขาย, (นำเข้า Excel as admin), ตั้งค่า, then ภาษา / สลับแบรนด์ / ออกจากระบบ; the เพิ่มเติม tab is lit; opening สั่งซื้อ keeps it lit.

- [ ] **Step 4: Commit**

```bash
git add src/pages/More.tsx src/App.tsx src/i18n/en.ts
git commit -m "Phone: the rest of the menu as a page"
```

---

### Task 6: Modals full-screen on phones; a sticky footer slot

**Files:**
- Modify: `src/components/ui.tsx:204-330` (Modal), `src/components/Confirm.tsx:61` (compact sheet)

**Interfaces:**
- Produces: `Modal` gains `footer?: ReactNode` (rendered sticky at the bottom of the panel) and `compact?: boolean` (a short dialog: bottom sheet on phones, centred small box above). Default modals on phones become full-screen.

- [ ] **Step 1: Geometry**

In `Modal`, add props `footer?: ReactNode` and `compact?: boolean`. Change the overlay/panel classes for the default (neither `sheet` nor `side`) case:

overlay: `'fixed inset-0 z-50 flex items-stretch justify-center overscroll-contain bg-ink/50 backdrop-blur-[2px] md:items-center md:overflow-y-auto md:p-4'`

panel: `` `flex h-full w-full flex-col overflow-y-auto bg-surface shadow-2xl md:h-auto md:max-h-[92vh] md:rounded-xl ${wide ? 'md:max-w-3xl' : 'md:max-w-lg'}` ``

For `compact` (used by Confirm): overlay `'fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-ink/50 backdrop-blur-[2px] md:items-center md:p-4'`, panel `'flex max-h-[80vh] w-full flex-col overflow-y-auto rounded-t-2xl bg-surface shadow-2xl md:max-w-md md:rounded-xl'`.

Render the footer, when given, after `{children}`:

```tsx
{footer && (
  <div className="sticky bottom-0 z-10 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
    {footer}
  </div>
)}
```

(The header is already `sticky top-0`.)

- [ ] **Step 2: Confirm as a compact sheet**

In `src/components/Confirm.tsx:61` add `compact` to the `<Modal …>` props.

- [ ] **Step 3: Gate and look**

Run the gate. Demo at 375: open สั่งซื้อ → ดูใบสั่ง (the order sheet) — it fills the screen with the title bar stuck at the top and the page scrolling under it; press ยกเลิก on an order → the confirm rises as a short sheet from the bottom. At 1280: dialogs are centred boxes as before.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.tsx src/components/Confirm.tsx
git commit -m "Dialogs fill a phone screen; confirms rise as a short sheet"
```

---

### Task 7: The save bar above the tab bar; deploy round 1

**Files:**
- Modify: `src/components/ui.tsx:486-492` (FormActions), `HANDOFF.md` (§ UI: a note on the three shells)

- [ ] **Step 1: FormActions sits above the tab bar on phones**

Replace the class string in `FormActions` with:

```
sticky -mx-4 mt-2 flex justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur [bottom:var(--tabbar-h)] [padding-bottom:0.75rem] md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-filter-none
```

(It was `bottom-0` with the safe-area padding; the tab bar now owns the safe area.)

- [ ] **Step 2: HANDOFF note**

In `HANDOFF.md`, in the UI section, add one bullet: "**สามขนาดหน้าจอ (21 ก.ย.)**: มือถือ <768 แถบล่าง+ปุ่ม + (`components/nav/BottomTabBar`, `ActionSheet`), แท็บเล็ต 768–1279 ราง (`NavRail`), คอม ≥1280 เมนูซ้ายเดิม; เมนูทุกแบบอ่านจาก `components/nav/navItems.ts` ที่เดียว; `/more` คือเมนูที่เหลือบนมือถือ; Modal เต็มจอบนมือถือ (`compact` = แผ่นสั้น); spec `docs/superpowers/specs/2026-09-21-mobile-tablet-ui-design.md`".

- [ ] **Step 3: Full gate**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm run i18n:check && npm test && npx tsc -p worker/tsconfig.json --noEmit && npm run build`
Expected: all clean; note the `dist/assets/index-*.js` name.

- [ ] **Step 4: Walk the demo**

At 375×812: /receive → add a line → the บันทึก bar sits just above the tab bar and is fully visible; the + sheet; /more; a modal; no horizontal scroll on /, /products, /orders, /movements, /settings. At 768×1024 and 1024×768: rail, tables, forms 2-col. At 1280: unchanged. Fix anything found before committing.

- [ ] **Step 5: Commit, push, verify the deploy**

```bash
git add -A
git commit -m "Save bar above the tab bar; handoff note for the three shells"
git push origin main
```

Then poll `curl -s https://pzmstock.pages.dev/ | grep -o 'index-[^"]*\.js'` until it equals the local `dist/assets/index-*.js` name.
