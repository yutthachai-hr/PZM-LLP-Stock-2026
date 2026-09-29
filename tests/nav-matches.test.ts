// Which menu entry is lit for a URL (owner, 25 Sep 2026: "ของเข้าวันนี้" and "ระบบส่งสินค้า"
// were both lit on the same page).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { NAV, NAV_GROUPS, navMatches } from '../src/components/nav/navItems'

const lit = (path: string) => NAV.filter((n) => navMatches(path, n.to)).map((n) => n.to)

describe('navMatches', () => {
  test('a page with its own entry lights only that entry', () => {
    expect(lit('/transfers/today')).toEqual(['/transfers/today'])
  })

  test('the parent entry still lights for its other pages', () => {
    expect(lit('/transfers')).toEqual(['/transfers'])
    expect(lit('/transfers/abc123')).toEqual(['/transfers'])
    expect(lit('/transfers/abc123/receive')).toEqual(['/transfers'])
  })

  test('home lights only on home; every other page lights exactly one entry', () => {
    expect(lit('/')).toEqual(['/'])
    for (const n of NAV) expect(lit(n.to)).toEqual([n.to])
    expect(lit('/requests/new')).toEqual(['/requests'])
  })
})

describe('menu icons', () => {
  test('no two menu entries share a picture (owner, 25 Sep 2026)', () => {
    const icons = NAV.map((n) => n.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  test('the delivery list page has its new name', () => {
    expect(NAV.find((n) => n.to === '/transfers/today')).toMatchObject({ label: 'ใบรายการส่งสินค้า', icon: 'clipboardCheck' })
    expect(NAV.find((n) => n.to === '/issue')?.icon).toBe('send')
    expect(NAV.find((n) => n.to === '/orders')?.icon).toBe('cart')
  })

  test('section bars have pictures of their own; the stock page is "Goods" (owner, 25 Sep 2026)', () => {
    const icons = [...NAV.map((n) => n.icon), ...Object.values(NAV_GROUPS).map((g) => g.icon)]
    expect(new Set(icons).size).toBe(icons.length)
    expect(NAV_GROUPS).toMatchObject({ inventory: { icon: 'package' }, procurement: { icon: 'store' }, delivery: { icon: 'mapPin' } })
    expect(NAV.find((n) => n.to === '/products')).toMatchObject({ label: 'ทะเบียนสินค้า', icon: 'boxes' })
  })
})
