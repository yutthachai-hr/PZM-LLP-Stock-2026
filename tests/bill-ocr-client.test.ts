import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

let authHeaderPromise: Promise<Record<string, string>> = Promise.resolve({})
vi.mock('../src/services/poImages', () => ({ authHeader: () => authHeaderPromise }))

import { cleanOcr } from '../src/lib/billOcr'
import { pendingWriteCount } from '../src/backend/pendingWrites'
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_PDF_TIMEOUT_MS,
  ocrErrorMessage,
  readBillPhoto,
  readDocumentFile,
} from '../src/services/billOcr'
import { setPdfJsLoader, type PdfJsLib } from '../src/lib/pdfRaster'

describe('client OCR resilience and TDD requirements', () => {
  const originalFetch = globalThis.fetch
  const originalDoc = (globalThis as unknown as { document?: unknown }).document
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    setPdfJsLoader(null)
    ;(globalThis as unknown as { document?: unknown }).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              fillStyle: '',
              fillRect: () => {},
              drawImage: () => {},
            }),
            toDataURL: () => 'data:image/jpeg;base64,rendered-page-bytes',
          }
        }
        return {}
      },
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    ;(globalThis as unknown as { document?: unknown }).document = originalDoc
    setPdfJsLoader(null)
    vi.restoreAllMocks()
  })

  describe('50 and 100-row answers parse', () => {
    test('50-row answer parses all rows without dropping lines', () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        name: `Product ${i + 1}`,
        qty: i + 1,
        unit: 'KG',
      }))
      const bill = cleanOcr({ lines: items })
      expect(bill.lines).toHaveLength(50)
      expect(bill.lines[0]).toEqual({ name: 'Product 1', qty: 1, unit: 'KG' })
      expect(bill.lines[49]).toEqual({ name: 'Product 50', qty: 50, unit: 'KG' })
    })

    test('100-row answer parses all 100 rows properly', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        name: `Product ${i + 1}`,
        quantity: `${i + 0.5} Carton`,
      }))
      const bill = cleanOcr({ items })
      expect(bill.lines).toHaveLength(100)
      expect(bill.lines[0]).toEqual({ name: 'Product 1', qty: 0.5, unit: 'Carton' })
      expect(bill.lines[99]).toEqual({ name: 'Product 100', qty: 99.5, unit: 'Carton' })
    })
  })

  describe('error kind -> message mapping', () => {
    test('maps all distinct error kinds to specific messages (never raw Google text)', () => {
      expect(ocrErrorMessage('quota')).toBe('AI อ่านเอกสารครบโควตาวันนี้แล้ว — ลองใหม่พรุ่งนี้ หรือใช้ Excel / คีย์เอง')
      expect(ocrErrorMessage('model_unavailable')).toBe('AI ไม่พร้อมให้บริการชั่วคราว (โมเดลทำงานหนัก) — กรุณาลองใหม่อีกครั้งในอีกสักครู่')
      expect(ocrErrorMessage('upstream_timeout')).toBe('การเชื่อมต่อ AI หมดเวลา — ลองใหม่อีกครั้ง หรือคีย์เอง')
      expect(ocrErrorMessage('unreadable')).toBe('AI อ่านแล้วแต่ตอบกลับไม่เป็นรายการ — ลองรูปที่ชัดขึ้น หรือคีย์เอง')
      expect(ocrErrorMessage('too_large')).toBe('รูปใหญ่เกินไป')
      expect(ocrErrorMessage('pdf_too_large')).toBe('ไฟล์ PDF ใหญ่เกินไป (สูงสุดประมาณ {mb} MB) — ลองส่งเฉพาะหน้าที่มีรายการ')
      expect(ocrErrorMessage('pdf_unreadable')).toBe('ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหายหรือมีรูปแบบที่ไม่รองรับ')
      expect(ocrErrorMessage('pdf_fallback_limit', { maxPages: 5 })).toBe('การอ่านสำรองรองรับ PDF สูงสุด 5 หน้า — ลองส่งเฉพาะหน้าที่มีรายการ')
      expect(ocrErrorMessage('not_configured')).toBe('ยังไม่ได้เปิดใช้ AI อ่านบิล — ผู้ดูแลต้องตั้งค่า GEMINI_API_KEY ใน Cloudflare ก่อน')
      expect(ocrErrorMessage('unauthorized')).toBe('กรุณาเข้าสู่ระบบใหม่')
      expect(ocrErrorMessage('invalid_format')).toBe('รองรับเฉพาะรูปภาพหรือ PDF')
    })
  })

  describe('abort/cancel ignores late response', () => {
    test('aborted request throws AbortError and ignores late network response', async () => {
      const controller = new AbortController()

      let resolveFetch!: (res: Response) => void
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
      fetchMock.mockReturnValue(fetchPromise)

      const promise = readBillPhoto('data:image/jpeg;base64,1234', { signal: controller.signal })

      // User hits Cancel before fetch finishes
      controller.abort()

      await expect(promise).rejects.toThrow()

      // Late resolution arrives afterwards
      resolveFetch(
        new Response(
          JSON.stringify({
            supplier: 'LATE_SUPPLIER',
            lines: [{ name: 'LATE_ITEM', qty: 99 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      // Nothing crashed and late response was ignored
    })
  })

  describe('PDF -> image fallback path selection (mock pdf.js)', () => {
    test('when Gemini fails transiently for a PDF, client renders PDF pages to images and retries via image path', async () => {
      // Mock pdf.js to return 2 rendered canvas page dataUrls
      const mockGetPage = vi.fn().mockImplementation((_num: number) =>
        Promise.resolve({
          getViewport: () => ({ width: 100, height: 100 }),
          render: ({ canvasContext }: { canvasContext: CanvasRenderingContext2D }) => {
            canvasContext.fillStyle = '#123456'
            canvasContext.fillRect(0, 0, 100, 100)
            return { promise: Promise.resolve() }
          },
        }),
      )

      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 2,
            getPage: mockGetPage,
          }),
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      // Mock HTMLCanvasElement.toDataURL for jsdom environment if needed
      if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.toDataURL) {
        HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,rendered-page-bytes'
      }

      // Call 1 (PDF to server): Gemini fails with 503 model_unavailable
      // Call 2 (Page 1 image to server): Succeeds via Workers AI fallback (or Gemini recovery)
      // Call 3 (Page 2 image to server): Succeeds
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: 'model_unavailable',
              upstreamStatus: 503,
              model: 'gemini-2.5-flash',
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              supplier: 'PDF Fallback Co.',
              lines: [{ name: 'Page 1 Item', qty: 10, unit: 'KG' }],
              model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              lines: [{ name: 'Page 2 Item', qty: 20, unit: 'KG' }],
              model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )

      const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'invoice.pdf', {
        type: 'application/pdf',
      })

      const bill = await readDocumentFile(fakePdfFile)

      expect(bill.supplier).toBe('PDF Fallback Co.')
      expect(bill.lines).toHaveLength(2)
      expect(bill.lines[0]).toEqual({ name: 'Page 1 Item', qty: 10, unit: 'KG' })
      expect(bill.lines[1]).toEqual({ name: 'Page 2 Item', qty: 20, unit: 'KG' })

      // Verify that pdf.js was loaded and both pages were rendered
      expect(mockGetPage).toHaveBeenCalledTimes(2)
      // 1 initial PDF POST + 2 rendered page POSTs
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    test('large scanned PDF (4.3MB 2-page) bypasses direct Gemini upload and succeeds via local raster fallback', async () => {
      const mockGetPage = vi.fn().mockImplementation((_num: number) =>
        Promise.resolve({
          getViewport: () => ({ width: 1200, height: 1800 }),
          render: (_params: { canvasContext: { fillRect: () => void; drawImage?: () => void } }) => {
            return { promise: Promise.resolve() }
          },
        }),
      )
      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 2,
            getPage: mockGetPage,
          }),
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      // Both page calls succeed via image path
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              supplier: 'Large Scan Bakery Ltd.',
              invoiceNo: 'LS-001',
              date: '2026-10-20',
              lines: [{ name: 'Mozzarella 20kg', qty: 5, unit: 'Carton' }],
              model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              lines: [{ name: 'Pizza Flour 25kg', qty: 10, unit: 'Bag' }],
              model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )

      // Create synthetic 4.3 MB PDF file (4.3 * 1024 * 1024 = 4_508_876 bytes)
      const largeBytes = new Uint8Array(4_500_000)
      largeBytes[0] = 37 // %
      largeBytes[1] = 80 // P
      largeBytes[2] = 68 // D
      largeBytes[3] = 70 // F
      const largePdfFile = new File([largeBytes], 'synthetic-large-scan-4.3mb.pdf', {
        type: 'application/pdf',
      })

      const bill = await readDocumentFile(largePdfFile)

      expect(bill.supplier).toBe('Large Scan Bakery Ltd.')
      expect(bill.lines).toHaveLength(2)
      expect(bill.lines[0]).toEqual({ name: 'Mozzarella 20kg', qty: 5, unit: 'Carton' })
      expect(bill.lines[1]).toEqual({ name: 'Pizza Flour 25kg', qty: 10, unit: 'Bag' })

      // Verify ZERO direct raw PDF calls to Gemini (bypassed raw upload)
      // Only 2 rendered page image POSTs
      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const call of fetchMock.mock.calls) {
        const body = JSON.parse(call[1]?.body as string)
        expect(body.image).toMatch(/^data:image\/jpeg;base64,/)
        expect(body.image.length).toBeLessThanOrEqual(4_000_000)
      }
    })

    test('PDF exceeding local capacity (> 20MB) is rejected immediately with pdf_too_large', async () => {
      // 21 MB file
      const hugeBytes = new Uint8Array(21 * 1024 * 1024)
      hugeBytes[0] = 37; hugeBytes[1] = 80; hugeBytes[2] = 68; hugeBytes[3] = 70
      const hugePdfFile = new File([hugeBytes], 'huge.pdf', { type: 'application/pdf' })

      await expect(readDocumentFile(hugePdfFile)).rejects.toThrow(
        /ไฟล์ PDF ใหญ่เกินไป/,
      )
    })

    test('PDF exceeding 20 MB rejects with message stating real limit (20 MB) and not 3 MB', async () => {
      const hugeBytes = new Uint8Array(21 * 1024 * 1024)
      hugeBytes[0] = 37; hugeBytes[1] = 80; hugeBytes[2] = 68; hugeBytes[3] = 70
      const hugePdfFile = new File([hugeBytes], 'huge.pdf', { type: 'application/pdf' })

      const promise = readDocumentFile(hugePdfFile)
      await expect(promise).rejects.toThrow(/20 MB/)
      await expect(promise).rejects.toThrow(/ลองส่งเฉพาะหน้าที่มีรายการ/)
      await expect(promise).rejects.not.toThrow(/3 MB/)
    })

    test('cancellation while loadingTask.promise is pending immediately destroys task and aborts', async () => {
      const controller = new AbortController()
      let docPromiseReject!: (err: unknown) => void
      const docPromise = new Promise<never>((_, reject) => {
        docPromiseReject = reject
      })
      const mockDestroy = vi.fn().mockReturnValue(Promise.resolve())

      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: docPromise,
          destroy: mockDestroy,
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      // Initial call with PDF fails with 503 -> starts PDF loading
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'model_unavailable', upstreamStatus: 503 }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'invoice.pdf', {
        type: 'application/pdf',
      })

      const readPromise = readDocumentFile(fakePdfFile, { signal: controller.signal })

      // Wait a tick for fallback to enter getDocument
      await new Promise((r) => setTimeout(r, 10))

      // User cancels while loadingTask is pending
      controller.abort()

      await expect(readPromise).rejects.toThrow(/Abort|aborted/i)
      expect(mockDestroy).toHaveBeenCalled()

      docPromiseReject(new Error('cleaning up'))
    })

    test('hanging destroy does not block cancellation or operation indefinitely', async () => {
      const controller = new AbortController()
      const mockDestroy = vi.fn().mockReturnValue(new Promise(() => {})) // Never resolves!

      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({
              getViewport: () => ({ width: 100, height: 100 }),
              render: () => ({ promise: Promise.resolve() }),
            }),
            destroy: mockDestroy,
          }),
          destroy: mockDestroy,
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'model_unavailable', upstreamStatus: 503 }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'invoice.pdf', {
        type: 'application/pdf',
      })

      const readPromise = readDocumentFile(fakePdfFile, { signal: controller.signal })
      await new Promise((r) => setTimeout(r, 10))
      controller.abort()

      // Should reject promptly despite hanging destroy()
      const t0 = Date.now()
      await expect(readPromise).rejects.toThrow(/Abort|aborted/i)
      expect(Date.now() - t0).toBeLessThan(2000)
    })

    test('refuses PDF fallback if PDF exceeds stated page limit (> 5 pages)', async () => {
      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 6, // Exceeds 5 pages limit!
            getPage: vi.fn(),
          }),
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      // Initial call with PDF fails with 503
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'model_unavailable',
            upstreamStatus: 503,
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      )

      const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'many-pages.pdf', {
        type: 'application/pdf',
      })

      await expect(readDocumentFile(fakePdfFile)).rejects.toThrow(
        /การอ่านสำรองรองรับ PDF สูงสุด 5 หน้า/,
      )
    })

    test('multi-page PDF failure on subsequent page fails entire import with safe error rather than returning partial lines', async () => {
      const mockGetPage = vi.fn().mockImplementation((_num: number) =>
        Promise.resolve({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      )
      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 2,
            getPage: mockGetPage,
          }),
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      // Initial PDF call -> 503
      // Page 1 -> 200 with 1 line
      // Page 2 -> 500 error
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'model_unavailable', upstreamStatus: 503 }), { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ lines: [{ name: 'Page 1 line', qty: 1 }] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'model_unavailable', upstreamStatus: 500 }), { status: 500 }))

      const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'fail-page2.pdf', { type: 'application/pdf' })

      // Must fail entirely, NEVER return partial lines
      await expect(readDocumentFile(fakePdfFile)).rejects.toThrow()
    })
  })

  describe('comprehensive client cancellation, timeouts, and pendingWrites', () => {
    test('cancellation during authHeader preparation rejects immediately and prevents fetch', async () => {
      const controller = new AbortController()
      let resolveAuth!: (val: Record<string, string>) => void
      authHeaderPromise = new Promise((resolve) => {
        resolveAuth = resolve
      })

      const promise = readBillPhoto('data:image/jpeg;base64,1234', { signal: controller.signal })

      // Abort while authHeader is still resolving
      controller.abort()

      await expect(promise).rejects.toThrow(/Abort|aborted/i)
      expect(fetchMock).not.toHaveBeenCalled()

      resolveAuth({})
    })

    test('cancellation during body streaming rejects immediately', async () => {
      const controller = new AbortController()

      let bodyResolve!: (val: unknown) => void
      const bodyPromise = new Promise((resolve) => {
        bodyResolve = resolve
      })

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => bodyPromise,
      } as unknown as Response)

      const promise = readBillPhoto('data:image/jpeg;base64,1234', { signal: controller.signal })

      // Headers arrived, but body is still reading; user hits Cancel
      await new Promise((r) => setTimeout(r, 10))
      controller.abort()

      await expect(promise).rejects.toThrow(/Abort|aborted/i)
      bodyResolve({ lines: [{ name: 'Should be ignored', qty: 99 }] })
    })

    test('single overall deadline bounds multi-page PDF fallback across all pages', async () => {
      vi.useFakeTimers()
      try {
        const mockPdfJs: PdfJsLib = {
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 2,
              getPage: () => Promise.resolve({
                getViewport: () => ({ width: 100, height: 100 }),
                render: () => ({ promise: Promise.resolve() }),
              }),
            }),
          }),
        }
        setPdfJsLoader(async () => mockPdfJs)

        // Initial PDF fails with 503 after 20s
        // Page 1 takes 25s
        // Page 2 takes 25s (total 70s > 60s overall deadline)
        fetchMock
          .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'model_unavailable', upstreamStatus: 503 }), { status: 503 }))
          .mockImplementation(() => new Promise((resolve) => {
            setTimeout(() => {
              resolve(new Response(JSON.stringify({ lines: [{ name: 'Item', qty: 1 }] }), { status: 200 }))
            }, 25_000)
          }))

        const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'timed-out.pdf', { type: 'application/pdf' })

        const promise = readDocumentFile(fakePdfFile, { timeoutMs: 40_000 })
        const assertion = expect(promise).rejects.toThrow(/หมดเวลา|upstream_timeout/i)

        await vi.advanceTimersByTimeAsync(45_000)
        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    test('readDocumentFile tracks pendingWriteCount across the entire multi-page operation and leaves 0 on cancel', async () => {
      const controller = new AbortController()

      let resolveInitialFetch!: (res: Response) => void
      fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveInitialFetch = resolve }))

      const fakePdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'invoice.pdf', { type: 'application/pdf' })

      const promise = readDocumentFile(fakePdfFile, { signal: controller.signal })

      // Pending write count should be 1 during the operation
      expect(pendingWriteCount()).toBe(1)

      // User hits Cancel
      controller.abort()

      await expect(promise).rejects.toThrow()

      // Pending write count must return to 0 (no stuck count)
      expect(pendingWriteCount()).toBe(0)

      resolveInitialFetch(new Response('{}', { status: 500 }))
    })

    test('corrupted PDF throws typed pdf_unreadable error', async () => {
      const mockPdfJs: PdfJsLib = {
        getDocument: () => ({
          promise: Promise.reject(new Error('Invalid PDF structure')),
        }),
      }
      setPdfJsLoader(async () => mockPdfJs)

      // Initial call with PDF fails with 503 -> enters raster fallback
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'model_unavailable', upstreamStatus: 503 }), { status: 503 }),
      )

      const corruptedFile = new File([new Uint8Array([0, 1, 2, 3])], 'corrupted.pdf', { type: 'application/pdf' })

      await expect(readDocumentFile(corruptedFile)).rejects.toThrow(/ไม่สามารถอ่านไฟล์ PDF ได้ — ไฟล์อาจเสียหาย/)
    })

    test('reconciles default timeouts: 85s for HTTP photo and 150s for PDF', async () => {
      expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(85_000)
      expect(DEFAULT_PDF_TIMEOUT_MS).toBe(150_000)

      vi.useFakeTimers()
      try {
        fetchMock.mockImplementation(() => new Promise(() => {}))

        // 1. Photo call should not time out at 60s, but should time out at 85s
        const photoPromise = readBillPhoto('data:image/jpeg;base64,1234')
        let photoFailed = false
        photoPromise.catch(() => { photoFailed = true })

        await vi.advanceTimersByTimeAsync(60_000)
        expect(photoFailed).toBe(false)

        await vi.advanceTimersByTimeAsync(26_000)
        expect(photoFailed).toBe(true)
        await expect(photoPromise).rejects.toThrow(/หมดเวลา|upstream_timeout/i)

        // 2. PDF call should not time out at 85s, but should time out at 150s
        const pdfFile = new File([new Uint8Array([37, 80, 68, 70])], 'doc.pdf', { type: 'application/pdf' })
        const pdfPromise = readDocumentFile(pdfFile)
        let pdfFailed = false
        pdfPromise.catch(() => { pdfFailed = true })

        await vi.advanceTimersByTimeAsync(86_000)
        expect(pdfFailed).toBe(false)

        await vi.advanceTimersByTimeAsync(65_000)
        expect(pdfFailed).toBe(true)
        await expect(pdfPromise).rejects.toThrow(/หมดเวลา|upstream_timeout/i)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

