// The top bar's global search (early release, Phase 3): grouped, from memory only, and honest
// about what it did not search.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { globalSearch, type SearchSources } from '../src/lib/globalSearch'
import { navFor } from '../src/components/nav/navItems'
import type { Product, StockLocation, StockMovement, Supplier } from '../src/types'

const product = (over: Partial<Product>): Product => ({ id: 'p1', sku: 'MES-01-03-001', name: 'SAUSAGE MIX DOLCE (LADER)', unitType: 'KG', active: true, ...over }) as Product
const place = (over: Partial<StockLocation>): StockLocation => ({ id: 'wh', name: 'คลังหลัก', nameEn: 'Main warehouse', type: 'warehouse', active: true, createdAt: 0, ...over }) as StockLocation
const supplier = (over: Partial<Supplier>): Supplier => ({ id: 's1', name: 'LADER', code: 'SUP-001', contactNumber: '', email: '', type: 'company', ...over }) as Supplier
const mv = (over: Partial<StockMovement>): StockMovement => ({
  id: 'm1', docNo: 'RC-00012', type: 'receive', productId: 'p1', productName: 'X', unit: 'KG', qty: 1,
  date: 0, byUserId: 'u', byUserName: 'U', createdAt: 1, ...over,
})
const T: Record<string, string> = { 'รับสินค้าเข้า': 'Receive goods', 'สั่งซื้อ': 'Orders' }

function src(over: Partial<SearchSources> = {}): SearchSources {
  return {
    pages: navFor('staff'),
    products: [product({})],
    locations: [place({})],
    suppliers: null,
    movements: [],
    label: (k) => T[k] ?? k,
    ...over,
  }
}

describe('global search', () => {
  test('nothing under two characters', () => {
    expect(globalSearch('s', src()).hits).toEqual([])
  })

  test('a product opens its stock card', () => {
    const r = globalSearch('sausage dolce', src())
    expect(r.hits).toEqual([expect.objectContaining({ group: 'products', to: '/products/p1/card', label: 'SAUSAGE MIX DOLCE (LADER)' })])
  })

  test('hidden products are left out', () => {
    expect(globalSearch('sausage', src({ products: [product({ active: false })] })).hits).toEqual([])
  })

  test('pages match in either language, from the person’s own menu', () => {
    expect(globalSearch('receive', src()).hits.map((h) => h.to)).toContain('/receive')
    expect(globalSearch('รับสินค้า', src()).hits.map((h) => h.to)).toContain('/receive')
    // Excel import is admin-only and lives in settings: never offered as a page.
    expect(globalSearch('import', src({ pages: navFor('admin') })).hits.some((h) => h.to === '/import')).toBe(false)
  })

  test('suppliers are searched only when already loaded, and it says so', () => {
    const notLoaded = globalSearch('lader', src())
    expect(notLoaded.suppliersSearched).toBe(false)
    expect(notLoaded.hits.some((h) => h.group === 'suppliers')).toBe(false)
    const loaded = globalSearch('SUP-001', src({ suppliers: [supplier({})] }))
    expect(loaded.suppliersSearched).toBe(true)
    expect(loaded.hits).toContainEqual(expect.objectContaining({ group: 'suppliers', to: '/suppliers?id=s1' }))
  })

  test('document numbers from loaded movements: one hit per document, PO deep link', () => {
    const movements = [
      mv({ id: 'a', docNo: 'RC-00012', poId: 'po7', poDocNo: 'PO-00007', supplierName: 'LADER', invoiceNo: 'IV-1' }),
      mv({ id: 'b', docNo: 'RC-00012', poId: 'po7', poDocNo: 'PO-00007', productId: 'p2' }),
    ]
    const rc = globalSearch('RC-00012', src({ movements }))
    expect(rc.hits.filter((h) => h.group === 'documents')).toEqual([expect.objectContaining({ to: '/movements?doc=RC-00012', label: 'RC-00012' })])
    const po = globalSearch('PO-00007', src({ movements }))
    expect(po.hits).toContainEqual(expect.objectContaining({ group: 'documents', to: '/orders?po=po7', label: 'PO-00007' }))
    // A supplier's invoice number finds the receipt it came on.
    expect(globalSearch('IV-1', src({ movements })).hits[0]).toEqual(expect.objectContaining({ label: 'RC-00012' }))
  })

  test('places link to their stock history', () => {
    const r = globalSearch('main warehouse', src())
    expect(r.hits).toContainEqual(expect.objectContaining({ group: 'locations', to: '/movements?location=wh' }))
  })

  test('grouped in a fixed order, and a full group is marked as capped', () => {
    const many = Array.from({ length: 9 }, (_, i) => product({ id: `p${i}`, name: `CHEESE ${i}`, sku: `C-${i}` }))
    const r = globalSearch('cheese', src({ products: many }))
    expect(r.hits.filter((h) => h.group === 'products')).toHaveLength(6)
    expect(r.capped).toContain('products')
    const order = ['pages', 'products', 'documents', 'suppliers', 'locations']
    const groups = globalSearch('la', src({ suppliers: [supplier({})], movements: [mv({ supplierName: 'LADER', invoiceNo: 'LA-9' })] })).hits.map((h) => order.indexOf(h.group))
    expect(groups).toEqual([...groups].sort((a, b) => a - b))
  })
})
