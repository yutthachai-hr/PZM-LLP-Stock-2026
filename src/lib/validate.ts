import { AppError } from '../i18n/AppError'

// ---------------------------------------------------------------------------
// Runtime checks for values arriving at the service layer.
//
// TypeScript says these are numbers; it does not say they are finite, positive, or
// representable. `Infinity` and `NaN` are both `number`, both survive `qty > 0` or
// `targetQty < 0` in one direction or the other, and both reach Firestore intact — which
// is how a balance ends up as NaN and every report about it turns to blanks.
//
// The forms check most of this too. These are here because the forms are not the only
// caller: a restore, an import, or anyone with an API token also gets here.
// ---------------------------------------------------------------------------

/**
 * Quantities are stored to three decimals, everywhere.
 *
 * The ledger used to keep the raw number while balances were rounded, so receiving 0.0004
 * twice added 0.0008 to the history and nothing to the balance. One precision for both
 * ends that: anything the system cannot represent is refused at the door rather than
 * silently dropped somewhere downstream.
 */
export const QTY_DECIMALS = 3
export const QTY_STEP = 0.001
/** Enough for any real warehouse, small enough that no total can reach 2^53. */
export const QTY_MAX = 1_000_000_000

export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * A quantity that can actually be recorded: finite, positive, and not smaller than the
 * stored precision. Returns it rounded, so callers write the same value they validated.
 */
export function requireQty(v: number, name?: string): number {
  if (!finite(v) || v <= 0) {
    throw new AppError('จำนวนต้องมากกว่า 0')
  }
  if (v > QTY_MAX) {
    throw new AppError('จำนวนมากเกินไป (สูงสุด {max})', { max: QTY_MAX })
  }
  const rounded = roundQty(v)
  if (rounded <= 0) {
    throw new AppError(
      'จำนวนของ "{name}" น้อยกว่าที่ระบบเก็บได้ (ขั้นต่ำ {step})',
      { name: name ?? '-', step: QTY_STEP },
    )
  }
  return rounded
}

/** Same, but zero is a legitimate answer — a physical count of nothing left. */
export function requireCountQty(v: number): number {
  if (!finite(v) || v < 0) {
    throw new AppError('จำนวนต้องไม่ติดลบ')
  }
  if (v > QTY_MAX) {
    throw new AppError('จำนวนมากเกินไป (สูงสุด {max})', { max: QTY_MAX })
  }
  return roundQty(v)
}

/** 1970 to 2100. A NaN date sorts nowhere and quietly falls out of every report. */
export function requireEpochMs(v: number): number {
  if (!finite(v) || v < 0 || v > 4102444800000) {
    throw new AppError('วันที่ไม่ถูกต้อง')
  }
  return v
}

export function requireOneOf<T extends string>(v: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) {
    throw new AppError('ค่าไม่ถูกต้อง: {value}', { value: String(v) })
  }
  return v as T
}

export function requireId(v: string, what: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new AppError('ข้อมูลไม่ครบ: {what}', { what })
  }
  return v
}
