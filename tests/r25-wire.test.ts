import { expect, test } from 'vitest'
import { draftIsEmpty, emptyDraft, experimentalEligible, experimentalInput, manualProblem } from '../src/pages/receive/receipt'

const row = { draftId: 'draft-a', parentId: 'parent', name: 'Anchor Cream Cheese', spec: '200 g', qty: 5, unit: 'Pack', expectedBaseQty: 5 }
const other = { id: 'real-other', name: 'OTHER', active: true }

test('eligibility: brand rnd + manual mode + a real active OTHER supplier record', () => {
  expect(experimentalEligible('manual', 'rnd', other)).toBe(true)
  expect(experimentalEligible('manual', 'rnd', { ...other, active: false })).toBe(false)
  expect(experimentalEligible('manual', 'rnd', { id: 'n', name: 'Normal supplier', active: true })).toBe(false)
  expect(experimentalEligible('manual', 'rnd', null)).toBe(false)
  expect(experimentalEligible('po', 'rnd', other)).toBe(false)
  expect(experimentalEligible('manual', 'pizza', other)).toBe(false)
  expect(experimentalEligible('manual', 'lelapin', other)).toBe(false)
})

test('input builder fixes brand rnd and freezes the draft shape for the commit', () => {
  const d = { ...emptyDraft(), mode: 'manual' as const, experimental: [row], invoiceNo: 'SYNTHETIC-R25', note: ' notes ' }
  const input = experimentalInput(d, { operationId: '11111111-1111-4111-8111-111111111111', toLocationId: 'wh', date: 5, docDate: 6 })
  expect(input).toEqual({
    brand: 'rnd', mode: 'manual', operationId: '11111111-1111-4111-8111-111111111111',
    supplierId: d.supplierId, toLocationId: 'wh', date: 5, docDate: 6,
    invoiceNo: 'SYNTHETIC-R25', note: 'notes', lines: d.lines, experimental: [row],
  })
  expect(draftIsEmpty({ ...emptyDraft(), experimental: [row] })).toBe(false)
})

test('experimental rows alone satisfy the manual receipt line requirement', () => {
  expect(manualProblem([], 'OTHER', 'IV', 1)).toBeNull()
  expect(manualProblem([], 'OTHER', 'IV', 0)).toBe('noLines')
  expect(manualProblem([], '', 'IV', 1)).toBe('noSupplier')
})
