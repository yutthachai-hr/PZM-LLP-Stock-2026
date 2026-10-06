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
  if (res.status === 429) throw new AppError('AI อ่านเอกสารครบโควตาวันนี้แล้ว — ลองใหม่พรุ่งนี้ หรือใช้ Excel / คีย์เอง')
  if (res.status === 415) throw new AppError('รองรับเฉพาะรูปภาพหรือ PDF')
  if (!res.ok) throw new AppError('AI อ่านบิลไม่สำเร็จ ({status}) — ลองถ่ายใหม่ให้ชัดขึ้น หรือคีย์เอง', { status: res.status })
  return cleanOcr(await res.json())
}

/** The endpoint takes about 4 MB of base64: a PDF up to this size goes as it is. */
const MAX_PDF_BYTES = 2_900_000

/**
 * Any document a person picks — a photo, a screenshot, a PDF — read by the same model
 * (6 Oct 2026). Pictures are shrunk to 2000 px on the long side first: enough for a dense
 * printed page, small enough to send from a phone on a weak signal.
 */
export async function readDocumentFile(file: File): Promise<OcrBill> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new AppError('ไฟล์ PDF ใหญ่เกินไป (สูงสุดประมาณ 3 MB) — ลองส่งเฉพาะหน้าที่มีรายการ')
    return readBillPhoto(await asDataUrl(file, 'application/pdf'))
  }
  if (!file.type.startsWith('image/')) throw new AppError('รองรับเฉพาะรูปภาพหรือ PDF')
  return readBillPhoto(await shrinkImage(file, 2000))
}

function asDataUrl(file: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;/, `data:${type};`))
    r.onerror = () => reject(new AppError('อ่านไฟล์ไม่ได้'))
    r.readAsDataURL(file)
  })
}

async function shrinkImage(file: File, maxSide: number): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new AppError('อ่านรูปไม่ได้'))
      i.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AppError('อ่านรูปไม่ได้')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
