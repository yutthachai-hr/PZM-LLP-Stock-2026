import { roundQty } from '../../lib/validate'

export function parseDecimalInput(str: string): number {
  if (str.trim() === '') return 0
  const n = Number(str)
  return isNaN(n) ? 0 : roundQty(n)
}

export function formatDecimalInput(num: number, raw?: string): string {
  if (raw !== undefined) {
    const parsed = Number(raw)
    // If the raw text represents the same numeric value (e.g. '1.', '1.0', '1.063'), keep it
    if (!isNaN(parsed) && roundQty(parsed) === roundQty(num)) {
      return raw
    }
  }
  return String(roundQty(num))
}

export function calculateVariance(counted: number, expected: number): number {
  return roundQty(counted - expected)
}

export function validateReceiveQty(qty: number): { valid: boolean; error?: string } {
  if (isNaN(qty)) {
    return { valid: false, error: 'ระบุจำนวนที่ถูกต้อง' } // i18n-key
  }
  if (qty < 0) {
    return { valid: false, error: 'จำนวนต้องไม่ติดลบ' } // i18n-key
  }
  return { valid: true }
}

export interface SubmitGateTask<T> {
  confirm?: () => Promise<boolean>
  action: () => Promise<T>
}

export function createSubmitGate() {
  let locked = false
  return {
    isLocked: () => locked,
    execute: async <T>(task: SubmitGateTask<T>): Promise<T | null> => {
      if (locked) return null
      locked = true
      try {
        if (task.confirm && !(await task.confirm())) {
          locked = false
          return null
        }
        // Success keeps the gate shut: the receipt is filed and the page is leaving.
        return await task.action()
      } catch (e) {
        locked = false
        throw e
      }
    },
  }
}
