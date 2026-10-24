import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { I18nProvider, translatorFor } from '../src/i18n/I18nContext'
import { SideLive } from '../src/components/nav/SideLive'
import { RecentActivityCard } from '../src/components/dashboard/DeskCards'
import type { PurchaseOrder, PurchaseRequest, StockMovement } from '../src/types'

vi.mock('../src/backend', () => ({ backend: { mode: 'local' }, BACKEND_MODE: 'local' }))
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../src/brand/BrandContext', () => ({ useBrand: () => ({ brand: 'pizza' }) }))
vi.mock('../src/data/DataContext', () => ({
  useData: () => ({
    movements: [],
    products: [],
    locations: [],
    locationById: () => ({ name: 'Warehouse' }),
  }),
}))

vi.mock('../src/data/orderCache', () => ({
  orderCache: {
    peekRange: () => [
      {
        id: 'p1',
        docNo: 'PO-00014',
        status: 'ordered',
        createdAt: Date.now() - 1000,
        createdByName: 'ยกเลิก',
        supplierName: 'ผู้ขายเดิม',
        lines: [],
      },
    ],
  },
}))

afterEach(() => vi.unstubAllGlobals())

describe('contextual activity wording', () => {
  test('English activity in sidebar uses a verb, keeps the actor verbatim, and does not change the Orders menu translation', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en' })
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(MemoryRouter, null, createElement(SideLive, { todayCount: 0 })),
      ),
    )
    expect(html).toContain('<b>ยกเลิก</b> placed order <span')
    expect(html).toContain('PO-00014')
    expect(html).toContain('title="PO-00014 · ผู้ขายเดิม"')
    expect(translatorFor('en')('สั่งซื้อ')).toBe('Orders')
  })

  test('Dashboard activity titles are facts, not the navigation commands; sources remain untouched', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en' })
    const now = Date.now()
    const movements = ['receive', 'issue', 'issue', 'adjust'].map((type, i) => ({
      id: `m${i}`,
      docNo: `MV-${i}`,
      type,
      createdAt: now,
      productName: 'สินค้าเดิม',
      fromLocationId: type === 'issue' ? 'wh' : undefined,
      toLocationId: i === 2 ? 'branch' : undefined,
    })) as StockMovement[]
    const orders = [
      {
        id: 'po',
        docNo: 'PO-00014',
        status: 'ordered',
        orderedAt: now,
        supplierName: 'ผู้ขายเดิม',
        lines: [],
        createdByName: 'ชื่อเดิม',
      },
    ] as unknown as PurchaseOrder[]
    const requests = [
      {
        id: 'pr',
        docNo: 'PR-00001',
        status: 'pendingApproval',
        submittedAt: now,
        items: [],
        locationId: 'wh',
      },
    ] as unknown as PurchaseRequest[]
    const before = structuredClone({ movements, orders, requests })
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(MemoryRouter, null, createElement(RecentActivityCard, { movements, orders, requests })),
      ),
    )
    for (const title of [
      'Stock received',
      'Stock issued / used',
      'Stock transferred',
      'Stock adjusted',
      'Purchase order created',
      'Purchase request sent',
    ]) {
      expect(html).toContain(`>${title}</span>`)
    }
    expect(html).toContain('ผู้ขายเดิม')
    expect({ movements, orders, requests }).toEqual(before)
  })
})
