// The header row of every PDF report. Reported from the order sheet: "หัวตารางผิดตอนออก
// ไฟล์ pdf" — the column titles came out as "'1 5H*1 @% 5I 9I 2" while every body row read
// fine. jspdf-autotable bolds the head by default, Sarabun is only registered as 'normal',
// and a bold request falls back to a font with no Thai glyphs.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

const autoTable = vi.fn()
vi.mock('jspdf-autotable', () => ({ default: autoTable }))
vi.mock('jspdf', () => ({
  jsPDF: class {
    addFileToVFS = vi.fn()
    addFont = vi.fn()
    setFont = vi.fn()
    setFontSize = vi.fn()
    text = vi.fn()
    save = vi.fn()
  },
}))

const { exportReportPdf } = await import('../src/lib/export')

beforeEach(() => autoTable.mockClear())

describe('the header row of a PDF report', () => {
  test('asks for the normal weight, the only one the Thai font is registered under', () => {
    exportReportPdf({
      filename: 'ใบสั่งซื้อ',
      title: 'รายการสั่งซื้อ',
      head: ['วันที่', 'เลขที่', 'ผู้ขาย'],
      body: [['14/09/2569', 'PO-00001', 'LA VANILLE']],
    })
    expect(autoTable).toHaveBeenCalledTimes(1)
    const opts = autoTable.mock.calls[0][1] as {
      headStyles: { font: string; fontStyle?: string }
      footStyles: { font: string; fontStyle?: string }
      styles: { font: string }
    }
    expect(opts.headStyles.fontStyle).toBe('normal')
    expect(opts.footStyles.fontStyle).toBe('normal')
    // And all three point at the same embedded face, so the head cannot drift from the body.
    expect(opts.headStyles.font).toBe(opts.styles.font)
    expect(opts.footStyles.font).toBe(opts.styles.font)
  })
})
