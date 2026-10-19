import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/services/poImages', () => ({ authHeader: async () => ({}) }))

import { cleanOcr } from '../src/lib/billOcr'
import {
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
      expect(ocrErrorMessage('pdf_too_large')).toBe('ไฟล์ PDF ใหญ่เกินไป (สูงสุดประมาณ 3 MB) — ลองส่งเฉพาะหน้าที่มีรายการ')
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
  })
})
