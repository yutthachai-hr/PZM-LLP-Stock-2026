import { expect, test } from 'vitest'
import { draftIsEmpty, emptyDraft, experimentalEligible, experimentalInput, manualProblem } from '../src/pages/receive/receipt'

const row = { draftId: 'draft-a', parentId: 'parent', name: 'Anchor Cream Cheese', spec: '200 g', qty: 5, unit: 'Pack', expectedBaseQty: 5 }
const other = { id: 'real-other', name: 'OTHER', active: true }

test('eligibility: brand rnd + manual mode + a real active OTHER supplier record', () => {
  expect(experimentalEligible('manual', 'rnd', other, 'admin')).toBe(true)
  expect(experimentalEligible('manual', 'rnd', { ...other, active: false }, 'admin')).toBe(false)
  expect(experimentalEligible('manual', 'rnd', { id: 'n', name: 'Normal supplier', active: true }, 'admin')).toBe(false)
  expect(experimentalEligible('manual', 'rnd', null, 'admin')).toBe(false)
  expect(experimentalEligible('po', 'rnd', other, 'admin')).toBe(false)
  expect(experimentalEligible('manual', 'pizza', other, 'admin')).toBe(false)
  expect(experimentalEligible('manual', 'lelapin', other, 'admin')).toBe(false)
  // Catalogue authority is admin-only on the server; the screen does not offer what it refuses.
  expect(experimentalEligible('manual', 'rnd', other, 'manager')).toBe(false)
  expect(experimentalEligible('manual', 'rnd', other, 'staff')).toBe(false)
  expect(experimentalEligible('manual', 'rnd', other, undefined)).toBe(false)
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

test('server refusal codes reach the person as words, not codes', async () => {
  const { ExperimentalClientError } = await import('../src/services/experimentalErrors')
  const { errText } = await import('../src/i18n/AppError')
  const say = (code: string) => errText(new ExperimentalClientError(code, false), (k) => k)
  for (const code of ['invalid', 'ineligible', 'forbidden', 'stale', 'existing', 'collision', 'operation_conflict', 'not_configured', 'unauthorized', 'too_large', 'unknown_outcome', 'something_new']) {
    expect(say(code)).not.toMatch(/^[a-z_]+$/)
  }
  expect(say('stale')).not.toBe(say('forbidden'))
  expect(new ExperimentalClientError('stale', false).code).toBe('stale')
})
