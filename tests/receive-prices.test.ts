;(globalThis as unknown as { window?: unknown }).window ??= { addEventListener() {} }

import { describe, expect, test } from 'vitest'
import React from 'react'
import ReactDOMServer from 'react-dom/server'
import type { Product, PurchaseOrder, SupplierItem } from '../src/types'
import {
  priceSourceLabel,
  resolveLinePricing,
  summariseReceiptPrices,
} from '../src/pages/receive/receipt'
import { I18nProvider } from '../src/i18n/I18nContext'
import type { ReceiptFacts } from '../src/pages/receive/ReceiptReview'

const { ReceiptPanel, ReviewModal } = await import('../src/pages/receive/ReceiptReview')

describe('receive page prices: line pricing and source labels', () => {
  const asOf = new Date('2026-10-24T12:00:00Z').getTime()
  const supplierId = 'sup-1'

  const products: Pick<Product, 'id' | 'cost' | 'costHistory'>[] = [
    {
      id: 'prod-sup',
      cost: 120,
      costHistory: [{ effectiveAt: asOf - 86400000, cost: 110 }],
    },
    {
      id: 'prod-cost-asof',
      cost: 80,
      costHistory: [
        { effectiveAt: asOf - 172800000, cost: 70 },
        { effectiveAt: asOf + 86400000, cost: 95 },
      ],
    },
    {
      id: 'prod-cost-latest',
      costHistory: [{ effectiveAt: asOf + 86400000, cost: 60 }],
    },
    {
      id: 'prod-cost-master',
      cost: 50,
    },
    {
      id: 'prod-missing',
    },
  ]

  const supplierItems: Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[] = [
    { supplierId, productId: 'prod-sup', buyingPrice: 100, active: true },
  ]

  test('line with supplier price: source label is "ราคาผู้ขาย" and computes entered amount', () => {
    const line = { productId: 'prod-sup', unit: 'KG', orderedQty: 10 }
    const res = resolveLinePricing(line, supplierId, { qty: 3, reason: '' }, products, supplierItems, asOf)

    expect(res.price.source).toBe('supplierPrice')
    expect(res.price.unitPrice).toBe(100)
    expect(res.sourceLabel).toBe('ราคาผู้ขาย')
    expect(priceSourceLabel(res.price)).toBe('ราคาผู้ขาย')
    expect(res.amount).toBe(300)
  })

  test('line with costAsOf: source label includes Thai formatted date', () => {
    const line = { productId: 'prod-cost-asof', unit: 'KG', orderedQty: 5 }
    const res = resolveLinePricing(line, supplierId, { qty: 2, reason: '' }, products, supplierItems, asOf)

    expect(res.price.source).toBe('costAsOf')
    expect(res.price.unitPrice).toBe(70)
    expect(res.sourceLabel).toMatch(/^ต้นทุน ณ \d{2}\/\d{2}\/\d{4}$/)
    expect(res.amount).toBe(140)
  })

  test('line with costLatest: source label is "ต้นทุนล่าสุด"', () => {
    const line = { productId: 'prod-cost-latest', unit: 'KG', orderedQty: 4 }
    const res = resolveLinePricing(line, supplierId, { qty: 1.5, reason: '' }, products, supplierItems, asOf)

    expect(res.price.source).toBe('costLatest')
    expect(res.price.unitPrice).toBe(60)
    expect(res.sourceLabel).toBe('ต้นทุนล่าสุด')
    expect(res.amount).toBe(90)
  })

  test('line with costLatest from master product cost: source label is "ต้นทุนล่าสุด"', () => {
    const line = { productId: 'prod-cost-master', unit: 'KG', orderedQty: 4 }
    const res = resolveLinePricing(line, supplierId, { qty: 1.5, reason: '' }, products, supplierItems, asOf)

    expect(res.price.source).toBe('costLatest')
    expect(res.price.unitPrice).toBe(50)
    expect(res.sourceLabel).toBe('ต้นทุนล่าสุด')
    expect(res.amount).toBe(75)
  })

  test('line with missing price: source label is "ยังไม่ระบุราคา", amount is null', () => {
    const line = { productId: 'prod-missing', unit: 'KG', orderedQty: 2 }
    const res = resolveLinePricing(line, supplierId, { qty: 2, reason: '' }, products, supplierItems, asOf)

    expect(res.price.source).toBe('missing')
    expect(res.price.unitPrice).toBeNull()
    expect(res.sourceLabel).toBe('ยังไม่ระบุราคา')
    expect(res.amount).toBeNull()
  })

  test('unentered line shows no amount (null, never 0)', () => {
    const line = { productId: 'prod-sup', unit: 'KG', orderedQty: 10 }
    const res = resolveLinePricing(line, supplierId, undefined, products, supplierItems, asOf)

    expect(res.price.unitPrice).toBe(100)
    expect(res.amount).toBeNull()
  })
})

