import { describe, expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Product } from '../src/types'
import type { TFn } from '../src/i18n/I18nContext'

// What a person actually sees for a product's cost. ProductTable reaches the data layer,
// which registers browser listeners when it loads; the component under test needs no DOM.
;(globalThis as unknown as { window?: unknown }).window ??= { addEventListener() {} }
const { CostFigure, productColumns } = await import('../src/pages/products/ProductTable')

/** The i18n shim the other cost tests use: Thai key in, Thai key (or template filled) out. */
const t = ((k: string, v?: Record<string, string | number>) =>
  v ? k.replace(/\{(\w+)\}/g, (_m, name: string) => String(v[name] ?? '')) : k) as TFn

function product(over: Partial<Product> & Pick<Product, 'unitType'>): Product {
  return {
    id: 'p1',
    sku: 'SKU-001',
    name: 'Test Product',
    category: 'Sauce',
    unit: 'Each',
    minStock: 5,
    hasImage: false,
    active: true,
    createdAt: 100,
    updatedAt: 200,
    ...over,
  }
}

/** Rendered markup as a reader sees it. */
function render(p: Product, showLabel = false): { text: string; html: string } {
  const html = renderToStaticMarkup(createElement(CostFigure, { p, t, showLabel }))
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ') // the browser collapses the runs between spans too
    .trim()
  return { text, html }
}

describe('CostFigure rendered output', () => {
  test('undefined cost renders the not-set label, no baht sign', () => {
    const { text } = render(product({ unitType: 'EA' }))
    expect(text).toBe('ยังไม่ระบุ')
    expect(text).not.toContain('฿')
  })

  test('zero cost renders as ฿0.00 with the base unit, not as missing', () => {
    const { text } = render(product({ unitType: 'EA', cost: 0 }))
    expect(text).toBe('฿0.00 / EA')
  })

  test('a four-decimal cost keeps all four decimals (0.0035 is not rounded away)', () => {
    const { text } = render(product({ unitType: 'KG', cost: 0.0035 }))
    expect(text).toBe('฿0.0035 / KG')
  })

  test('two decimals are kept for a whole number (12.5 renders 12.50)', () => {
    const { text } = render(product({ unitType: 'EA', cost: 12.5 }))
    expect(text).toBe('฿12.50 / EA')
  })

  test('a non-finite cost renders the not-set label', () => {
    const { text } = render(product({ unitType: 'EA', cost: Number.NaN }))
    expect(text).toBe('ยังไม่ระบุ')
  })

  test('showLabel prefixes the base-unit label, as the mobile card asks for', () => {
    const { text } = render(product({ unitType: 'EA', cost: 12.5 }), true)
    expect(text).toBe('ต้นทุน/หน่วย: ฿12.50 / EA')
  })

  test('the invoice hint lives in the title only — never a second printed line that widens the row', () => {
    const { text, html } = render(
      product({
        unitType: 'EA',
        cost: 15,
        costHistory: [{ price: 360, unit: 'Carton', factor: 24, cost: 15, effectiveAt: 1000, at: 1000, by: 'u1', byName: 'Admin' }],
      }),
    )
    expect(text).toBe('฿15.00 / EA')
    expect(text).not.toContain('ตามใบแจ้งหนี้')
    expect(html).toContain('ตามใบแจ้งหนี้ ฿360.00 / Carton (×24)')
    expect(html).toContain('title=')
  })

  test('the primary value is one nowrap unit, so ฿15.00 never breaks away from its unit', () => {
    const { html } = render(product({ unitType: 'EA', cost: 15 }))
    const wrapped = html.match(/<([a-z]+)[^>]*class="[^"]*whitespace-nowrap[^"]*"[^>]*>[\s\S]*?฿15\.00[\s\S]*?\/ EA[\s\S]*?<\/\1>/)
    expect(wrapped).not.toBeNull()
  })
})

describe('Products table columns at 1440', () => {
  test('the Category column is 2xl-only, so it is no longer a 1440 column that costs Location', () => {
    const category = productColumns(t, (id) => id, '').find((c) => c.key === 'category')
    expect(category?.className).toContain('2xl:table-cell')
    expect(category?.className).toContain('hidden')
  })
})
