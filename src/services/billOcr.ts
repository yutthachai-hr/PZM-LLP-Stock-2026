import { AppError } from '../i18n/AppError'
import { trackWrite } from '../backend/pendingWrites'
import { cleanOcr, type OcrBill } from '../lib/billOcr'
import { authHeader } from './poImages'
import { MAX_FALLBACK_PAGES, renderPdfPagesToImages } from '../lib/pdfRaster'

/**
 * Ask the site's own /api/ocr-bill to read a bill picture (Automation Plan Phase 4). The
 * picture is the one already attached to the receipt; the answer is cleaned here and only
 * ever fills the form for a person to check.
 */

export type OcrErrorKind =
  | 'quota'
  | 'model_unavailable'
  | 'upstream_timeout'
  | 'unreadable'
  | 'too_large'
  | 'pdf_too_large'
  | 'pdf_unreadable'
  | 'pdf_fallback_limit'
  | 'not_configured'
  | 'unauthorized'
  | 'invalid_format'
  | 'bad_request'
  | 'unknown'

export function ocrErrorMessage(kind: OcrErrorKind, params?: { maxPages?: number }): string {
  switch (kind) {
    case 'quota':
      return 'AI อ่านเอกสารครบโควตาวันนี้แล้ว — ลองใหม่พรุ่งนี้ หรือใช้ Excel / คีย์เอง' // i18n-key
    case 'model_unavailable':
      return 'AI ไม่พร้อมให้บริการชั่วคราว (โมเดลทำงานหนัก) — กรุณาลองใหม่อีกครั้งในอีกสักครู่' // i18n-key
    case 'upstream_timeout':
      return 'การเชื่อมต่อ AI หมดเวลา — ลองใหม่อีกครั้ง หรือคีย์เอง' // i18n-key
    case 'unreadable':
      return 'AI อ่านแล้วแต่ตอบกลับไม่เป็นรายการ — ลองรูปที่ชัดขึ้น หรือคีย์เอง' // i18n-key
    case 'too_large':
      return 'รูปใหญ่เกินไป' // i18n-key
    case 'pdf_too_large':
      return 'ไฟล์ PDF ใหญ่เกินไป (สูงสุดประมาณ 3 MB) — ลองส่งเฉพาะหน้าที่มีรายการ' // i18n-key
    case 'pdf_unreadable':
      return 'ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ' // i18n-key
    case 'pdf_fallback_limit':
      return `การอ่านสำรองรองรับ PDF สูงสุด ${params?.maxPages ?? MAX_FALLBACK_PAGES} หน้า — ลองส่งเฉพาะหน้าที่มีรายการ`
    case 'not_configured':
      return 'ยังไม่ได้เปิดใช้ AI อ่านบิล — ผู้ดูแลต้องตั้งค่า GEMINI_API_KEY ใน Cloudflare ก่อน' // i18n-key
    case 'unauthorized':
      return 'กรุณาเข้าสู่ระบบใหม่' // i18n-key
    case 'invalid_format':
      return 'รองรับเฉพาะรูปภาพหรือ PDF' // i18n-key
    case 'bad_request':
      return 'คำขอไม่ถูกต้อง' // i18n-key
    default:
      return 'AI อ่านบิลไม่สำเร็จ'
  }
}

export function billReaderAvailable(): boolean {
  if (typeof location === 'undefined') return false
  // A developer's machine has no function to call.
  return !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
}

export interface ReadOcrOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export const DEFAULT_HTTP_TIMEOUT_MS = 85_000
export const DEFAULT_PDF_TIMEOUT_MS = 150_000

export class OcrAppError extends AppError {
  kind: OcrErrorKind
  upstreamStatus?: number
  model?: string

  constructor(kind: OcrErrorKind, message: string, opts?: { upstreamStatus?: number; model?: string; params?: Record<string, string | number> }) {
    super(message, opts?.params)
    this.name = 'OcrAppError'
    this.kind = kind
    this.upstreamStatus = opts?.upstreamStatus
    this.model = opts?.model
  }
}

function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options?: ReadOcrOptions,
  defaultTimeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  }, timeoutMs)

  let onCallerAbort: (() => void) | undefined
  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      controller.abort(options.signal.reason ?? new DOMException('Aborted', 'AbortError'))
    } else {
      onCallerAbort = () => {
        clearTimeout(timer)
        controller.abort(options.signal!.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      options.signal.addEventListener('abort', onCallerAbort, { once: true })
    }
  }

  const abortPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        if (options?.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
        } else {
          reject(new OcrAppError('upstream_timeout', ocrErrorMessage('upstream_timeout')))
        }
      },
      { once: true },
    )
  })

  return Promise.race([fn(controller.signal), abortPromise]).finally(() => {
    clearTimeout(timer)
    if (options?.signal && onCallerAbort) {
      options.signal.removeEventListener('abort', onCallerAbort)
    }
  })
}

export async function readBillPhoto(dataUrl: string, options?: ReadOcrOptions): Promise<OcrBill> {
  return trackWrite(withDeadline((signal) => readBillPhotoNow(dataUrl, signal), options, DEFAULT_HTTP_TIMEOUT_MS))
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  ])
}

