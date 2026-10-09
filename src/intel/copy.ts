import { RISK_REASON_TEXT, SCORE_COMPONENT_LABEL } from '../lib/riskCopy'
import type { RiskReasonCode } from '../lib/deliveryRisk'
import type { ScoreComponentKey } from '../lib/supplierScore'
import type { DataNote, Reason } from './meta'
import type { PurchaseStep } from './purchase'

/**
 * G7 — the words for WHY. Every reason code any engine under src/intel can return has a
 * sentence here (a test holds that), as Thai translation keys with {slots} filled from the
 * reason's params. Data, not prose in the engines: the same split as the notification copy.
 */

export const WHY_TEXT: Record<string, string> = {
  'component.onTime': 'ส่งตรงเวลา {hits}/{n} ครั้ง → {value} คะแนน × น้ำหนัก {weight}%', // i18n-key
  'component.fill': 'ส่งครบจำนวน {value}% × น้ำหนัก {weight}%', // i18n-key
  'component.delaySeverity': 'ช้าเฉลี่ย {raw} วันต่อครั้ง → {value} คะแนน × น้ำหนัก {weight}%', // i18n-key
  'component.acceptance': 'รับวันที่ขอ {hits}/{n} ครั้ง → {value} คะแนน × น้ำหนัก {weight}%', // i18n-key
  'component.response': 'ตอบเฉลี่ย {raw} นาที ({n} ครั้ง) → {value} คะแนน × น้ำหนัก {weight}%', // i18n-key
  'component.reliability': 'ยกเลิก {hits}/{n} ใบ → {value} คะแนน × น้ำหนัก {weight}%', // i18n-key
  delayDistribution: 'เมื่อส่งช้า: กลาง {median} วัน · P90 {p90} วัน ({late} ครั้ง)', // i18n-key
  'trend.up': 'แนวโน้มดีขึ้น: ตรงเวลา {recent}% (30 วันล่าสุด) จาก {previous}%', // i18n-key
  'trend.down': 'แนวโน้มแย่ลง: ตรงเวลา {recent}% (30 วันล่าสุด) จาก {previous}%', // i18n-key
  'trend.flat': 'แนวโน้มคงที่: ตรงเวลา {recent}% เทียบ {previous}%', // i18n-key
  dateChanges: 'ขอเลื่อนวันส่ง {changes} ครั้ง ใน {orders} ใบ', // i18n-key
  cancellations: 'ยกเลิก {n} จาก {of} ใบ', // i18n-key

  'stockout.basis': 'พร้อมใช้ {available} · ใช้วันละ {avgDaily} → พอ {cover} วัน · ของที่กำลังมา {incoming} รายการ', // i18n-key
  'stockout.gapBeforeDelivery': 'ของขาด {gapDays} วัน ({shortage} หน่วย) ก่อน {docNo} มาถึง', // i18n-key
  'stockout.incomingNotEnough': 'ของที่สั่งไว้ ({docNo}) มาก่อนแต่ไม่พอ — ขาด {gapDays} วัน ({shortage} หน่วย) ใน 14 วันข้างหน้า', // i18n-key
  'stockout.nothingOnOrder': 'ไม่มีของกำลังมา — ขาด {gapDays} วัน ({shortage} หน่วย) ใน 14 วันข้างหน้า', // i18n-key
  'stockout.lateDeliveryWouldGap': 'ถ้า {docNo} ส่งช้าตามปกติของผู้ขาย ({level} · {score}/100) จะขาด {gapDays} วัน', // i18n-key
  'stockout.noUse': 'ไม่มีการใช้ช่วงนี้ — ไม่คาดว่าจะหมด', // i18n-key
  'stockout.reserved': 'จองไว้แล้ว {qty} หน่วย (หักจากพร้อมใช้)', // i18n-key

  'transfer.destNeed': '{location} ขาด {need} หน่วย ({gapDays} วัน)', // i18n-key
  'transfer.sourceSpare': 'ต้นทางมี {onHand} · รอโอนออก {pendingOut} · ต้องเก็บไว้เอง {required} (ขั้นต่ำ {min} หรือใช้ {keepDays} วัน × {avgDaily}/วัน)', // i18n-key
  'transfer.effect': 'หลังโอน: ขาด {shortageBefore} → {shortageAfter} หน่วย · {gapBefore} → {gapAfter} วัน', // i18n-key

  'purchase.noUsage': 'ยังไม่มีประวัติการใช้พอ — ยังแนะนำจำนวนไม่ได้', // i18n-key
  'purchase.buy': 'ควรสั่ง {qty} (ต้องการจริง {need})', // i18n-key
  'purchase.enough': 'ของที่มีและกำลังมาพอแล้ว ({need})', // i18n-key
  'purchase.excludedIncoming': 'ไม่นับ {n} รายการที่กำลังมา ({qty} หน่วย) เพราะเสี่ยงช้า/ไม่มีวันส่ง/มาหลังช่วงที่คิด', // i18n-key

  'alternate.tradeoff': '{supplier} เทียบ {primary}: ราคา {priceDiff}/หน่วย · ขาดน้อยลง {gapDiff} วัน · ส่งเร็ว/ช้ากว่า {leadDiff} วัน · คะแนน {score} vs {primaryScore}', // i18n-key

  'anomaly.unusualConsumption': 'ใช้ {observed} ในวันเดียว — ปกติ {median} (สูงสุดที่ถือว่าปกติ {high}, z={z}, จาก {days} วัน)', // i18n-key
  'anomaly.largeAdjustment': 'ปรับ {qty} {unit} ({docNo}) — มากกว่าเกณฑ์ {high} (= {daysOfUse} วันของการใช้)', // i18n-key
  'anomaly.rejected': '{docNo}: ตีกลับ {rejected} จาก {received} + {rejected} ({pct}%)', // i18n-key
  'anomaly.overReceived': '{docNo}: รับ {received} จากที่สั่ง {ordered} (+{pct}%)', // i18n-key
  'anomaly.priceRise': 'ราคา {cost} สูงกว่าปกติ ({median}) {pct}%', // i18n-key
  'anomaly.priceDrop': 'ราคา {cost} ต่ำกว่าปกติ ({median}) {pct}%', // i18n-key
  'anomaly.countVariance': 'นับ {month} ต่าง {diff} จากระบบ {system} (มูลค่า {value})', // i18n-key
  'anomaly.countVarianceRepeats': 'นับ {month} ต่าง {diff} ซ้ำทิศเดิมกับเดือนก่อน ({prevDiff})', // i18n-key
  'anomaly.supplierDeterioration': 'ตรงเวลาลดจาก {previous}% เหลือ {recent}% ({n} ครั้งล่าสุด เทียบ {m} ครั้งก่อนหน้า)', // i18n-key
  'anomaly.duplicate': '{first} และ {second}: {qty} {unit} ซ้ำกันห่าง {minutes} นาที โดย {by}', // i18n-key
}

