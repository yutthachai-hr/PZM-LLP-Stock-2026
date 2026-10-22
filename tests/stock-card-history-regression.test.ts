// Setup window stub in Node environment
vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = {
    location: { reload() {} },
    addEventListener() {},
    removeEventListener() {},
  }
})

import React from 'react'
import ReactDOMServer from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StockCardPage } from '../src/pages/StockCardPage'
import { balanceSeries } from '../src/lib/stats/balanceSeries'
import type { StockMovement } from '../src/types'

vi.mock('../src/lib/stats/balanceSeries', async (original) => {
  const real = await original<typeof import('../src/lib/stats/balanceSeries')>()
  return { ...real, balanceSeries: vi.fn(real.balanceSeries) }
})

// Mock dependencies
const mockProduct = {
  id: 'prod-1',
  name: 'Mozzarella Cheese',
  sku: 'MOZZ-01',
  unitType: 'KG',
  minStock: 10,
  category: 'Dairy',
  active: true,
  cost: 150,
}

let mockParams = { id: 'prod-1' }
let mockBrand = 'brand-a'
let mockMovements: StockMovement[] = []
let mockLoading = false
let mockHistory = { rows: [] as StockMovement[], ready: false, status: 'loading', error: '', retry: () => {} }

vi.mock('../src/i18n/I18nContext', () => ({
  useT: () => (k: string, vars?: Record<string, unknown>) => {
    if (!vars) return k
    return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), k)
  },
}))

vi.mock('react-router-dom', () => ({
  useParams: () => mockParams,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => React.createElement('a', { href: to }, children),
}))

vi.mock('../src/brand/BrandContext', () => ({
  useBrand: () => ({ brand: mockBrand }),
}))

vi.mock('../src/data/DataContext', () => ({
  useData: () => ({
    productById: (id: string) => (id === 'prod-1' ? mockProduct : undefined),
    locations: [{ id: 'loc-1', name: 'Main Kitchen' }],
    rawLocations: [{ id: 'loc-1', name: 'Main Kitchen' }],
    locationById: (id: string) => ({ id, name: 'Main Kitchen' }),
    qtyAt: () => 20,
    companyQty: () => 20,
    transitQty: () => 0,
    minFor: () => 10,
    movements: mockMovements,
    loading: mockLoading,
  }),
}))

vi.mock('../src/data/useMovementHistory', () => ({ useMovementHistory: () => mockHistory }))

vi.mock('../src/services/productCost', () => ({
  currentCost: () => 150,
}))

describe('stock-card-history-regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBrand = 'brand-a'
    mockParams = { id: 'prod-1' }
    mockMovements = []
    mockLoading = false
    mockHistory = { rows: [], ready: false, status: 'loading', error: '', retry: () => {} }
  })

  test('loading state: must not render partial movement totals from live 7-day window while ledger is null', () => {
    // 7-day window has a movement, but ledger is still loading (null)
    mockMovements = [
      {
        id: 'mv-live-1',
        docNo: 'RC-001',
        type: 'receive',
        productId: 'prod-1',
        productName: 'Mozzarella Cheese',
        unit: 'KG',
        qty: 15,
        date: 1791392400000,
        createdAt: 1791400000000,
        byUserId: 'u1',
        byUserName: 'Chef',
      } as StockMovement,
    ]

    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(StockCardPage))

    // Must show dash '–' in movement totals instead of calculating 15 KG from incomplete window
    expect(html).not.toMatch(/รับเข้า \(ยอดรวม\)<\/div><div[^>]*>15 KG/)
    expect(html).not.toMatch(/จ่ายออก \(ยอดรวม\)<\/div><div[^>]*>15 KG/)
  })

  test('loading state: export buttons must be disabled while history is loading', () => {
    mockMovements = [
      {
        id: 'mv-live-1',
        docNo: 'RC-001',
        type: 'receive',
        productId: 'prod-1',
        productName: 'Mozzarella Cheese',
        unit: 'KG',
        qty: 15,
        date: 1791392400000,
        createdAt: 1791400000000,
        byUserId: 'u1',
        byUserName: 'Chef',
      } as StockMovement,
    ]

    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(StockCardPage))

    const pdfMatch = html.match(/<button[^>]*>.*?PDF<\/button>/s)?.[0]
    const excelMatch = html.match(/<button[^>]*>.*?Excel<\/button>/s)?.[0]

    expect(pdfMatch).toBeDefined()
    expect(excelMatch).toBeDefined()
    expect(pdfMatch).toMatch(/\bdisabled(?:\s*=\s*["'](?:disabled|true)?["']|\s|>)/)
    expect(excelMatch).toMatch(/\bdisabled(?:\s*=\s*["'](?:disabled|true)?["']|\s|>)/)
  })

  test('an error offers retry and never displays successful empty history or enabled exports', () => {
    mockHistory = { ...mockHistory, status: 'error', error: 'permission-denied' }
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(StockCardPage))
    expect(html).toContain('permission-denied')
    expect(html).toContain('โหลดประวัติใหม่')
    expect(html).not.toContain('ไม่มีการเคลื่อนไหวในช่วงนี้')
    expect(html).not.toContain('กำลังโหลด...')
    const exports = (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).filter(button => /(?:PDF|Excel)<\/button>/.test(button))
    expect(exports).toHaveLength(2)
    expect(exports.every(button => button.includes('disabled=""'))).toBe(true)
  })

  test('legacy unit mixing: suppresses aggregate scalar totals and running balance, gates export with warning (F-06)', () => {
    mockHistory = {
      rows: [
        {
          id: 'mv-1',
          docNo: 'RC-001',
          type: 'receive',
          productId: 'prod-1',
          productName: 'Mozzarella Cheese',
          unit: 'KG',
          qty: 10,
          date: 1791392400000,
          createdAt: 1791400000000,
          byUserId: 'u1',
          byUserName: 'Chef',
        } as StockMovement,
        {
          id: 'mv-2',
          docNo: 'RC-002',
          type: 'receive',
          productId: 'prod-1',
          productName: 'Mozzarella Cheese',
          unit: 'Bag',
          entryUnit: 'Bag',
          qty: 2,
          date: 1791392500000,
          createdAt: 1791400100000,
          byUserId: 'u1',
          byUserName: 'Chef',
        } as StockMovement,
      ],
      ready: true,
      status: 'complete',
      error: '',
      retry: () => {},
    }

    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(StockCardPage))

    // Must NOT display 12 KG scalar sum
    expect(html).not.toMatch(/รับเข้า \(ยอดรวม\)<\/div><div[^>]*>12 KG/)
    // Raw rows remain legible in their actual unit; no mixed-unit trend is calculated.
    expect(html).toContain('Bag')
    expect(balanceSeries).not.toHaveBeenCalled()
    // Must contain warning about legacy units
    expect(html).toContain('มีรายการหน่วยเดิมที่ยังไม่ได้แปลงหน่วย')
    // Exports must be disabled
    const exports = (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).filter(button => /(?:PDF|Excel)<\/button>/.test(button))
    expect(exports).toHaveLength(2)
    expect(exports.every(button => button.includes('disabled=""'))).toBe(true)
  })
})
