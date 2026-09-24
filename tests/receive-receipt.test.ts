// The receiving screen's arithmetic (owner, 24 Sep 2026: pick the PO, "รับครบตาม PO", fix
// what differs, review, confirm).
//
//   npm test
//
// Everything is measured against what is still outstanding on the order, because a short
// delivery keeps the order open for the rest.

import { describe, expect, test } from 'vitest'

const r = await import('../src/pages/receive/receipt')

const po = (lines: { productId: string; orderedQty: number; receivedQty?: number }[]) => ({
  lines: lines.map((l) => ({ productName: l.productId, unit: 'EA', ...l })),
})

describe('variance', () => {
  test('match, short, over and not yet keyed', () => {
    expect(r.variance(10, 10)).toBe('match')
    expect(r.variance(10, 8)).toBe('short')
    expect(r.variance(10, 0)).toBe('short')
    expect(r.variance(10, 12)).toBe('over')
    expect(r.variance(10, null)).toBe('pending')
  })

  test('floating-point noise is not a discrepancy', () => {
    expect(r.variance(0.3, 0.1 + 0.2)).toBe('match')
  })
})

describe('against what is outstanding', () => {
  const order = po([
    { productId: 'a', orderedQty: 10, receivedQty: 4 },
    { productId: 'b', orderedQty: 5, receivedQty: 5 },
    { productId: 'c', orderedQty: 3 },
  ])

  test('a line already delivered in full is not asked about again', () => {
    expect(r.owedLines(order).map((l) => l.productId)).toEqual(['a', 'c'])
    expect(r.outstanding(order.lines[0])).toBe(6)
  })

  test('"receive all" fills every owed line with what is still to come, keeping reasons', () => {
    const all = r.receiveAll(order, { a: { qty: 2, reason: 'box torn' } })
    expect(all).toEqual({ a: { qty: 6, reason: 'box torn' }, c: { qty: 3, reason: '' } })
    expect(r.summarise(order, all)).toMatchObject({ items: 2, matched: 2, short: 0, over: 0, pending: 0 })
  })

  test('the summary counts each kind, and the lines still owing a reason', () => {
    const s = r.summarise(order, { a: { qty: 5, reason: '' }, c: { qty: 4, reason: 'extra' } })
    expect(s).toMatchObject({ items: 2, matched: 0, short: 1, over: 1, unexplained: 1, arriving: 2 })
  })
})

describe('what stops the review', () => {
  const order = po([{ productId: 'a', orderedQty: 10 }, { productId: 'b', orderedQty: 2 }])

  test('no order, a line not keyed, a difference with no reason, nothing arriving, no bill number', () => {
    expect(r.poProblem(null, {}, 'IV')).toBe('noOrder')
    expect(r.poProblem(order, { a: { qty: 10, reason: '' } }, 'IV')).toBe('pending')
    expect(r.poProblem(order, { a: { qty: 9, reason: '' }, b: { qty: 2, reason: '' } }, 'IV')).toBe('unexplained')
    expect(r.poProblem(order, { a: { qty: 0, reason: 'x' }, b: { qty: 0, reason: 'x' } }, 'IV')).toBe('nothing')
    expect(r.poProblem(order, r.receiveAll(order, {}), '  ')).toBe('noInvoice')
    expect(r.poProblem(order, r.receiveAll(order, {}), 'IV-1')).toBeNull()
  })

  test('a hand-keyed receipt needs lines, quantities, a supplier and a bill number', () => {
    const line = { productId: 'p', productName: 'P', unit: 'EA', qty: 1 }
    expect(r.manualProblem([], 'S', 'IV')).toBe('noLines')
    expect(r.manualProblem([{ ...line, qty: 0 }], 'S', 'IV')).toBe('badQty')
    expect(r.manualProblem([line], ' ', 'IV')).toBe('noSupplier')
    expect(r.manualProblem([line], 'S', '')).toBe('noInvoice')
    expect(r.manualProblem([line], 'S', 'IV')).toBeNull()
  })
})

describe('restoreReceipt — a draft from any version of this screen', () => {
  const line = { productId: 'p', productName: 'P', unit: 'EA', qty: 3 }

  test('this version comes back as it was saved', () => {
    const d = { ...r.emptyDraft(), poId: 'po1', entries: { p: { qty: 2, reason: 'short' } }, invoiceNo: 'IV-1', toLocationId: 'wh' }
    expect(r.restoreReceipt(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })

  test('the multi-bill draft: first bill becomes a hand-keyed receipt, the rest wait their turn', () => {
    const d = r.restoreReceipt({ toLocationId: 'wh', dateStr: '2026-09-24', bills: [
      { id: 'x', note: 'SIAMFOOD IV1', lines: [line] },
      { id: 'y', note: '', lines: [] },
      { id: 'z', note: 'MASSWELL INV-8', lines: [line] },
    ] })
    expect(d).toMatchObject({ mode: 'manual', note: 'SIAMFOOD IV1', lines: [line], toLocationId: 'wh', dateStr: '2026-09-24' })
    expect(d.queue).toEqual([{ note: 'MASSWELL INV-8', lines: [line] }])
    const next = r.nextQueued(d)
    expect(next).toMatchObject({ mode: 'manual', note: 'MASSWELL INV-8', queue: [] })
    expect(r.nextQueued(next!)).toBeNull()
  })

  test('the single form before that comes back as a hand-keyed receipt', () => {
    expect(r.restoreReceipt({ note: 'IV2616876', lines: [line, { junk: 1 }] })).toMatchObject({ mode: 'manual', note: 'IV2616876', lines: [line] })
  })

  test('rubbish gives an empty receipt, never a crash', () => {
    expect(r.restoreReceipt(null)).toEqual(r.emptyDraft())
    expect(r.restoreReceipt({ mode: 'po', entries: { a: { qty: 'x' } } }).entries).toEqual({ a: { qty: null, reason: '' } })
  })

  test('an untouched form is not a draft', () => {
    expect(r.draftIsEmpty(r.emptyDraft())).toBe(true)
    expect(r.draftIsEmpty({ ...r.emptyDraft(), poId: 'po1' })).toBe(false)
  })
})
