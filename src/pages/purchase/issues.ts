import type { BatchIssue, BatchRow, PurchaseBatchStatus } from '../../types'
import type { GroupState, RowState } from '../../services/purchaseBatch'

type T = (key: string, vars?: Record<string, string | number>) => string

/**
 * What an issue says to the person, and what to do about it.
 *
 * Every message names the fix, because "supplier missing" on its own sends someone to ask
 * what a supplier is missing from. Kept out of the service so the stored batch holds
 * codes, not sentences — a sentence changes; a code does not.
 */
export function issueText(issue: BatchIssue, t: T): string {
  const d = issue.detail ?? ''
  switch (issue.code) {
    case 'unknownProduct':
      return t('ไม่พบสินค้านี้ในระบบ — เลือกสินค้าที่ตรงกัน หรือข้ามรายการนี้')
    case 'ambiguousProduct':
      return t('ชื่อนี้ตรงกับสินค้าหลายรายการ (คนละผู้ขาย) — เลือกว่าหมายถึงรายการไหน')
    case 'noSupplier':
      return t('สินค้านี้ยังไม่ได้กำหนดผู้ขาย — เลือกผู้ขายก่อนสร้างใบสั่งซื้อ')
    case 'supplierInactive':
      return t('ผู้ขาย {name} ถูกซ่อนไว้ — เปิดใช้ผู้ขายนี้ในหน้าผู้ขาย หรือเลือกผู้ขายอื่น', { name: d })
    case 'productInactive':
      return t('สินค้านี้ถูกซ่อนไว้ — เปิดใช้ในหน้าสินค้าคงคลัง หรือข้ามรายการนี้')
    case 'qtyUnclear':
      return t('ช่องจำนวนเขียนว่า "{raw}" ไม่ใช่ตัวเลข — ใส่จำนวนที่จะสั่ง หรือข้าม', { raw: d })
    case 'unitMismatch':
      return t('หน่วย "{unit}" ในไฟล์ไม่ตรงกับหน่วยที่ใช้รับสินค้านี้ — เลือกหน่วยที่ถูกต้อง', { unit: d })
    case 'duplicateProduct':
      return t('สินค้านี้มีอยู่แล้วในแถว {row} ของไฟล์ — รวมจำนวน หรือข้ามแถวใดแถวหนึ่ง', { row: d })
    case 'belowMoq':
      return t('น้อยกว่าขั้นต่ำที่ผู้ขายรับ ({min}) — ยืนยันถ้าตกลงกันไว้แล้ว', { min: d })
    case 'suspiciousQty':
      return t('จำนวนสูงกว่าปกติ (ปกติสั่ง {range}) กรุณาตรวจสอบ แล้วยืนยัน', { range: d })
    case 'possibleDuplicateOrder':
      return t('วันนี้สั่งสินค้านี้จากผู้ขายรายนี้ไปแล้วใน {docNo} — ยืนยันถ้าต้องการสั่งซ้ำ', { docNo: d })
  }
}

export function rowStateText(state: RowState, t: T): string {
  switch (state) {
    case 'ready':
      return t('พร้อม')
    case 'review':
      return t('ต้องตรวจ')
    case 'blocked':
      return t('ติดปัญหา')
    case 'skipped':
      return t('ข้าม')
  }
}

export function groupStateText(state: GroupState, t: T): string {
  switch (state) {
    case 'ready':
      return t('พร้อม')
    case 'review':
      return t('ต้องตรวจ')
    case 'blocked':
      return t('ติดปัญหา')
    case 'ordered':
      return t('สั่งแล้ว')
  }
}

export function batchStatusText(status: PurchaseBatchStatus, t: T): string {
  switch (status) {
    case 'draft':
      return t('ร่าง')
    case 'needsReview':
      return t('ต้องตรวจ')
    case 'ready':
      return t('พร้อมอนุมัติ')
    case 'approved':
      return t('อนุมัติแล้ว')
    case 'sending':
      return t('กำลังส่ง')
    case 'completed':
      return t('ส่งครบแล้ว')
    case 'cancelled':
      return t('ยกเลิก')
  }
}

export function badgeColor(state: RowState | GroupState | PurchaseBatchStatus): 'slate' | 'red' | 'green' | 'amber' | 'blue' {
  switch (state) {
    case 'ready':
    case 'approved':
    case 'completed':
    case 'ordered':
      return 'green'
    case 'review':
    case 'needsReview':
    case 'sending':
      return 'amber'
    case 'blocked':
    case 'cancelled':
      return 'red'
    default:
      return 'slate'
  }
}

/** The human word for what happened, from the history's action code. */
export function historyText(action: string, t: T): string {
  const map: Record<string, string> = {
    imported: t('นำเข้าไฟล์'),
    productMapped: t('จับคู่สินค้า'),
    supplierChanged: t('เปลี่ยนผู้ขาย'),
    qtyChanged: t('แก้จำนวน'),
    unitChanged: t('แก้หน่วย'),
    rowSkipped: t('ข้ามรายการ'),
    rowRestored: t('นำรายการกลับมา'),
    warningsConfirmed: t('ยืนยันคำเตือน'),
    poGenerated: t('สร้างร่างใบสั่งซื้อ'),
    approved: t('อนุมัติ'),
    shareOpened: t('เปิดหน้าส่ง LINE'),
    sent: t('ส่งเข้า LINE แล้ว'),
    skipped: t('ข้ามการส่ง'),
    failed: t('ส่งไม่สำเร็จ'),
    sending: t('เริ่มส่ง'),
    completed: t('ส่งครบแล้ว'),
    cancelled: t('ยกเลิกชุด'),
  }
  return map[action] ?? action
}

/** Only the issues a person still needs to look at on this row. */
export function openIssues(row: BatchRow): BatchIssue[] {
  if (row.skipped) return []
  return row.issues.filter((i) => i.severity !== 'warn' || !row.confirmed)
}
