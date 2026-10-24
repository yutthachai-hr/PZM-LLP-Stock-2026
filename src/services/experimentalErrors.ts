import { AppError } from '../i18n/AppError'

// Kept free of the browser backend so pure tests and the Pages bundle can name it.
const WORDS: Record<string, string> = {
  invalid: 'ข้อมูลสินค้าทดลองไม่ถูกต้อง — ตรวจชื่อ หน่วย (ไม่เกิน 20 ตัวอักษร) และจำนวนอีกครั้ง',
  ineligible: 'ใบรับนี้ใช้สินค้าทดลองไม่ได้ — ต้องเป็นแบรนด์ R&D ผู้ขาย OTHER และหมวด OTHER ที่ยังใช้งาน',
  forbidden: 'เฉพาะแอดมินเท่านั้นที่รับสินค้าทดลองเข้าคลังได้',
  stale: 'สินค้าทดลองที่เลือกถูกแก้หรือปิดใช้งานไปแล้ว — ลบออกแล้วเลือกใหม่',
  existing: 'มีสินค้าทดลองชื่อและสเปกนี้อยู่แล้ว — เปิดฟอร์มอีกครั้งแล้วเลือก "ใช้รายการนี้"',
  collision: 'รหัสสินค้าทดลองชนกัน — กดยืนยันอีกครั้ง',
  operation_conflict: 'ใบรับนี้อาจบันทึกไปแล้วด้วยข้อมูลชุดก่อน — ตรวจที่ประวัติรับเข้าก่อน ห้ามคีย์ซ้ำ',
  not_configured: 'ระบบรับสินค้าทดลองยังไม่เปิดใช้งาน — ติดต่อแอดมิน',
  unauthorized: 'กรุณาเข้าสู่ระบบใหม่',
  too_large: 'ใบรับนี้ใหญ่เกินไป — ลดรูปหรือจำนวนรายการ',
  unknown_outcome: 'บันทึกไม่ชัดเจน — ร่างถูกเก็บไว้ ตรวจยอดแล้วกดยืนยันอีกครั้ง (ระบบจะไม่บันทึกซ้ำ)',
}
const FALLBACK = 'บันทึกสินค้าทดลองไม่สำเร็จ ({code})'

/** Known refusal permits editing; an unknown outcome keeps the frozen operation for retry. */
export class ExperimentalClientError extends AppError {
  readonly code: string
  readonly unknownOutcome: boolean
  constructor(code: string, unknownOutcome: boolean) {
    super(WORDS[code] ?? FALLBACK, WORDS[code] ? undefined : { code })
    this.code = code
    this.unknownOutcome = unknownOutcome
  }
}
