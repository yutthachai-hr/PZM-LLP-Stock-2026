import type { MovementEditField, MovementType } from '../../types'

// Labels are translation keys, rendered through t() where used. i18n-key
export const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า', // i18n-key
  issue: 'เบิก/โอน', // i18n-key
  adjust: 'ปรับ', // i18n-key
  consume: 'เบิกใช้', // i18n-key
}
export const TYPE_COLOR: Record<MovementType, 'green' | 'blue' | 'amber' | 'red'> = {
  receive: 'green',
  issue: 'blue',
  adjust: 'amber',
  consume: 'red',
}

/** The field an edit changed, as the history names it. */
export const EDIT_FIELD_LABEL: Record<MovementEditField, string> = {
  qty: 'จำนวน', // i18n-key
  date: 'วันที่', // i18n-key
  note: 'หมายเหตุ', // i18n-key
  unit: 'หน่วย', // i18n-key
  from: 'คลังต้นทาง', // i18n-key
  to: 'คลังปลายทาง', // i18n-key
}

/** One edit's change as text: "qty: 5 → 6", labelled. Dates and sites are looked up. */
export function describeEditChange(
  c: { field: MovementEditField; from: string; to: string },
  t: (k: string) => string,
  formatDate: (ms: number) => string,
  locationName: (id: string) => string,
): string {
  const show = (v: string) => {
    if (!v) return '—'
    if (c.field === 'date' && /^[0-9]+$/.test(v)) return formatDate(Number(v))
    if (c.field === 'from' || c.field === 'to') return locationName(v) || v
    return v
  }
  return `${t(EDIT_FIELD_LABEL[c.field])}: ${show(c.from)} → ${show(c.to)}`
}