describe('receive page prices: summary calculation', () => {
  const asOf = new Date('2026-10-24T12:00:00Z').getTime()
  const supplierId = 'sup-1'

  const order: Pick<PurchaseOrder, 'supplierId' | 'lines'> = {
    supplierId,
    lines: [
      { productId: 'p1', productName: 'Item 1', unit: 'KG', orderedQty: 10 },
      { productId: 'p2', productName: 'Item 2', unit: 'KG', orderedQty: 5 },
      { productId: 'p3', productName: 'Item 3', unit: 'KG', orderedQty: 4 },
    ],
  }

  const products: Pick<Product, 'id' | 'cost' | 'costHistory'>[] = [
    { id: 'p1', cost: 100 },
    { id: 'p2', cost: 50 },
    { id: 'p3' }, // missing price
  ]

  const supplierItems: Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[] = [
    { supplierId, productId: 'p1', buyingPrice: 100, active: true },
  ]

  test('3 lines: enter 2 quantities (1 priced, 1 unpriced), leave 1 unentered', () => {
    // p1 entered = 2 (price 100 -> 200)
    // p2 unentered = null (price 50 -> not in total)
    // p3 entered = 3 (price missing -> missingLines)
    const entries = {
      p1: { qty: 2, reason: '' },
      p3: { qty: 3, reason: '' },
    }

    const summary = summariseReceiptPrices(order, entries, products, supplierItems, asOf)

    expect(summary.estimatedTotal).toBe(200)
    expect(summary.pricedLines).toBe(1)
    expect(summary.missingLines).toBe(1)
    expect(summary.unenteredLines).toBe(1)
  })

  test('all entered lines unpriced: estimatedTotal is 0, pricedLines is 0, missingLines is 1', () => {
    const entries = {
      p3: { qty: 4, reason: '' },
    }
    const summary = summariseReceiptPrices(order, entries, products, supplierItems, asOf)
    expect(summary.estimatedTotal).toBe(0)
    expect(summary.pricedLines).toBe(0)
    expect(summary.missingLines).toBe(1)
  })

  test('all quantities blank: estimatedTotal is 0, pricedLines is 0, missingLines is 0', () => {
    const entries = {}
    const summary = summariseReceiptPrices(order, entries, products, supplierItems, asOf)
    expect(summary.estimatedTotal).toBe(0)
    expect(summary.pricedLines).toBe(0)
    expect(summary.missingLines).toBe(0)
    expect(summary.unenteredLines).toBe(3)
  })

  test('legitimately priced-at-zero entered line: estimatedTotal is 0, pricedLines is 1, missingLines is 0', () => {
    const zeroPriceOrder = {
      supplierId,
      lines: [{ productId: 'p-zero', productName: 'Free Sample', unit: 'EA', orderedQty: 10 }],
    }
    const zeroSupplierItems = [
      { supplierId, productId: 'p-zero', buyingPrice: 0, active: true },
    ]
    const entries = {
      'p-zero': { qty: 5, reason: '' },
    }
    const summary = summariseReceiptPrices(zeroPriceOrder, entries, [], zeroSupplierItems, asOf)
    expect(summary.estimatedTotal).toBe(0)
    expect(summary.pricedLines).toBe(1)
    expect(summary.missingLines).toBe(0)
  })
})

