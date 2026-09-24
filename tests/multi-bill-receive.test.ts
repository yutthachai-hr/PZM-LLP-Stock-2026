// Receiving several suppliers' bills in one sitting (owner, 24 Sep 2026: "เรารับเข้า 1 วัน
// หลายรายการ หลายซับพลายเออ").
//
//   npm test
//
// The screen holds one card per bill; saving files one RC- document per bill, its note the
// bill's number. What is checked here is the part that decides what gets filed: which bills
// count, which are refused and why, and how a half-keyed draft comes back.

import { describe, expect, test } from 'vitest'

const { emptyBill, planBills, restoreBills } = await import('../src/pages/receive/bills')

const line = (productId: string, qty = 1) => ({ productId, productName: productId, unit: 'EA', qty })
const bill = (note: string, lines: ReturnType<typeof line>[]) => ({ ...emptyBill(), note, lines })

describe('planBills — what a save will file', () => {
  test('every bill with lines and a number is filed, in the order it was keyed', () => {
    const r = planBills([bill('SIAMFOOD IV1', [line('beef', 40)]), bill('MASSWELL INV-8', [line('towels', 2)])])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bills.map((b) => b.note)).toEqual(['SIAMFOOD IV1', 'MASSWELL INV-8'])
  })

  test('a card left completely empty is not a bill, and is skipped', () => {
    const r = planBills([bill('SIAMFOOD IV1', [line('beef')]), emptyBill(), bill('  ', [])])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bills).toHaveLength(1)
  })

  test('lines with no bill number are refused, naming the card', () => {
    expect(planBills([bill('SIAMFOOD IV1', [line('beef')]), bill('', [line('towels')])])).toEqual({ ok: false, index: 1, reason: 'noNote' })
  })

  test('a bill number with nothing on it is refused, naming the card', () => {
    expect(planBills([bill('MASSWELL INV-8', [])])).toEqual({ ok: false, index: 0, reason: 'noLines' })
  })

  test('a quantity of nothing is refused, naming the card', () => {
    expect(planBills([bill('A', [line('beef', 1)]), bill('B', [line('towels', 0)])])).toEqual({ ok: false, index: 1, reason: 'badQty' })
  })

  test('a screen with nothing at all on it is refused as a whole', () => {
    expect(planBills([emptyBill()])).toEqual({ ok: false, index: 0, reason: 'nothing' })
  })

  test('the same product may arrive on two suppliers’ bills', () => {
    const r = planBills([bill('A', [line('beef', 2)]), bill('B', [line('beef', 3)])])
    expect(r.ok).toBe(true)
  })

  test('the bill number is filed without the spaces around it', () => {
    const r = planBills([bill('  SIAMFOOD IV1 \n', [line('beef')])])
    expect(r.ok && r.bills[0].note).toBe('SIAMFOOD IV1')
  })
})

describe('restoreBills — a half-keyed screen comes back', () => {
  test('a draft of bills comes back as those bills', () => {
    const saved = { bills: [bill('A', [line('beef')]), bill('B', [line('towels')])] }
    expect(restoreBills(saved).map((b) => b.note)).toEqual(['A', 'B'])
  })

  test('a draft from before bills existed becomes the first bill, not lost', () => {
    const old = { note: 'SIAMFOOD IV1', lines: [line('beef', 40)] }
    const r = restoreBills(old)
    expect(r).toHaveLength(1)
    expect(r[0].note).toBe('SIAMFOOD IV1')
    expect(r[0].lines).toHaveLength(1)
  })

  test('anything unreadable comes back as one empty bill, never as none', () => {
    for (const junk of [null, undefined, 42, { bills: 'no' }, { bills: [] }]) {
      const r = restoreBills(junk)
      expect(r).toHaveLength(1)
      expect(r[0].lines).toEqual([])
    }
  })

  test('every bill has its own id, so two cards never share one', () => {
    const r = restoreBills({ bills: [{ note: 'A', lines: [] }, { note: 'B', lines: [] }] })
    expect(new Set(r.map((b) => b.id)).size).toBe(2)
  })
})
