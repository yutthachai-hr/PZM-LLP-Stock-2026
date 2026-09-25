// Who sees which menu entries, and which tab lights up where (spec §1, 21 Sep 2026).
import { describe, expect, test } from 'vitest'
import { actionsFor, isMoreRoute, moreItemsFor, navFor, navSections, TAB_ITEMS, titleFor } from '../src/components/nav/navItems'

describe('navigation', () => {
  test('Excel import lives in settings, not in any menu (owner, 25 Sep 2026)', () => {
    expect(navFor('admin').some((n) => n.to === '/import')).toBe(false)
    expect(moreItemsFor('admin').some((n) => n.to === '/import')).toBe(false)
    expect(titleFor('/import')).toBe('นำเข้า Excel')
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
    expect(more).toEqual(['/reports', '/requests', '/orders', '/suppliers', '/transfers', '/transfers/today', '/calendar', '/announcements', '/settings'])
  })

  test('the menu reads in the sections and order the owner gave (25 Sep 2026)', () => {
    const sections = navSections(navFor('admin')).map((s) => [s.group ?? '-', s.items.map((n) => n.to)])
    expect(sections).toEqual([
      ['-', ['/']],
      ['inventory', ['/products', '/receive', '/issue', '/adjust', '/movements', '/reports']],
      ['procurement', ['/requests', '/orders', '/suppliers']],
      ['delivery', ['/transfers', '/transfers/today']],
      ['-', ['/calendar', '/announcements', '/settings']],
    ])
  })

  test('pages reached from "more" light the more tab; keying pages light nothing', () => {
    expect(isMoreRoute('/orders')).toBe(true)
    expect(isMoreRoute('/transfers')).toBe(true)
    expect(isMoreRoute('/settings/users')).toBe(true)
    expect(isMoreRoute('/more')).toBe(true)
    expect(isMoreRoute('/')).toBe(false)
    expect(isMoreRoute('/products')).toBe(false)
    expect(isMoreRoute('/receive')).toBe(false)
    expect(isMoreRoute('/requests/new')).toBe(false)
    expect(isMoreRoute('/requests')).toBe(true)
  })

  test('the top bar title is the section label, also on sub-pages', () => {
    expect(titleFor('/requests/abc')).toBe('รายการขอสั่งซื้อ')
    expect(titleFor('/transfers/today')).toBe('ใบรายการส่งสินค้า')
    expect(titleFor('/transfers/abc')).toBe('ระบบส่งสินค้า')
    expect(titleFor('/more')).toBe('เพิ่มเติม')
    expect(titleFor('/nowhere')).toBe('')
  })
})
