import type { RiskLevel, RiskReasonCode } from './deliveryRisk'
import type { ShortageRisk } from './inventoryRisk'
import type { ScoreComponentKey } from './supplierScore'

/**
 * The words for risk and score explanations, as Thai translation keys with {slots}. Data
 * here, sentences on screen — the same split as the notification copy.
 */

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  LOW: 'ต่ำ', // i18n-key
  MEDIUM: 'ปานกลาง', // i18n-key
  HIGH: 'สูง', // i18n-key
  CRITICAL: 'วิกฤต', // i18n-key
}

export const RISK_LEVEL_COLOR: Record<RiskLevel, 'slate' | 'amber' | 'red' | 'blue'> = {
  LOW: 'slate',
  MEDIUM: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
}

export const RISK_REASON_TEXT: Record<RiskReasonCode, string> = {
  overdue: 'เลยวันส่งที่ยืนยันมาแล้ว {days} วัน', // i18n-key
  overduePerExtraDay: '', // folded into "overdue"
  otdBelow80: 'ผู้ขายส่งตรงเวลาเพียง {pct}% ({n} ครั้งล่าสุดใน 90 วัน)', // i18n-key
  otdBelow90: 'ผู้ขายส่งตรงเวลา {pct}% — ต่ำกว่า 90%', // i18n-key
  twoOfLastThreeLate: 'ส่งช้า {late} ใน 3 ครั้งล่าสุด', // i18n-key
  skuLateRate: '{product} ส่งช้า {pct}% ของ {n} ครั้ง (ช้าเฉลี่ย {avg} วัน)', // i18n-key
  supplierChangedDate: 'ผู้ขายเปลี่ยนวันส่งใบนี้แล้ว {n} ครั้ง', // i18n-key
  pendingApproval: 'วันส่งใหม่ยังรออนุมัติ', // i18n-key
  shortLeadTime: 'ให้เวลาผู้ขาย {lead} วัน น้อยกว่าปกติ ({normal} วัน)', // i18n-key
  slowConfirmation: 'ส่งลิงก์ไป {hours} ชม. แล้ว ผู้ขายยังไม่ตอบ', // i18n-key
  unconfirmedNearDue: 'ใกล้วันส่งแต่ผู้ขายยังไม่ยืนยัน', // i18n-key
  noHistory: 'ยังมีประวัติผู้ขายไม่พอ ({n} ครั้ง)', // i18n-key
}

export const SHORTAGE_REASON_TEXT: Record<ShortageRisk['reasons'][number]['code'], string> = {
  gap: 'ของจะหมดก่อน {docNo} ({supplier}) มาถึง {days} วัน', // i18n-key
  noIncoming: 'ไม่มีใบสั่งซื้อค้างอยู่ — จะหมดใน {days} วัน', // i18n-key
  insufficientIncoming: '{docNo} มาไม่พอ — จะหมดอีกครั้งใน {days} วัน', // i18n-key
  lateRiskWouldGap: 'ถ้า {docNo} ส่งช้า (ความเสี่ยง {score}/100) ของจะขาด', // i18n-key
  zeroStock: 'ตอนนี้ไม่มีของแล้ว', // i18n-key
}

export const SCORE_COMPONENT_LABEL: Record<ScoreComponentKey, string> = {
  onTime: 'ส่งตรงเวลา', // i18n-key
  fill: 'ส่งครบจำนวน', // i18n-key
  delaySeverity: 'ความรุนแรงของการช้า', // i18n-key
  acceptance: 'รับวันที่ขอ', // i18n-key
  response: 'ความเร็วในการตอบ', // i18n-key
  reliability: 'ไม่ยกเลิก', // i18n-key
}

export const CONFIDENCE_LABEL: Record<'insufficient' | 'low' | 'medium' | 'high', string> = {
  insufficient: 'ข้อมูลไม่พอ', // i18n-key
  low: 'ความเชื่อมั่นต่ำ', // i18n-key
  medium: 'ความเชื่อมั่นปานกลาง', // i18n-key
  high: 'ความเชื่อมั่นสูง', // i18n-key
}
