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
    expect(more).toEqual(['/transfers/today', '/transfers', '/calendar', '/reports', '/requests', '/orders', '/suppliers', '/announcements', '/settings'])
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
    expect(titleFor('/more')).toBe('เพิ่มเติม')
    expect(titleFor('/nowhere')).toBe('')
  })
})