async function readBillPhotoNow(dataUrl: string, signal: AbortSignal): Promise<OcrBill> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  const headers = await raceAbort(authHeader(), signal)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  const res = await raceAbort(
    fetch('/api/ocr-bill', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
      signal,
    }),
    signal,
  )

  if (res.ok) {
    const jsonBody = await raceAbort(res.json(), signal)
    return cleanOcr(jsonBody)
  }

  const body = (await raceAbort(res.json().catch(() => ({})), signal)) as {
    error?: string
    upstreamStatus?: number
    message?: string
    model?: string
  }

  const upstreamStatus = body.upstreamStatus ?? res.status

  if (res.status === 401 || res.status === 403 || body.error === 'unauthorized') {
    throw new OcrAppError('unauthorized', ocrErrorMessage('unauthorized'), { upstreamStatus, model: body.model })
  }
  if (res.status === 413 || body.error === 'too_large') {
    throw new OcrAppError('too_large', ocrErrorMessage('too_large'), { upstreamStatus, model: body.model })
  }
  if (res.status === 415 || body.error === 'invalid_format') {
    throw new OcrAppError('invalid_format', ocrErrorMessage('invalid_format'), { upstreamStatus, model: body.model })
  }
  if (res.status === 429 || body.error === 'quota') {
    throw new OcrAppError('quota', ocrErrorMessage('quota'), { upstreamStatus, model: body.model })
  }
  if (res.status === 400 || body.error === 'bad_request') {
    throw new OcrAppError('bad_request', ocrErrorMessage('bad_request'), { upstreamStatus, model: body.model })
  }
  if (res.status === 504 || body.error === 'upstream_timeout') {
    throw new OcrAppError('upstream_timeout', ocrErrorMessage('upstream_timeout'), { upstreamStatus, model: body.model })
  }
  if (body.error === 'not_configured') {
    throw new OcrAppError('not_configured', ocrErrorMessage('not_configured'), { upstreamStatus, model: body.model })
  }
  if (body.error === 'model_unavailable' || res.status === 503) {
    throw new OcrAppError('model_unavailable', ocrErrorMessage('model_unavailable'), { upstreamStatus, model: body.model })
  }
  if (body.error === 'unreadable') {
    throw new OcrAppError('unreadable', ocrErrorMessage('unreadable'), { upstreamStatus, model: body.model })
  }

  const why = [body.model, body.message].filter(Boolean).join(' — ').slice(0, 200)
  const err = new AppError('AI อ่านบิลไม่สำเร็จ ({status}) {why}', { status: upstreamStatus, why })
  Object.assign(err, { kind: 'unknown' as const, upstreamStatus, model: body.model })
  throw err
}

/** The direct Gemini endpoint takes about 4 MB of base64: a PDF up to this size goes directly. */
export const MAX_DIRECT_PDF_BYTES = 2_900_000
/** Bounded local file size limit for browser rasterization (20 MB). */
export const MAX_LOCAL_PDF_BYTES = 20_000_000

/**
 * Any document a person picks — a photo, a screenshot, a PDF — read by the same model
 * (6 Oct 2026). Pictures are shrunk to 2000 px on the long side first: enough for a dense
 * printed page, small enough to send from a phone on a weak signal.
 */
export async function readDocumentFile(file: File, options?: ReadOcrOptions): Promise<OcrBill> {
  const defaultTimeout = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    ? DEFAULT_PDF_TIMEOUT_MS
    : DEFAULT_HTTP_TIMEOUT_MS
  return trackWrite(withDeadline((signal) => readDocumentFileNow(file, signal), options, defaultTimeout))
}

async function readDocumentFileNow(file: File, signal: AbortSignal): Promise<OcrBill> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_LOCAL_PDF_BYTES) {
      throw new OcrAppError('pdf_too_large', ocrErrorMessage('pdf_too_large'))
    }

    const renderAndReadPages = async (): Promise<OcrBill> => {
      let pageImages: string[]
      try {
        pageImages = await renderPdfPagesToImages(file, {
          maxPages: MAX_FALLBACK_PAGES,
          signal,
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        if (e instanceof AppError) throw e
        throw new OcrAppError('pdf_unreadable', ocrErrorMessage('pdf_unreadable'))
      }

      const combined: OcrBill = { lines: [] }
      for (const pageImage of pageImages) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        // Each page must succeed. If any page fails, do NOT silently return incomplete lines!
        const pageBill = await readBillPhotoNow(pageImage, signal)
        if (!combined.supplier && pageBill.supplier) combined.supplier = pageBill.supplier
        if (!combined.invoiceNo && pageBill.invoiceNo) combined.invoiceNo = pageBill.invoiceNo
        if (!combined.date && pageBill.date) combined.date = pageBill.date
        if (pageBill.model) combined.model = pageBill.model
        combined.lines.push(...pageBill.lines)
      }
      return combined
    }

    // Large PDF (> 2.9 MB): bypass raw Gemini upload, render locally first
    if (file.size > MAX_DIRECT_PDF_BYTES) {
      return renderAndReadPages()
    }

    const pdfDataUrl = await raceAbort(asDataUrl(file, 'application/pdf'), signal)
    try {
      return await readBillPhotoNow(pdfDataUrl, signal)
    } catch (err) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

      // If Gemini fails transiently (503 model_unavailable, 504 upstream_timeout, 500),
      // render PDF pages to images and fallback to Workers AI via image path.
      const isTransient =
        err instanceof OcrAppError &&
        (err.kind === 'model_unavailable' ||
          err.kind === 'upstream_timeout' ||
          err.upstreamStatus === 503 ||
          err.upstreamStatus === 504 ||
          err.upstreamStatus === 500)

      if (!isTransient) throw err

      return renderAndReadPages()
    }
  }

  if (!file.type.startsWith('image/')) {
    throw new OcrAppError('invalid_format', ocrErrorMessage('invalid_format'))
  }
  const shrunk = await raceAbort(shrinkImage(file, 2000), signal)
  return readBillPhotoNow(shrunk, signal)
}

async function asDataUrl(file: Blob, type: string): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;/, `data:${type};`))
      r.onerror = () => reject(new AppError('อ่านไฟล์ไม่ได้'))
      r.readAsDataURL(file)
    })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${type};base64,${btoa(binary)}`
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
