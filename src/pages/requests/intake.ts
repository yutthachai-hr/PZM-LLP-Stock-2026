import type { RequestIntake } from '../../types'

/** D4′: how each intake channel is named on screen. */
export const INTAKE_LABEL: Record<RequestIntake, string> = {
  manual: 'กรอกเอง', // i18n-key
  excel: 'Excel', // i18n-key
  ocr: 'รูป / PDF (AI อ่าน)', // i18n-key
  suggestion: 'จากคำแนะนำของระบบ', // i18n-key
}
