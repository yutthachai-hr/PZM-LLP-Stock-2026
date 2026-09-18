import type { NotificationCategory, NotificationKind, NotificationPriority } from '../../types'

/**
 * The words for each notification, as Thai translation keys with {slots} the document's
 * `params` fill. Stored notifications carry only the kind and the params, so the text
 * follows the reader's language and can be reworded without touching a document.
 */

export const NOTIFICATION_TITLE: Record<NotificationKind, string> = {
  taskSoon: 'ใกล้ถึงเวลางาน: {title}', // i18n-key
  taskOverdue: 'งานเลยกำหนด: {title}', // i18n-key
  taskEscalated: 'งานค้างนานเกินกำหนด: {title}', // i18n-key
  taskApproval: 'รอตรวจงาน: {title}', // i18n-key
  prSubmitted: 'รายการขอสั่งซื้อรออนุมัติ {docNo}', // i18n-key
  poArriving: 'ของเข้าวันนี้: {supplier}', // i18n-key
  poDelayed: 'ของยังไม่มา: {supplier} ({docNo})', // i18n-key
  cutoffToday: 'วันนี้ตัดรอบสั่ง {supplier} เวลา {time}', // i18n-key
  lowStock: 'ใกล้หมด: {product}', // i18n-key
  outOfStock: 'หมดแล้ว: {product}', // i18n-key
  stockoutSoon: 'คาดว่าจะหมดใน {days} วัน: {product}', // i18n-key
  reorder: 'แนะนำสั่งซื้อ: {product}', // i18n-key
  adjustment: 'ปรับสต๊อกจำนวนมาก: {product}', // i18n-key
  waste: 'ของเสีย/สูญหาย: {product}', // i18n-key
  dailyBrief: 'สรุปงานคลังประจำวัน', // i18n-key
  weeklySummary: 'สรุปคลังประจำสัปดาห์', // i18n-key
}

export const NOTIFICATION_BODY: Record<NotificationKind, string> = {
  taskSoon: '{time} · {location}', // i18n-key
  taskOverdue: 'เริ่ม {time} · {location} — ยังไม่เสร็จ', // i18n-key
  taskEscalated: 'เริ่ม {time} · {location} — เลยกำหนดแล้วยังไม่เสร็จ', // i18n-key
  taskApproval: '{by} ทำเสร็จแล้ว รอหัวหน้าอนุมัติ', // i18n-key
  prSubmitted: '{by} · {location} · {n} รายการ', // i18n-key
  poArriving: '{docNo} · {location} · {n} รายการ', // i18n-key
  poDelayed: 'เลยกำหนดส่ง {days} วัน · {location}', // i18n-key
  cutoffToday: 'สั่งให้ทันก่อน {time}', // i18n-key
  lowStock: '{location} เหลือ {qty} {unit} (ขั้นต่ำ {min})', // i18n-key
  outOfStock: '{location} เหลือ {qty} {unit}', // i18n-key
  stockoutSoon: '{location} — ตามอัตราการใช้ช่วงนี้', // i18n-key
  reorder: '{location} — แนะนำ {qty} {unit}', // i18n-key
  adjustment: '{location} {sign}{qty} {unit} โดย {by}', // i18n-key
  waste: '{location} -{qty} {unit} โดย {by}', // i18n-key
  dailyBrief: 'งานวันนี้ {tasks} · ค้าง {overdue} · ของเข้า {arriving} · ของช้า {late} · รออนุมัติ {pending} · ใกล้หมด {low} · หมด {out}', // i18n-key
  weeklySummary: 'งานเสร็จ {done} · ไม่เสร็จ {missed} · รับของ {deliveries} (ช้า {late}) · ปรับสต๊อก {adjustments} · ของเสีย ฿{waste}', // i18n-key
}

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  task: 'งาน', // i18n-key
  inventory: 'สต๊อก', // i18n-key
  purchasing: 'จัดซื้อ', // i18n-key
  supplier: 'ผู้ขาย', // i18n-key
  system: 'สรุป', // i18n-key
}

export const NOTIFICATION_PRIORITY_LABEL: Record<NotificationPriority, string> = {
  critical: 'วิกฤต', // i18n-key
  high: 'สำคัญ', // i18n-key
  medium: 'ปานกลาง', // i18n-key
  info: 'ข้อมูล', // i18n-key
}
