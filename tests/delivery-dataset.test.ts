// Model readiness (S5): a dataset without leakage, split by time, with a readiness gate.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { datasetRows, FEATURE_SET_VERSION, readiness, timeSplit, toCsv } from '../src/lib/deliveryDataset'
import { bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { PurchaseOrder } from '../src/types'

const D = bkkDayStart(Date.UTC(2026, 9, 6, 3))
let seq = 0
function done(orderedDay: number, late: number): PurchaseOrder {
  const id = `po${++seq}`
  const orderedAt = D + orderedDay * DAY_MS
  const due = orderedAt + 2 * DAY_MS
  return {
    id, docNo: id, supplierId: 's', supplierName: 'S', status: 'received', locationId: 'l', orderedAt, expectedAt: bkkDayStart(due),
    lines: [{ productId: 'p', productName: 'p', unit: 'u', orderedQty: 1, receivedQty: 1 }],
    receipts: [{ docNo: `R${id}`, date: bkkDayStart(due) + late * DAY_MS + 3_600_000, invoiceNo: 'i', byId: 'u', byName: 'u', lines: [{ productId: 'p', qty: 1 }] }],
    createdBy: 'u', createdByName: 'u', createdAt: orderedAt, updatedAt: orderedAt,
  }
}

describe('the dataset', () => {
  const orders = [done(0, 3), done(10, 0), done(20, 1), done(30, 0)]
  const rows = datasetRows(orders)

  test('one row per finished, dated delivery, oldest first, versioned', () => {
    expect(rows.map((r) => r.onTime)).toEqual([0, 1, 0, 1])
    expect(rows.every((r) => r.featureSetVersion === FEATURE_SET_VERSION)).toBe(true)
  })

  test('history features only see deliveries finished before the order was placed', () => {
    expect(rows[0]).toMatchObject({ supplierHistoryN: 0, supplierOnTimeRate: null })
    expect(rows[1]).toMatchObject({ supplierHistoryN: 1, supplierOnTimeRate: 0, supplierAvgDelayDays: 3 })
    expect(rows[3]).toMatchObject({ supplierHistoryN: 3, recentLate3: 2 })
  })

  test('an order placed before an earlier one finished does not see that outcome', () => {
    // Placed day 1, while po(day 0, 3 late) only finished on day 5.
    const overlap = datasetRows([done(0, 3), done(1, 0)])
    expect(overlap[1].supplierHistoryN).toBe(0)
  })

  test('split by time, never shuffled', () => {
    const s = timeSplit(rows, D + 15 * DAY_MS, D + 25 * DAY_MS)
    expect([s.train.length, s.validation.length, s.test.length]).toEqual([2, 1, 1])
    expect(Math.max(...s.train.map((r) => r.orderedAt))).toBeLessThan(Math.min(...s.test.map((r) => r.orderedAt)))
  })

  test('not ready on a handful of rows; CSV has a header and a line per row', () => {
    expect(readiness(rows)).toMatchObject({ rows: 4, late: 2, ready: false, spanDays: 30 })
    expect(toCsv(rows).split('\n')).toHaveLength(5)
  })
})