export const STEP_TEXT: Record<PurchaseStep['code'], string> = {
  forecast: 'ความต้องการ = ใช้วันละ {avgDaily} × (ระยะส่ง {lead} + สำรอง {cover} วัน)', // i18n-key
  safety: 'สำรองความปลอดภัย = มากกว่าของ ขั้นต่ำ {min} หรือ {safetyDays} วันของการใช้', // i18n-key
  available: 'หัก พร้อมใช้ (มี {onHand} − จอง {reserved})', // i18n-key
  reliableIncoming: 'หัก ของที่กำลังมาที่เชื่อถือได้ ({n} รายการ)', // i18n-key
  transfer: 'หัก ของที่จะโอนมาตามคำแนะนำ', // i18n-key
  need: '= ต้องการเพิ่ม', // i18n-key
  moq: 'ปัดขึ้นเป็นขั้นต่ำการสั่งของผู้ขาย {moq}', // i18n-key
  pack: 'ปัดขึ้นเป็น {count} {label} (ละ {size})', // i18n-key
  recommended: '= แนะนำให้สั่ง', // i18n-key
}

export const DATA_NOTE_TEXT: Record<DataNote, string> = {
  thinSupplierHistory: 'ประวัติผู้ขายยังน้อย', // i18n-key
  noSupplierHistory: 'ยังไม่มีประวัติการส่งของผู้ขาย', // i18n-key
  noUsageHistory: 'ยังไม่มีประวัติการใช้', // i18n-key
  shortUsageHistory: 'ประวัติการใช้ยังสั้น', // i18n-key
  unknownUnit: 'มีรายการที่หน่วยยังไม่มีอัตราแปลง', // i18n-key
  staleBalance: 'ยอดคงเหลือไม่ได้อัปเดตเกิน 1 วัน', // i18n-key
  missingIncomingDate: 'มีของกำลังมาที่ไม่รู้วันส่ง', // i18n-key
  noPrice: 'ไม่มีราคาซื้อ', // i18n-key
  noSafetyLevel: 'ยังไม่ได้ตั้งขั้นต่ำ', // i18n-key
  unknownLeadTime: 'ไม่รู้ระยะส่งของผู้ขาย (ใช้ค่าเริ่มต้น 2 วัน)', // i18n-key
}

type T = (s: string, v?: Record<string, string | number>) => string

/** One reason in words. Delivery-risk codes reuse the S3 sentences. */
export function explain(r: Reason, t: T): string {
  if (r.code.startsWith('risk.')) {
    const text = RISK_REASON_TEXT[r.code.slice(5) as RiskReasonCode]
    return text ? t(text, r.params) : r.code
  }
  const text = WHY_TEXT[r.code]
  return text ? t(text, r.params) : r.code
}

export function componentLabel(code: string): string | null {
  if (!code.startsWith('component.')) return null
  return SCORE_COMPONENT_LABEL[code.slice(10) as ScoreComponentKey] ?? null
}
