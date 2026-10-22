import { AppError } from '../i18n/AppError'
import type { StockMovement } from '../types'

/** The longest cancellation reason kept; firestore.rules enforces the same bound. */
export const VOID_REASON_MAX = 500

/** Trim and validate a cancellation reason, or refuse it (owner P0, 22 Oct 2026). */
export function normaliseVoidReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (!reason) throw new AppError('ต้องระบุเหตุผลการยกเลิก')
  if (reason.length > VOID_REASON_MAX) throw new AppError('เหตุผลยาวเกิน {max} ตัวอักษร', { max: VOID_REASON_MAX })
  return reason
}

type Voided = Pick<StockMovement, 'voided' | 'voidReason' | 'voidedAt' | 'voidedByName' | 'updatedAt' | 'updatedByName'>
type Tr = (s: string, v?: Record<string, string | number>) => string

/** Who cancelled, when. Rows voided before reasons existed fall back to their last-updated stamp. */
export function voidActor(m: Voided): { by: string; at: number | undefined } {
  return { by: m.voidedByName ?? m.updatedByName ?? '', at: m.voidedAt ?? m.updatedAt }
}

/** The reason, or the legacy label for a row cancelled before reasons were required — never invented. */
export function voidReasonText(m: Voided, t: Tr): string {
  return m.voidReason ? t('เหตุผล: {r}', { r: m.voidReason }) : t('ข้อมูลเดิม: ไม่มีเหตุผลการยกเลิก')
}

/** One line for tables and exports: "cancelled by X at T · reason". Empty for a live row. */
export function voidSummary(m: Voided, t: Tr, formatDateTime: (ms: number) => string): string {
  if (!m.voided) return ''
  const { by, at } = voidActor(m)
  return [t('ยกเลิกโดย {by} {at}', { by, at: at ? formatDateTime(at) : '' }).trim(), voidReasonText(m, t)].join(' · ')
}
