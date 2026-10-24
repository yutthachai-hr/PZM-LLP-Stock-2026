import { describe, expect, test, vi } from 'vitest'
import {
  createSubmitGate,
  formatDecimalInput,
  parseDecimalInput,
  validateReceiveQty,
  calculateVariance,
} from '../src/pages/transfers/receiveHelpers'

describe('TransferReceivePage: decimal input and precision', () => {
  test('preserves 3-decimal precision for 1.063 KG', () => {
    expect(parseDecimalInput('1.063')).toBe(1.063)
    expect(formatDecimalInput(1.063)).toBe('1.063')
    expect(calculateVariance(1.063, 1.063)).toBe(0)
  })

  test('interim decimal typing preserves trailing dot and zeros', () => {
    // In buggy React state, Number("1.") -> 1, converting back to "1" erases the dot.
    // parseDecimalInput with raw string preserves typing flow.
    expect(formatDecimalInput(1, '1.')).toBe('1.')
    expect(formatDecimalInput(1, '1.0')).toBe('1.0')
    expect(formatDecimalInput(1.06, '1.06')).toBe('1.06')
    expect(formatDecimalInput(1.063, '1.063')).toBe('1.063')
  })

  test('stepper bump handles decimal numbers and clamps at 0', () => {
    const bump = (val: number, by: number) => Math.max(0, Math.round((val + by) * 1000) / 1000)
    expect(bump(1.063, 1)).toBe(2.063)
    expect(bump(1.063, -1)).toBe(0.063)
    expect(bump(0.063, -1)).toBe(0)
  })

  test('validates negative and empty quantities', () => {
    expect(validateReceiveQty(-1)).toEqual({ valid: false, error: 'จำนวนต้องไม่ติดลบ' })
    expect(validateReceiveQty(NaN)).toEqual({ valid: false, error: 'ระบุจำนวนที่ถูกต้อง' })
    expect(validateReceiveQty(0)).toEqual({ valid: true })
    expect(validateReceiveQty(1.063)).toEqual({ valid: true })
  })
})

describe('TransferReceivePage: synchronous double-submit gate', () => {
  test('synchronous gate blocks concurrent calls during confirmation await', async () => {
    const gate = createSubmitGate()
    let confirmResolver: (val: boolean) => void = () => {}
    const slowConfirm = vi.fn(() => new Promise<boolean>((res) => { confirmResolver = res }))
    const submitService = vi.fn(async () => ({ status: 'completed' }))

    // First tap triggers confirmation prompt
    const call1 = gate.execute({ confirm: slowConfirm, action: submitService })
    expect(gate.isLocked()).toBe(true)

    // Second tap occurs immediately while confirmation is pending
    const call2 = gate.execute({ confirm: slowConfirm, action: submitService })
    expect(call2).resolves.toBe(null) // blocked by synchronous gate
    expect(slowConfirm).toHaveBeenCalledTimes(1)

    // Resolve confirmation
    confirmResolver(true)
    await call1

    expect(submitService).toHaveBeenCalledTimes(1)
    expect(gate.isLocked()).toBe(false)
  })

  test('cancelling confirmation releases synchronous gate', async () => {
    const gate = createSubmitGate()
    const confirmFalse = vi.fn(async () => false)
    const submitService = vi.fn()

    const res = await gate.execute({ confirm: confirmFalse, action: submitService })
    expect(res).toBe(null)
    expect(submitService).not.toHaveBeenCalled()
    expect(gate.isLocked()).toBe(false) // gate released on cancel
  })

  test('service failure releases synchronous gate for retry', async () => {
    const gate = createSubmitGate()
    const confirmTrue = vi.fn(async () => true)
    const failingService = vi.fn(async () => { throw new Error('network timeout') })

    await expect(gate.execute({ confirm: confirmTrue, action: failingService })).rejects.toThrow('network timeout')
    expect(gate.isLocked()).toBe(false) // gate released on failure
  })
})
