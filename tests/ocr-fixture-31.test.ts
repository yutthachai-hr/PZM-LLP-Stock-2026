// The 31-row synthetic bill (tests/fixtures/ocr): a model that reads it perfectly must leave every row in front of the
// person — the three with no number ("-", "ตาม") included — and nothing may be imported without their confirmation.
// The reading itself is the server's model; this proves what the app does with a faithful reading of the fixture.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanOcr, ocrCandidates } from '../src/lib/billOcr'
import { blockedReason, choose, importable, planRows, setInclude } from '../src/lib/importReview'
import { ocrFill } from '../src/pages/receive/ocrApply'
import type { Product } from '../src/types'

const truth = JSON.parse(readFileSync(new URL('./fixtures/ocr/synthetic-31-groundtruth.json', import.meta.url), 'utf8')) as {
  metadata: { totalRows: number; numericRows: number; manualRows: number[] }
  rows: { index: number; name: string; unit: string; orderQty: string; isManual: boolean }[]
}
// The model's answer, shaped as the server returns it: one line per row, quantity as written.
const reply = { lines: truth.rows.map((r) => ({ name: r.name, qty: r.orderQty, unit: r.unit })) }
const product = (id: string, name: string, unitType: string): Product =>
  ({ id, sku: id.toUpperCase(), name, category: 'c', unit: unitType, unitType, minStock: 0, hasImage: false, active: true, cost: 1, createdAt: 1, updatedAt: 1 }) as Product

describe('31-row synthetic bill', () => {
  const bill = cleanOcr(reply)

  test('every row survives the reading, in order, names intact', () => {
    expect(truth.metadata.totalRows).toBe(31)
    expect(bill.lines).toHaveLength(31)
    expect(bill.lines.map((l) => l.name)).toEqual(truth.rows.map((r) => r.name))
  })

  test('the numeric rows keep their quantity; the manual rows carry none', () => {
    const manual = new Set(truth.metadata.manualRows)
    expect(truth.rows.filter((r) => !manual.has(r.index))).toHaveLength(truth.metadata.numericRows)
    truth.rows.forEach((r, i) => expect(bill.lines[i].qty).toBe(manual.has(r.index) ? 0 : Number(r.orderQty)))
  })

  test('nothing from the reading is ticked or importable until the person acts', () => {
    const flour = product('m1', truth.rows[0].name, truth.rows[0].unit)
    const rows = planRows(bill.lines.map((l) => ({ ...l, source: 'ocr' as const })), [flour])
    expect(rows).toHaveLength(31)
    expect(rows.every((r) => !r.include && r.how !== 'sure')).toBe(true)
    expect(importable(rows)).toEqual([])
  })

  test('a numeric row becomes importable once the person picks its product', () => {
    const p = product('m1', truth.rows[0].name, truth.rows[0].unit)
    const [row] = planRows([{ ...bill.lines[0], source: 'ocr' }], [p])
    expect(importable([choose(row, p)])).toHaveLength(1)
  })

  test('a manual row stays shown and blocked even after a product is picked and ticked', () => {
    for (const idx of truth.metadata.manualRows) {
      const line = bill.lines[idx - 1]
      const p = product(`m${idx}`, line.name, line.unit ?? 'KG')
      const [row] = planRows([{ ...line, source: 'ocr' }], [p])
      const picked = setInclude(choose(row, p), true)
      expect(blockedReason(picked)).toBe('bad-qty')
      expect(importable([picked])).toEqual([])
    }
  })

  test('receiving lists every unread row for the person, manual ones as having no quantity', () => {
    const draft = { invoiceNo: '', docDateStr: '', supplierId: '', supplierName: '', lines: [], entries: {} } as never
    const fill = ocrFill(bill, ocrCandidates(bill), { draft, order: null, suppliers: [] })
    expect(fill.filled).toBe(0)
    expect(fill.skipped).toHaveLength(31)
    const manual = new Set(truth.metadata.manualRows.map((i) => truth.rows[i - 1].name))
    for (const s of fill.skipped) expect(s.why).toBe(manual.has(s.name) ? 'noQty' : 'noProduct')
  })
})
