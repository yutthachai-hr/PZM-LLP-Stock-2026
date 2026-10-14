import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { I18nProvider } from '../src/i18n/I18nContext'
import { DailySuggestions } from '../src/components/dashboard/DailySuggestions'
import { PoSheet } from '../src/components/PoSheet'
import type { PurchaseOrder } from '../src/types'

vi.mock('../src/backend', () => ({ backend: { mode: 'local' }, BACKEND_MODE: 'local' }))
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../src/brand/BrandContext', () => ({ useBrand: () => ({ brand: 'pizza' }) }))
vi.mock('../src/data/DataContext', () => ({ useData: () => ({}) }))
vi.mock('../src/data/useCalendarFeed', () => ({ useCalendarFeed: () => ({ insights: null, items: [] }) }))
vi.mock('../src/services/schedules', () => ({ useScheduleConfig: () => ({ settings: { coverDays: 7 } }) }))
vi.mock('../src/services/suppliers', () => ({ useSuppliers: () => [] }))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({}) }))
// No backend or sharing side effects during the narrow server-rendered loading state.
vi.mock('../src/services/purchaseRequests', () => ({}))
vi.mock('../src/services/transfers', () => ({}))
vi.mock('../src/data/requestCache', () => ({ requestCache: {} }))
vi.mock('../src/data/transferCache', () => ({ transferCache: {} }))

function markup(lang: 'th' | 'en') {
  vi.stubGlobal('localStorage', { getItem: () => lang })
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(MemoryRouter, null, createElement(DailySuggestions))))
}

afterEach(() => vi.unstubAllGlobals())

test.each(['th', 'en'] as const)('a supplier sheet explicitly in %s stays in that language under either UI language', sheetLang => {
  const order = {
    id: 'historic', docNo: 'PO-00014', supplierName: 'ผู้ขายเดิม', createdByName: 'ชื่อผู้สั่งเดิม',
    status: 'ordered', orderedAt: Date.UTC(2026, 8, 25, 5), note: 'หมายเหตุเดิม',
    lines: [{ productId: 'p1', productName: 'สินค้าเดิม', unit: 'KG', orderedQty: 2 }],
  } as unknown as PurchaseOrder
  const before = structuredClone(order)
  const render = (uiLang: 'th' | 'en') => {
    vi.stubGlobal('localStorage', { getItem: () => uiLang })
    return renderToStaticMarkup(createElement(I18nProvider, null, createElement(PoSheet, {
      order, company: 'Pizza Mania', locationName: 'Test Warehouse', lang: sheetLang,
    })))
  }
  const thUI = render('th')
  const enUI = render('en')
  expect(enUI).toBe(thUI)
  expect(enUI).toContain(sheetLang === 'th' ? 'ใบสั่งซื้อ' : 'Purchase order')
  expect(enUI).toContain(`25/09/${sheetLang === 'th' ? '2569' : '2026'}`)
  for (const stored of ['ผู้ขายเดิม', 'ชื่อผู้สั่งเดิม', 'สินค้าเดิม', 'หมายเหตุเดิม', 'PO-00014']) expect(enUI).toContain(stored)
  expect(order).toEqual(before)
})

describe('daily digest LINE artwork', () => {
  test.each(['th', 'en'] as const)('loading button is disabled with %s artwork and translated accessible text', lang => {
    const html = markup(lang)
    expect(html).toContain(`src="/brand/line/share-${lang}-grey.png"`)
    expect(html).toContain(`aria-label="${lang === 'th' ? 'แชร์ LINE' : 'Share to LINE'}"`)
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-label=/)
    expect(html).toContain('width="68" height="30"')
    expect(html).toContain('alt=""')
    expect(html).toContain('object-contain')
  })
})