function renderPanel(facts: Omit<ReceiptFacts, 'date' | 'docDate' | 'hasPhoto' | 'note'> & { pricedLines?: number }) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ReceiptPanel, {
        mode: 'po',
        facts: facts as any,
        pending: 0,
        problem: null,
        busy: false,
        onReview: () => {},
      })
    )
  )
}

function renderReviewModal(facts: ReceiptFacts & { pricedLines?: number }) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ReviewModal, {
        open: true,
        mode: 'po',
        facts: facts as any,
        exceptions: [],
        canCloseShort: false,
        closeShort: false,
        closeReason: '',
        duplicate: null,
        busy: false,
        onClose: () => {},
        onConfirm: () => {},
        onToggleCloseShort: () => {},
        onChangeCloseReason: () => {},
      })
    )
  )
}

describe('ReceiptPanel and ReviewModal UI: unpriced/blank vs zero-price display', () => {
  const baseFacts: ReceiptFacts = {
    supplierName: 'Sup A',
    poDocNo: 'PO-001',
    warehouse: 'Main WH',
    date: Date.now(),
    invoiceNo: 'INV-01',
    docDate: Date.now(),
    hasPhoto: false,
    note: '',
    items: 1,
    matched: 1,
    short: 0,
    over: 0,
  }

  test('all-unpriced: displays "—" (no ฿0.00) with missing lines footnote in ReceiptPanel', () => {
    const facts = {
      ...baseFacts,
      estimatedTotal: 0,
      pricedLines: 0,
      missingLines: 1,
    }
    const html = renderPanel(facts)
    expect(html).toContain('มูลค่าประมาณการ')
    expect(html).toContain('—')
    expect(html).not.toContain('฿0.00')
    expect(html).toContain('ยังไม่ระบุราคา 1 รายการ')
  })

  test('all-blank quantities: displays "—" (no ฿0.00) in ReceiptPanel', () => {
    const facts = {
      ...baseFacts,
      estimatedTotal: 0,
      pricedLines: 0,
      missingLines: 0,
    }
    const html = renderPanel(facts)
    expect(html).toContain('มูลค่าประมาณการ')
    expect(html).toContain('—')
    expect(html).not.toContain('฿0.00')
  })

  test('legitimately priced-at-zero: displays "฿0.00" in ReceiptPanel', () => {
    const facts = {
      ...baseFacts,
      estimatedTotal: 0,
      pricedLines: 1,
      missingLines: 0,
    }
    const html = renderPanel(facts)
    expect(html).toContain('มูลค่าประมาณการ')
    expect(html).toContain('฿0.00')
  })

  test('all-unpriced: displays "—" (no ฿0.00) with missing lines footnote in ReviewModal', () => {
    const facts = {
      ...baseFacts,
      estimatedTotal: 0,
      pricedLines: 0,
      missingLines: 1,
    }
    const html = renderReviewModal(facts)
    expect(html).toContain('มูลค่าประมาณการ')
    expect(html).toContain('—')
    expect(html).not.toContain('฿0.00')
    expect(html).toContain('ยังไม่ระบุราคา 1 รายการ')
  })

  test('all-blank quantities: displays "—" (no ฿0.00) in ReviewModal', () => {
    const facts = {
      ...baseFacts,
      estimatedTotal: 0,
      pricedLines: 0,
      missingLines: 0,
    }
    const html = renderReviewModal(facts)
    expect(html).toContain('มูลค่าประมาณการ')
    expect(html).toContain('—')
    expect(html).not.toContain('฿0.00')
  })

  test('legitimately priced-at-zero: displays "฿0.00" in ReviewModal', () => {
    const facts = {
      ...baseFacts,
      estimatedTotal: 0,
      pricedLines: 1,
      missingLines: 0,
    }
    const html = renderReviewModal(facts)
    expect(html).toContain('มูลค่าประมาณการ')
    expect(html).toContain('฿0.00')
  })
})
