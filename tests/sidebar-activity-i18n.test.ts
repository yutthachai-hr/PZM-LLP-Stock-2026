import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { I18nProvider, translatorFor } from '../src/i18n/I18nContext'
import { SideLive } from '../src/components/nav/SideLive'

vi.mock('../src/data/DataContext', () => ({ useData: () => ({ movements: [], products: [], locations: [] }) }))
vi.mock('../src/data/orderCache', () => ({ orderCache: { peekRange: () => [{
  id: 'p1', docNo: 'PO-00014', status: 'ordered', createdAt: Date.now() - 1000,
  createdByName: 'ยกเลิก', supplierName: 'ผู้ขายเดิม', lines: [],
}] } }))

afterEach(() => vi.unstubAllGlobals())

test('English activity uses a verb, keeps the actor verbatim, and does not change the Orders menu translation', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'en' })
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(MemoryRouter, null, createElement(SideLive, { todayCount: 0 }))))
  expect(html).toContain('<b>ยกเลิก</b> placed order <span')
  expect(html).toContain('PO-00014')
  expect(html).toContain('title="PO-00014 · ผู้ขายเดิม"')
  expect(translatorFor('en')('สั่งซื้อ')).toBe('Orders')
})
