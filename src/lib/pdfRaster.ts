import { AppError } from '../i18n/AppError'

export type PdfDocument = {
  numPages: number
  getPage: (pageNum: number) => Promise<{
    getViewport: (params: { scale: number }) => { width: number; height: number }
    render: (params: { canvasContext: unknown; viewport: unknown }) => {
      promise: Promise<void>
    }
  }>
}

export type PdfJsLib = {
  getDocument: (src: { data: Uint8Array }) => {
    promise: Promise<PdfDocument>
  }
}

let customLoader: (() => Promise<PdfJsLib>) | null = null

export function setPdfJsLoader(loader: (() => Promise<PdfJsLib>) | null) {
  customLoader = loader
}

export const MAX_FALLBACK_PAGES = 5

export async function getPdfJs(): Promise<PdfJsLib> {
  if (customLoader) return customLoader()
  if (typeof window !== 'undefined' && (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib) {
    return (window as unknown as { pdfjsLib: PdfJsLib }).pdfjsLib
  }
  if (typeof document !== 'undefined') {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'
      script.type = 'module'
      script.onload = () => {
        const lib = (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib
        if (lib) resolve(lib)
        else reject(new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ'))
      }
      script.onerror = () => reject(new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ'))
      document.head.appendChild(script)
    })
  }
  throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
}

export async function renderPdfPagesToImages(
  file: Blob,
  options?: { maxPages?: number; signal?: AbortSignal },
): Promise<string[]> {
  const maxPages = options?.maxPages ?? MAX_FALLBACK_PAGES
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  let pdfjs: PdfJsLib
  try {
    pdfjs = await getPdfJs()
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
  }

  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const arrayBuffer = await file.arrayBuffer()
  let doc: PdfDocument
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  } catch {
    throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
  }

  if (doc.numPages > maxPages) {
    throw new AppError('การอ่านสำรองรองรับ PDF สูงสุด {n} หน้า — ลองส่งเฉพาะหน้าที่มีรายการ', { n: maxPages })
  }

  const images: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : (globalThis as unknown as { document?: Document })?.document?.createElement('canvas')
    if (!canvas) throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    images.push(canvas.toDataURL('image/jpeg', 0.85))
  }

  return images
}
