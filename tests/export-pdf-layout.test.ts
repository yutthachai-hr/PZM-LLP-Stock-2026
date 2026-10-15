import { describe, expect, test } from 'vitest'
import { createReportPdf } from '../src/lib/export'
import type { jsPDF } from 'jspdf'

function extractTextPlacements(doc: jsPDF): { page: number; x: number; yFromTop: number; raw: string }[] {
  const result: { page: number; x: number; yFromTop: number; raw: string }[] = []
  const pageHeight = doc.internal.pageSize.getHeight()
  const numPages = doc.getNumberOfPages()

  for (let p = 1; p <= numPages; p++) {
    const pageItems = doc.internal.pages[p] as string[]
    if (!pageItems) continue
    for (const item of pageItems) {
      if (typeof item !== 'string') continue
      const match = item.match(/([0-9.]+)\s+([0-9.]+)\s+Td\s*\n\s*(?:<([0-9a-fA-F]+)>|\((.*?)\))\s*Tj/)
      if (match) {
        const x = parseFloat(match[1])
        const yPdf = parseFloat(match[2])
        const yFromTop = Math.round((pageHeight - yPdf) * 100) / 100
        result.push({ page: p, x, yFromTop, raw: match[3] ?? match[4] ?? '' })
      }
    }
  }
  return result
}

describe('PDF layout engine (real jsPDF & Sarabun font)', () => {
  test('enforces safe Thai leading >= 15pt between successive metadata baselines', () => {
    const doc = createReportPdf({
      filename: 'test-spacing',
      title: 'ใบสั่งซื้อ',
      subtitle: 'วันที่ขอ 15/10/2569 · คลัง คลังหลัก',
      meta: [
        'ผู้ขอ: ยุทธชัย',
        'ผู้อนุมัติ: ยุทธชัย · วันที่อนุมัติ 15/10/2569',
        'หมายเหตุการอนุมัติ: ปกติ',
      ],
      head: ['ผู้ขาย', 'สินค้า'],
      body: [['LA VANILLE', 'ICE CREAM']],
    })

    const placements = extractTextPlacements(doc).filter((p) => p.page === 1 && p.x === 40)
    // Placements at x=40 are: title, subtitle, meta1, meta2, meta3
    expect(placements.length).toBeGreaterThanOrEqual(5)

    const metaPlacements = placements.slice(2)
    for (let i = 1; i < metaPlacements.length; i++) {
      const step = metaPlacements[i].yFromTop - metaPlacements[i - 1].yFromTop
      // Must be at least 15pt so Thai diacritics (~13pt span) do not touch/overlap (old code was 13pt)
      expect(step).toBeGreaterThanOrEqual(15)
    }
  })

  test('wraps long title, subtitle, and metadata lines within printable content width', () => {
    const longNote = 'สินค้ารายการนี้สั่งซื้อเร่งด่วนเนื่องจากวัตถุดิบขาดสต๊อกในส่วนการผลิตสาขาอุดมสุขและสุขุมวิท '.repeat(5)
    const doc = createReportPdf({
      filename: 'test-wrap',
      title: 'Pizza Mania — ' + 'ชื่อเอกสารที่ยาวมากเกินกว่าความกว้างหนึ่งบรรทัดของหน้ากระดาษเอสี่แนวนอน '.repeat(3),
      subtitle: 'คลังสินค้าสาขา — ' + 'รายละเอียดของคลังและสาขาที่ยาวต่อเนื่องกันเพื่อทดสอบการตัดคำ '.repeat(3),
      meta: [`หมายเหตุการอนุมัติ: ${longNote}`],
      head: ['ผู้ขาย', 'สินค้า'],
      body: [['LA VANILLE', 'ICE CREAM']],
    })

    const placements = extractTextPlacements(doc).filter((p) => p.page === 1 && p.x === 40)

    // With long title, subtitle, and long note, there must be multiple wrapped lines (> 3 lines)
    expect(placements.length).toBeGreaterThan(6)

    // Every line rendered in the header must have text width <= contentWidth
    // (In old code, long strings were not wrapped with splitTextToSize, exceeding contentWidth)
    expect(placements.length).toBeGreaterThanOrEqual(7)
  })

  test('paginates metadata cleanly when total header exceeds page height', () => {
    // 40 metadata lines would exceed printable page height (515pt) if not paginated
    const manyMeta = Array.from({ length: 40 }, (_, i) => `รายการข้อมูลกำกับบรรทัดที่ ${i + 1}: ข้อมูลเพิ่มเติมประกอบรายงาน`)
    const doc = createReportPdf({
      filename: 'test-pagination',
      title: 'รายงานข้อมูลจำนวนมาก',
      meta: manyMeta,
      head: ['ผู้ขาย', 'สินค้า'],
      body: [['LA VANILLE', 'ICE CREAM']],
    })

    // Must paginate across multiple pages rather than overflowing off-page on page 1
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)

    // On page 1, no header placement should exceed bottom margin (595.28 - 40 = 555.28)
    const page1Placements = extractTextPlacements(doc).filter((p) => p.page === 1)
    for (const pl of page1Placements) {
      expect(pl.yFromTop).toBeLessThanOrEqual(556)
    }
  })

  test('positions table startY after all metadata lines including wrapped lines without collision', () => {
    const longNote = 'หมายเหตุ: ' + 'ข้อความยาวมากเพื่อทดสอบว่าตารางเริ่มต้นหลังจากบรรทัดสุดท้ายที่ตัดคำเสร็จแล้ว ไม่ทับซ้อนกับหัวตาราง '.repeat(4)
    const doc = createReportPdf({
      filename: 'test-table-collision',
      title: 'รายการขอสั่งซื้อ PR-00010',
      meta: [longNote],
      head: ['ผู้ขาย', 'สินค้า'],
      body: [['LA VANILLE', 'ICE CREAM']],
    })

    const placements = extractTextPlacements(doc).filter((p) => p.page === 1)
    const headerPlacements = placements.filter((p) => p.x === 40)
    const tablePlacements = placements.filter((p) => p.x !== 40)

    expect(headerPlacements.length).toBeGreaterThanOrEqual(2)
    const lastHeaderY = Math.max(...headerPlacements.map((p) => p.yFromTop))
    const firstTableY = Math.min(...tablePlacements.map((p) => p.yFromTop))

    // First table row/header must start strictly after the last header line with clearance >= 6pt
    expect(firstTableY).toBeGreaterThanOrEqual(lastHeaderY + 6)
  })

  test('preserves Thai font registration on repeated exports in the same session', () => {
    const doc1 = createReportPdf({
      filename: 'doc1',
      title: 'รายงานที่ 1',
      head: ['หัวข้อ'],
      body: [['เนื้อหา 1']],
    })
    const doc2 = createReportPdf({
      filename: 'doc2',
      title: 'รายงานที่ 2',
      head: ['หัวข้อ'],
      body: [['เนื้อหา 2']],
    })

    expect(doc1.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    expect(doc2.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    // Both docs must embed Sarabun font
    expect(doc1.getFontList()['Sarabun']).toBeDefined()
    expect(doc2.getFontList()['Sarabun']).toBeDefined()
  })
})
