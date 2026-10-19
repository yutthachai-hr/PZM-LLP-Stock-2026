import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { AppError } from '../i18n/AppError'

export type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number }
  render: (params: { canvasContext: unknown; viewport: unknown }) => {
    promise: Promise<void>
    cancel?: () => void
  }
}

export type PdfDocument = {
  numPages: number
  getPage: (pageNum: number) => Promise<PdfPage>
  destroy?: () => Promise<void> | void
}

export type PdfLoadingTask = {
  promise: Promise<PdfDocument>
  destroy?: () => Promise<void> | void
}

export type PdfJsLib = {
  getDocument: (src: { data: Uint8Array }) => PdfLoadingTask
  GlobalWorkerOptions?: {
    workerSrc?: string
  }
}

let customLoader: (() => Promise<PdfJsLib>) | null = null

export function setPdfJsLoader(loader: (() => Promise<PdfJsLib>) | null) {
  customLoader = loader
}

export const MAX_FALLBACK_PAGES = 5
const MAX_DIMENSION = 2000
const MAX_TOTAL_PIXELS = 4_000_000

export async function getPdfJs(): Promise<PdfJsLib> {
  if (customLoader) return customLoader()
  try {
    const pdfjs = await import('pdfjs-dist')
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
    }
    return pdfjs as unknown as PdfJsLib
  } catch {
    throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
  }
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    try {
      onAbort?.()
    } catch {}
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  let listener: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    listener = () => {
      try {
        onAbort?.()
      } catch {}
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', listener, { once: true })
  })
  return Promise.race([promise, abortPromise]).finally(() => {
    if (listener) signal.removeEventListener('abort', listener)
  })
}

export async function renderPdfPagesToImages(
  file: Blob,
  options?: { maxPages?: number; signal?: AbortSignal },
): Promise<string[]> {
  const maxPages = options?.maxPages ?? MAX_FALLBACK_PAGES
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  let pdfjs: PdfJsLib
  try {
    pdfjs = await raceWithSignal(getPdfJs(), options?.signal)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (e instanceof AppError) throw e
    throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
  }

  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const arrayBuffer = await raceWithSignal(file.arrayBuffer(), options?.signal)
  let loadingTask: PdfLoadingTask | undefined
  let doc: PdfDocument | undefined
  try {
    try {
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) })
      doc = await raceWithSignal(loadingTask.promise, options?.signal, () => {
        try {
          loadingTask?.destroy?.()
        } catch {}
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
    }

    if (doc.numPages > maxPages) {
      throw new AppError('การอ่านสำรองรองรับ PDF สูงสุด {n} หน้า — ลองส่งเฉพาะหน้าที่มีรายการ', { n: maxPages })
    }

    const images: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const page = await raceWithSignal(doc.getPage(i), options?.signal)
      const unscaled = page.getViewport({ scale: 1.0 })
      if (!unscaled.width || !unscaled.height || unscaled.width <= 0 || unscaled.height <= 0) {
        throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
      }
      let scale = 1.5
      if (Math.max(unscaled.width, unscaled.height) * scale > MAX_DIMENSION) {
        scale = MAX_DIMENSION / Math.max(unscaled.width, unscaled.height)
      }
      if (unscaled.width * scale * unscaled.height * scale > MAX_TOTAL_PIXELS) {
        scale = Math.sqrt(MAX_TOTAL_PIXELS / (unscaled.width * unscaled.height))
      }
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
      }
      const viewport = page.getViewport({ scale })

      const canvas =
        typeof document !== 'undefined'
          ? document.createElement('canvas')
          : (globalThis as unknown as { document?: Document })?.document?.createElement('canvas')
      if (!canvas) throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')

      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        canvas.width = 0
        canvas.height = 0
        throw new AppError('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const renderTask = page.render({ canvasContext: ctx, viewport })

      let onAbort: (() => void) | undefined
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          try {
            renderTask.cancel?.()
          } catch {}
          reject(new DOMException('Aborted', 'AbortError'))
        }
        if (options?.signal?.aborted) onAbort()
        else options?.signal?.addEventListener('abort', onAbort, { once: true })
      })

      try {
        await Promise.race([renderTask.promise, abortPromise])
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        images.push(dataUrl)
      } finally {
        if (onAbort && options?.signal) {
          options.signal.removeEventListener('abort', onAbort)
        }
        // Release canvas memory immediately
        canvas.width = 0
        canvas.height = 0
      }
    }

    return images
  } finally {
    const boundedDestroy = async (destroyable?: { destroy?: () => Promise<void> | void }) => {
      if (!destroyable?.destroy) return
      try {
        await Promise.race([
          Promise.resolve(destroyable.destroy()),
          new Promise((resolve) => setTimeout(resolve, 500)),
        ])
      } catch {}
    }
    await boundedDestroy(doc)
    await boundedDestroy(loadingTask)
  }
}
