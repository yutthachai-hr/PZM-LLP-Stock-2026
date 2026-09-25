import { AppError } from '../i18n/AppError'
import { cleanOcr, type OcrBill } from '../lib/billOcr'
import { authHeader } from './poImages'

/**
 * Ask the site's own /api/ocr-bill to read a bill picture (Automation Plan Phase 4). The
 * picture is the one already attached to the receipt; the answer is cleaned here and only
 * ever fills the form for a person to check.
 */

export function billReaderAvailable(): boolean {
  if (typeof location === 'undefined') return false
  // A developer's machine has no function to call.
  return !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
}

export async function readBillPhoto(dataUrl: string): Promise<OcrBill> {
  const res = await fetch('/api/ocr-bill', {
    method: 'POST',
    headers: { ...(await authHeader()), 'content-type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  })
  if (res.status === 503) throw new AppError('ยังไม่ได้เปิดใช้ AI อ่านบิล — ผู้ดูแลต้องตั้งค่า GEMINI_API_KEY ใน Cloudflare ก่อน')
  if (res.status === 401 || res.status === 403) throw new AppError('กรุณาเข้าสู่ระบบใหม่')
  if (res.status === 413) throw new AppError('รูปใหญ่เกินไป')
  if (!res.ok) throw new AppError('AI อ่านบิลไม่สำเร็จ ({status}) — ลองถ่ายใหม่ให้ชัดขึ้น หรือคีย์เอง', { status: res.status })
  return cleanOcr(await res.json())
}
