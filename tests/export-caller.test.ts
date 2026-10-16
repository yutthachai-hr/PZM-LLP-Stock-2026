import { beforeEach, describe, expect, test, vi } from 'vitest'

// Stub browser globals needed for transitive module imports in Node via vi.hoisted
vi.hoisted(() => {
  const mockStorage: Record<string, string> = {}
  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener() {},
    removeEventListener() {},
    location: { reload() {} },
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mockStorage[k] ?? null,
    setItem: (k: string, v: string) => {
      mockStorage[k] = v
    },
    removeItem: (k: string) => {
      delete mockStorage[k]
    },
    clear: () => {},
  }
  ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = class {
    onmessage: ((e: unknown) => void) | null = null
    postMessage() {}
    close() {}
  }
})

import { exportOrdersExcel, exportOrdersPdf } from '../src/pages/Orders'
import { exportReportsExcel } from '../src/pages/Reports'

// Mock dynamic import target '../src/lib/export'
const mockExportExcel = vi.fn()
const mockExportReportPdf = vi.fn()

vi.mock('../src/lib/export', () => ({
  exportExcel: (...args: unknown[]) => mockExportExcel(...args),
  exportReportPdf: (...args: unknown[]) => mockExportReportPdf(...args),
}))

describe('Export Callers (Async await, busy state, success & error toast)', () => {
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  let setBusy: ReturnType<typeof vi.fn>
  let t: (key: string, params?: Record<string, string | number>) => string

  beforeEach(() => {
    vi.clearAllMocks()
    toast = {
      success: vi.fn(),
      error: vi.fn(),
    }
    setBusy = vi.fn()
    t = (key: string, params?: Record<string, string | number>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          key,
        )
      }
      return key
    }
  })

  describe('Representative Caller 1: Orders.tsx (exportOrdersExcel)', () => {
    test('keeps busy state until export resolves, then shows success toast only after completion', async () => {
      let resolveExport!: () => void
      const deferred = new Promise<void>((resolve) => {
        resolveExport = resolve
      })
      mockExportExcel.mockImplementation(() => deferred)

      const exportPromise = exportOrdersExcel(
        () => [{ SKU: 'P1', Name: 'Item 1' }],
        t,
        toast,
        setBusy,
      )

      // Busy state set immediately
      expect(setBusy).toHaveBeenCalledWith('excel')

      // Yield microtasks so dynamic import resolves and reaches exportExcel
      await new Promise((r) => setTimeout(r, 10))

      // While export is in flight, success toast must NOT be shown yet
      expect(toast.success).not.toHaveBeenCalled()
      // Busy must NOT be cleared yet
      expect(setBusy).not.toHaveBeenCalledWith('')

      // Resolve export
      resolveExport()
      await exportPromise

      // After resolution: success toast shown and busy cleared
      expect(toast.success).toHaveBeenCalledWith('ดาวน์โหลดไฟล์ Excel แล้ว')
      expect(setBusy).toHaveBeenLastCalledWith('')
    })

    test('catches rejection, shows error toast, and clears busy state on failure', async () => {
      mockExportExcel.mockRejectedValue(new Error('Failed to fetch dynamically imported module: xlsx'))

      await exportOrdersExcel(
        () => [{ SKU: 'P1', Name: 'Item 1' }],
        t,
        toast,
        setBusy,
      )

      // Error toast shown with error details
      expect(toast.error).toHaveBeenCalled()
      expect(toast.error.mock.calls[0][0]).toContain('Failed to fetch dynamically imported module: xlsx')
      // Success toast must NOT be shown
      expect(toast.success).not.toHaveBeenCalled()
      // Busy state cleared in finally block
      expect(setBusy).toHaveBeenLastCalledWith('')
    })
  })

  describe('Representative Caller 2: Orders.tsx (exportOrdersPdf)', () => {
    test('keeps busy state until PDF export resolves, then shows success toast only after completion', async () => {
      let resolveExport!: () => void
      const deferred = new Promise<void>((resolve) => {
        resolveExport = resolve
      })
      mockExportReportPdf.mockImplementation(() => deferred)

      const exportPromise = exportOrdersPdf(
        {
          rows: [{ SKU: 'P1', Name: 'Item 1' }],
          title: 'Order Report',
          meta: ['Meta 1'],
          filename: 'orders.pdf',
        },
        t,
        toast,
        setBusy,
      )

      expect(setBusy).toHaveBeenCalledWith('pdf')
      await new Promise((r) => setTimeout(r, 10))

      expect(toast.success).not.toHaveBeenCalled()
      expect(setBusy).not.toHaveBeenCalledWith('')

      resolveExport()
      await exportPromise

      expect(toast.success).toHaveBeenCalledWith('ดาวน์โหลดไฟล์ PDF แล้ว')
      expect(setBusy).toHaveBeenLastCalledWith('')
    })

    test('catches rejection, shows error toast, and clears busy state on failure', async () => {
      mockExportReportPdf.mockRejectedValue(new Error('Failed to fetch dynamically imported module: jspdf'))

      await exportOrdersPdf(
        {
          rows: [{ SKU: 'P1', Name: 'Item 1' }],
          title: 'Order Report',
          meta: ['Meta 1'],
          filename: 'orders.pdf',
        },
        t,
        toast,
        setBusy,
      )

      expect(toast.error).toHaveBeenCalled()
      expect(toast.error.mock.calls[0][0]).toContain('Failed to fetch dynamically imported module: jspdf')
      expect(toast.success).not.toHaveBeenCalled()
      expect(setBusy).toHaveBeenLastCalledWith('')
    })
  })

  describe('Representative Caller 3: Reports.tsx (exportReportsExcel)', () => {
    test('keeps busy state until export resolves, then shows success toast only after completion', async () => {
      let resolveExport!: () => void
      const deferred = new Promise<void>((resolve) => {
        resolveExport = resolve
      })
      mockExportExcel.mockImplementation(() => deferred)

      const exportPromise = exportReportsExcel(
        'รายงานสต๊อก',
        'Stock',
        [{ [t('สินค้า')]: 'Mozzarella' }],
        t,
        toast,
        setBusy,
      )

      expect(setBusy).toHaveBeenCalledWith('excel')

      // Yield microtasks so dynamic import resolves and reaches exportExcel
      await new Promise((r) => setTimeout(r, 10))

      expect(toast.success).not.toHaveBeenCalled()
      expect(setBusy).not.toHaveBeenCalledWith('')

      resolveExport()
      await exportPromise

      expect(toast.success).toHaveBeenCalledWith('ดาวน์โหลดไฟล์ Excel แล้ว')
      expect(setBusy).toHaveBeenLastCalledWith('')
    })

    test('catches rejection, shows error toast with prefix, and clears busy state on failure', async () => {
      mockExportExcel.mockRejectedValue(new Error('Network error downloading xlsx chunk'))

      await exportReportsExcel(
        'รายงานสต๊อก',
        'Stock',
        [{ [t('สินค้า')]: 'Mozzarella' }],
        t,
        toast,
        setBusy,
      )

      expect(toast.error).toHaveBeenCalled()
      expect(toast.error.mock.calls[0][0]).toContain('สร้างไฟล์ไม่สำเร็จ:')
      expect(toast.error.mock.calls[0][0]).toContain('Network error downloading xlsx chunk')
      expect(toast.success).not.toHaveBeenCalled()
      expect(setBusy).toHaveBeenLastCalledWith('')
    })
  })
})
