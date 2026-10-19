import { describe, expect, test } from 'vitest'
import {
  fmtCostAmount,
  fmtCostPerUnit,
  getCostHint,
  compareProductCost,
  mapProductExportRow,
  canViewProductCost,
} from '../src/pages/products/productCostDisplay'
import type { Product, Role } from '../src/types'
import type { ProductRow } from '../src/pages/products/ProductTable'

describe('Product cost formatter (Requirements 3, 5, 6, 11)', () => {
  test('fmtCostAmount formats up to 4 decimals without rounding small numbers to 0', () => {
    expect(fmtCostAmount(0)).toBe('0.00')
    expect(fmtCostAmount(12.5)).toBe('12.50')
    expect(fmtCostAmount(0.993)).toBe('0.993')
    expect(fmtCostAmount(0.0035)).toBe('0.0035')
    expect(fmtCostAmount(1000)).toBe('1,000.00')
    expect(fmtCostAmount(1234.5678)).toBe('1,234.5678')
  })

  test('fmtCostPerUnit returns explicit unit string or null when undefined', () => {
    expect(fmtCostPerUnit(12.5, 'EA')).toBe('฿12.50 / EA')
    expect(fmtCostPerUnit(0, 'EA')).toBe('฿0.00 / EA')
    expect(fmtCostPerUnit(0.0035, 'KG')).toBe('฿0.0035 / KG')
    expect(fmtCostPerUnit(0.993, 'Pack')).toBe('฿0.993 / Pack')
    expect(fmtCostPerUnit(undefined, 'EA')).toBeNull()
    expect(fmtCostPerUnit(null, 'EA')).toBeNull()
  })

  test('getCostHint returns secondary hint when latest purchase unit differs from base unit', () => {
    const t = (k: string, v?: Record<string, string | number>) => {
      if (k === 'ตามใบแจ้งหนี้ ฿{price} / {unit} (×{factor})') {
        return `ตามใบแจ้งหนี้ ฿${v?.price} / ${v?.unit} (×${v?.factor})`
      }
      return k
    }

    const productWithCartonHint: Pick<Product, 'cost' | 'unitType' | 'costHistory'> = {
      cost: 15,
      unitType: 'EA',
      costHistory: [
        {
          price: 360,
          unit: 'Carton',
          factor: 24,
          cost: 15,
          effectiveAt: 1000,
          at: 1000,
          by: 'u1',
          byName: 'Admin',
        },
      ],
    }

    const hint = getCostHint(productWithCartonHint, t)
    expect(hint).not.toBeNull()
    expect(hint?.text).toBe('ตามใบแจ้งหนี้ ฿360.00 / Carton (×24)')

    // Same unit: no hint needed
    const productWithSameUnit: Pick<Product, 'cost' | 'unitType' | 'costHistory'> = {
      cost: 15,
      unitType: 'EA',
      costHistory: [
        {
          price: 15,
          unit: 'EA',
          factor: 1,
          cost: 15,
          effectiveAt: 1000,
          at: 1000,
          by: 'u1',
          byName: 'Admin',
        },
      ],
    }
    expect(getCostHint(productWithSameUnit, t)).toBeNull()

    // No costHistory: no hint
    expect(getCostHint({ cost: 15, unitType: 'EA' }, t)).toBeNull()

    // Mismatched cost (history does not match current cost): do not mislead
    const productMismatched: Pick<Product, 'cost' | 'unitType' | 'costHistory'> = {
      cost: 20,
      unitType: 'EA',
      costHistory: [
        {
          price: 360,
          unit: 'Carton',
          factor: 24,
          cost: 15,
          effectiveAt: 1000,
          at: 1000,
          by: 'u1',
          byName: 'Admin',
        },
      ],
    }
    expect(getCostHint(productMismatched, t)).toBeNull()
  })
})

