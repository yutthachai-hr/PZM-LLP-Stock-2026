import type { TFn } from '../../i18n/I18nContext'
import { sameUnit } from '../../lib/units'
import type { Product, Role } from '../../types'
import { STATE_LOOK } from './productStatus'
import type { ProductRow } from './ProductTable'

/**
 * Pure formatter for product cost amounts.
 * Preserves up to 4 decimals without rounding small numbers (e.g. 0.0035 -> 0.0035, 12.5 -> 12.50).
 */
export function fmtCostAmount(cost: number): string {
  return cost.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

/**
 * Explicit cost per unit string: e.g. "฿12.50 / EA".
 * Returns null if cost is undefined/null/non-finite.
 */
export function fmtCostPerUnit(cost: number | undefined | null, unitType: string): string | null {
  if (cost === undefined || cost === null || !Number.isFinite(cost)) {
    return null
  }
  return `฿${fmtCostAmount(cost)} / ${unitType}` // i18n-key
}

/**
 * Secondary hint for purchase units differing from the base unit.
 * Derived from costHistory's latest entry WITHOUT recomputing cost.
 * Only returns when it adds clarity and cannot mislead.
 */
export function getCostHint(
  product: Pick<Product, 'cost' | 'unitType' | 'costHistory'>,
  t: TFn,
): { text: string; tooltip: string } | null {
  if (!product.costHistory || product.costHistory.length === 0 || product.cost === undefined) {
    return null
  }
  const sorted = [...product.costHistory].sort((a, b) => b.effectiveAt - a.effectiveAt || b.at - a.at)
  const latest = sorted[0]
  if (!latest) return null

  // Ensure latest cost matches current product.cost to avoid misleading
  if (latest.cost !== product.cost) return null

  // Only show if the keyed unit differs from the product's base unit and factor > 1
  if (latest.unit && !sameUnit(latest.unit, product.unitType) && latest.factor > 1) {
    const text = t('ตามใบแจ้งหนี้ ฿{price} / {unit} (×{factor})', {
      price: fmtCostAmount(latest.price),
      unit: latest.unit,
      factor: latest.factor,
    })
    return { text, tooltip: text }
  }

  return null
}

/**
 * Pure comparator for sorting products by cost.
 * Undefined / null costs sort last in BOTH ascending and descending order.
 */
export function compareProductCost(
  aCost: number | undefined | null,
  bCost: number | undefined | null,
  direction: 'asc' | 'desc',
): number {
  const aValid = aCost !== undefined && aCost !== null && Number.isFinite(aCost)
  const bValid = bCost !== undefined && bCost !== null && Number.isFinite(bCost)

  if (!aValid && !bValid) return 0
  if (!aValid) return 1 // a (undefined) sorts last
  if (!bValid) return -1 // b (undefined) sorts last

  return direction === 'asc' ? aCost - bCost : bCost - aCost
}

/**
 * Product export row mapping including numeric cost column and base unit column.
 */
export function mapProductExportRow(
  r: ProductRow,
  t: TFn,
  locId: string,
  siteName: (id: string) => string,
): Record<string, string | number> {
  return {
    [t('รหัสสินค้า')]: r.p.sku,
    [t('ชื่อสินค้า')]: r.p.name,
    [t('หมวดหมู่')]: r.p.category,
    [t('หน่วย')]: r.p.unitType,
    [t('ต้นทุน/หน่วย')]: r.p.cost !== undefined && r.p.cost !== null ? r.p.cost : '',
    [t('คงเหลือ')]: r.qty,
    [t('จุดสั่งซื้อ')]: r.min,
    [t('สถานะ')]: r.p.active === false ? t('ที่ซ่อนไว้') : t(STATE_LOOK[r.state].label),
    [t('คลังสินค้า')]: locId ? siteName(locId) : r.sites.map(siteName).join(', '),
  }
}

/**
 * Visibility gate: returns whether a user role can view product cost.
 * Parity with existing codebase:
 * - Products.tsx:161 (valuation tile) has no role check
 * - StockCardPage.tsx:235 (cost & value cards) has no role check
 * - CostReport.tsx:76 (cost report table) has no role check
 * - ProductEditor.tsx:540 (view cost history) has no role check (only editing is admin)
 */
export function canViewProductCost(role: Role | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'staff'
}