describe('Product cost sort comparator (Requirement 7)', () => {
  test('undefined sorts last in both asc and desc directions', () => {
    // Both defined: standard comparison
    expect(compareProductCost(10, 20, 'asc')).toBeLessThan(0)
    expect(compareProductCost(10, 20, 'desc')).toBeGreaterThan(0)
    expect(compareProductCost(20, 10, 'asc')).toBeGreaterThan(0)
    expect(compareProductCost(20, 10, 'desc')).toBeLessThan(0)
    expect(compareProductCost(15, 15, 'asc')).toBe(0)
    expect(compareProductCost(15, 15, 'desc')).toBe(0)

    // Real 0 vs positive number
    expect(compareProductCost(0, 10, 'asc')).toBeLessThan(0)
    expect(compareProductCost(0, 10, 'desc')).toBeGreaterThan(0)

    // Undefined sorts LAST in ASC
    expect(compareProductCost(10, undefined, 'asc')).toBeLessThan(0)
    expect(compareProductCost(undefined, 10, 'asc')).toBeGreaterThan(0)
    expect(compareProductCost(0, undefined, 'asc')).toBeLessThan(0)
    expect(compareProductCost(undefined, 0, 'asc')).toBeGreaterThan(0)

    // Undefined sorts LAST in DESC
    expect(compareProductCost(10, undefined, 'desc')).toBeLessThan(0)
    expect(compareProductCost(undefined, 10, 'desc')).toBeGreaterThan(0)
    expect(compareProductCost(0, undefined, 'desc')).toBeLessThan(0)
    expect(compareProductCost(undefined, 0, 'desc')).toBeGreaterThan(0)

    // Both undefined
    expect(compareProductCost(undefined, undefined, 'asc')).toBe(0)
    expect(compareProductCost(undefined, undefined, 'desc')).toBe(0)
  })
})

describe('Product export row mapping (Requirement 7)', () => {
  test('includes numeric cost column and base unit', () => {
    const t = (k: string) => k
    const row: ProductRow = {
      p: {
        id: 'p1',
        sku: 'SKU-001',
        name: 'Test Product',
        category: 'Sauce',
        unit: 'Each',
        unitType: 'EA',
        cost: 12.5,
        minStock: 5,
        hasImage: false,
        active: true,
        createdAt: 100,
        updatedAt: 200,
      },
      qty: 50,
      min: 5,
      state: 'normal',
      sites: ['loc1'],
      updatedAt: 200,
      others: [],
    }

    const exported = mapProductExportRow(row, t, 'loc1', () => 'Main Warehouse')
    expect(exported['รหัสสินค้า']).toBe('SKU-001')
    expect(exported['ชื่อสินค้า']).toBe('Test Product')
    expect(exported['หมวดหมู่']).toBe('Sauce')
    expect(exported['หน่วย']).toBe('EA')
    expect(exported['ต้นทุน/หน่วย']).toBe(12.5) // Numeric cell
    expect(exported['คงเหลือ']).toBe(50)
    expect(exported['จุดสั่งซื้อ']).toBe(5)
    expect(exported['สถานะ']).toBe('ปกติ')
    expect(exported['คลังสินค้า']).toBe('Main Warehouse')

    // Undefined cost exports as empty string
    const rowNoCost: ProductRow = {
      ...row,
      p: { ...row.p, cost: undefined },
    }
    const exportedNoCost = mapProductExportRow(rowNoCost, t, 'loc1', () => 'Main Warehouse')
    expect(exportedNoCost['ต้นทุน/หน่วย']).toBe('')
  })
})

describe('Visibility gate (Requirement 9)', () => {
  test('all authenticated roles can view cost in accordance with existing policy', () => {
    // Existing policy parity:
    // Products.tsx:161 (valuation tile) has no role check
    // StockCardPage.tsx:235 (cost & value cards) has no role check
    // CostReport.tsx:76 (cost report table) has no role check
    // ProductEditor.tsx:540 (view cost history) has no role check (only editing is admin)
    expect(canViewProductCost('admin')).toBe(true)
    expect(canViewProductCost('manager')).toBe(true)
    expect(canViewProductCost('staff')).toBe(true)
    expect(canViewProductCost(undefined as unknown as Role)).toBe(false)
  })
})
