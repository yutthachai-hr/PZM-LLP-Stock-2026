// Company announcements: numbered when published, per company and per year, and kept.
//
//   npm test
//
// What the owner asked for, tested in the order it was asked: the number is issued at
// publish and never for a draft; Pizza Mania and Le Lapin count separately; the prefix is
// the company's own choice; two people publishing at once get two numbers; a published
// announcement cannot be edited; the send log says only what the provider said.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Announcement, CompanyProfile } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const A = await import('../src/services/announcements')
const { saveCompanyProfile, getCompanyProfile } = await import('../src/services/companyProfile')
const { buddhistYear, cleanPrefix } = await import('../src/services/sequence')
const { announcementText, a5Caption, LINE_TEXT_MAX, normalizeBody } = await import('../src/lib/announcementText')
const { canMoveAnnouncement, canWriteAnnouncements, isCancellable } = await import('../src/lib/announcementStatus')

const MANAGER = { id: 'u-mgr', name: 'หัวหน้า A', role: 'manager' as const }
const ADMIN = { id: 'u-admin', name: 'Admin', role: 'admin' as const }
const STAFF = { id: 'u-staff', name: 'AA', role: 'staff' as const }

// 24 Sep 2026 in Bangkok → Buddhist year 2569.
const SEP_24 = Date.UTC(2026, 8, 24, 3, 0, 0)
// 31 Dec 2026 23:30 Bangkok is still 2569; 1 Jan 2027 00:30 Bangkok is 2570.
const DEC_31_LATE = Date.UTC(2026, 11, 31, 16, 30, 0)
const JAN_1_EARLY = Date.UTC(2026, 11, 31, 17, 30, 0)

const content = (over: Partial<Parameters<typeof A.createAnnouncement>[1]> = {}) => ({
  announcementDate: SEP_24,
  subject: 'ปรับเวลารับสินค้า',
  body: 'ตั้งแต่ 1 ต.ค. รับสินค้าเวลา 8:00–11:00 น.',
  format: 'text' as const,
  target: { mode: 'personal' as const, companyScope: ['pizza' as const] },
  ...over,
})

async function published(company: 'pizza' | 'lelapin' = 'pizza', over = {}): Promise<Announcement> {
  const a = await A.createAnnouncement(company, content(over), MANAGER)
  await A.markReady(company, a.id, { a5Fits: true }, MANAGER)
  return A.publishAnnouncement(company, a.id, MANAGER)
}

beforeEach(() => resetMemory())

describe('the number', () => {
  test('is issued when published, not when the draft is opened', async () => {
    const a = await A.createAnnouncement('pizza', content(), MANAGER)
    expect(a.docNo).toBeUndefined()
    expect(raw('counters')).toEqual([])
    await A.markReady('pizza', a.id, { a5Fits: true }, MANAGER)
    expect(raw('counters')).toEqual([])
    const p = await A.publishAnnouncement('pizza', a.id, MANAGER)
    expect(p.docNo).toBe('PZM-ANN-2569-0001')
    expect(p.status).toBe('published')
  })

  test('a thrown-away draft leaves no gap', async () => {
    const draft = await A.createAnnouncement('pizza', content(), MANAGER)
    await A.cancelAnnouncement('pizza', draft.id, 'เขียนผิด', MANAGER)
    expect((await published()).docNo).toBe('PZM-ANN-2569-0001')
    expect((await published()).docNo).toBe('PZM-ANN-2569-0002')
  })

  test('Pizza Mania and Le Lapin count separately, each with its own prefix', async () => {
    expect((await published('pizza')).docNo).toBe('PZM-ANN-2569-0001')
    expect((await published('lelapin')).docNo).toBe('LLP-ANN-2569-0001')
    expect((await published('pizza')).docNo).toBe('PZM-ANN-2569-0002')
    expect((await published('lelapin')).docNo).toBe('LLP-ANN-2569-0002')
    // Each company's documents are in its own collection.
    expect(raw('announcements')).toHaveLength(2)
    expect(raw('lelapin__announcements')).toHaveLength(2)
  })

  test('each year starts again at 0001, by the Bangkok calendar', async () => {
    expect(buddhistYear(DEC_31_LATE)).toBe(2569)
    expect(buddhistYear(JAN_1_EARLY)).toBe(2570)
    expect((await published('pizza', { announcementDate: DEC_31_LATE })).docNo).toBe('PZM-ANN-2569-0001')
    expect((await published('pizza', { announcementDate: JAN_1_EARLY })).docNo).toBe('PZM-ANN-2570-0001')
    expect((await published('pizza', { announcementDate: DEC_31_LATE })).docNo).toBe('PZM-ANN-2569-0002')
  })

  test('the prefix and the document code are the company’s to choose', async () => {
    await saveCompanyProfile('pizza', { docPrefix: 'pm ', announcementCode: 'ann' }, ADMIN)
    expect((await getCompanyProfile('pizza')).docPrefix).toBe('PM')
    expect((await published('pizza')).docNo).toBe('PM-ANN-2569-0001')
    expect(cleanPrefix('p-z/m', 'X')).toBe('PZM')
    expect(cleanPrefix('', 'LLP')).toBe('LLP')
  })

  test('two people publishing at the same moment get two different numbers', async () => {
    const a = await A.createAnnouncement('pizza', content(), MANAGER)
    const b = await A.createAnnouncement('pizza', content({ subject: 'อีกเรื่อง' }), ADMIN)
    await A.markReady('pizza', a.id, { a5Fits: true }, MANAGER)
    await A.markReady('pizza', b.id, { a5Fits: true }, ADMIN)
    const [pa, pb] = await Promise.all([
      A.publishAnnouncement('pizza', a.id, MANAGER),
      A.publishAnnouncement('pizza', b.id, ADMIN),
    ])
    expect(new Set([pa.docNo, pb.docNo]).size).toBe(2)
  })

  test('publishing twice does not issue a second number', async () => {
    const p = await published()
    await expect(A.publishAnnouncement('pizza', p.id, MANAGER)).rejects.toThrow()
    expect((raw('counters')[0] as { value: number }).value).toBe(1)
  })

  test('a draft cannot jump to published without being checked as ready', async () => {
    const a = await A.createAnnouncement('pizza', content(), MANAGER)
    await expect(A.publishAnnouncement('pizza', a.id, MANAGER)).rejects.toThrow()
  })
})

describe('who writes it, and what is frozen', () => {
  test('a หัวหน้า or admin writes announcements; staff do not', async () => {
    expect(canWriteAnnouncements('manager')).toBe(true)
    expect(canWriteAnnouncements('admin')).toBe(true)
    expect(canWriteAnnouncements('staff')).toBe(false)
    await expect(A.createAnnouncement('pizza', content(), STAFF)).rejects.toThrow()
  })

  test('the publisher is the signed-in person, not something typed', async () => {
    const a = await A.createAnnouncement('pizza', content(), MANAGER)
    expect(a.publisherId).toBe(MANAGER.id)
    expect(a.publisherName).toBe('หัวหน้า A')
    const p = await published()
    expect(p.publishedBy).toBe(MANAGER.id)
    expect(p.snapshot?.text).toContain('ผู้ประกาศ: หัวหน้า A')
  })

  test('editing a ready announcement sends it back to draft — what was previewed is not this', async () => {
    const a = await A.createAnnouncement('pizza', content(), MANAGER)
    await A.markReady('pizza', a.id, { a5Fits: true }, MANAGER)
    const e = await A.updateAnnouncement('pizza', a.id, content({ subject: 'แก้แล้ว' }), MANAGER)
    expect(e.status).toBe('draft')
  })

  test('a published announcement cannot be edited', async () => {
    const p = await published()
    await expect(A.updateAnnouncement('pizza', p.id, content({ subject: 'x' }), MANAGER)).rejects.toThrow()
  })

  test('an A5 whose words overflow the page is refused, not printed broken', async () => {
    const a = await A.createAnnouncement('pizza', content({ format: 'a5' }), MANAGER)
    await expect(A.markReady('pizza', a.id, { a5Fits: false }, MANAGER)).rejects.toThrow()
    expect((await A.markReady('pizza', a.id, { a5Fits: true }, MANAGER)).status).toBe('ready')
  })

  test('empty words and missing groups are refused', () => {
    expect(() => A.cleanContent(content({ subject: '   ' }))).toThrow()
    expect(() => A.cleanContent(content({ body: '' }))).toThrow()
    expect(() => A.cleanContent(content({ target: { mode: 'personal', companyScope: [] } }))).toThrow()
    // The Official Account route is designed, not built (owner, 24 Sep 2026).
    expect(() => A.cleanContent(content({ target: { mode: 'auto', companyScope: ['pizza'] } }))).toThrow()
  })

  test('the snapshot keeps what was said and which logo it said it with', async () => {
    await saveCompanyProfile('pizza', { docPrefix: 'PZM', announcementCode: 'ANN', logoDataUrl: 'data:image/png;base64,AAAA' }, ADMIN)
    const p = await published()
    expect(p.snapshot).toMatchObject({ subject: 'ปรับเวลารับสินค้า', companyName: 'Pizza Mania', logoVersion: 1, layoutVersion: A.LAYOUT_VERSION })
    expect(p.snapshot?.text).toContain('PZM-ANN-2569-0001')
  })
})

describe('sending', () => {
  test('only what LINE reported is recorded as sent', async () => {
    const p = await published()
    const opened = await A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'shareOpened', via: 'shareSheet' }, MANAGER)
    expect(opened.status).toBe('published')
    const sent = await A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'sent', via: 'liff' }, MANAGER)
    expect(sent.status).toBe('sent')
    expect(sent.sends.map((s) => [s.outcome, s.via, s.by])).toEqual([
      ['shareOpened', 'shareSheet', MANAGER.id],
      ['sent', 'liff', MANAGER.id],
    ])
  })

  test('a failure is kept in the log too', async () => {
    const p = await published()
    const f = await A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'failed', via: 'liff', error: 'FORBIDDEN' }, MANAGER)
    expect(f.status).toBe('published')
    expect(f.sends[0].error).toBe('FORBIDDEN')
  })

  test('an A5 cannot go through LINE’s picker before its PDF exists, and its files are written once', async () => {
    const p = await published('pizza', { format: 'a5' })
    await expect(A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'sent', via: 'liff' }, MANAGER)).rejects.toThrow()
    const files = { pdfUrl: 'https://x/a/1.pdf', imageUrl: 'https://x/a/2.jpg', previewUrl: 'https://x/a/3.jpg', pdfBytes: 1000 }
    const f = await A.attachFiles('pizza', p.id, files, MANAGER)
    expect(f.files?.pdfUrl).toBe('https://x/a/1.pdf')
    await expect(A.attachFiles('pizza', p.id, files, MANAGER)).rejects.toThrow()
    expect((await A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'sent', via: 'liff' }, MANAGER)).status).toBe('sent')
  })

  test('a draft cannot be sent', async () => {
    const a = await A.createAnnouncement('pizza', content(), MANAGER)
    await expect(A.recordSend('pizza', a.id, { mode: 'personal', outcome: 'sent', via: 'liff' }, MANAGER)).rejects.toThrow()
  })

  test('cancelling: fine before anything went out, refused after', async () => {
    const p = await published()
    expect(isCancellable(p)).toBe(true)
    await A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'sent', via: 'liff' }, MANAGER)
    await expect(A.cancelAnnouncement('pizza', p.id, 'ผิด', MANAGER)).rejects.toThrow()
    const q = await published()
    const c = await A.cancelAnnouncement('pizza', q.id, 'ประกาศซ้ำ', MANAGER)
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'ประกาศซ้ำ', cancelledBy: MANAGER.id })
    // The number stays on the record; it is not reused.
    expect(c.docNo).toBe('PZM-ANN-2569-0002')
    expect((await published()).docNo).toBe('PZM-ANN-2569-0003')
  })

  test('the history says who did each step', async () => {
    const p = await published()
    await A.recordSend('pizza', p.id, { mode: 'personal', outcome: 'sent', via: 'liff' }, ADMIN)
    const stored = raw('announcements')[0] as unknown as Announcement
    expect(stored.history.map((h) => [h.action, h.by])).toEqual([
      ['created', MANAGER.id],
      ['ready', MANAGER.id],
      ['published', MANAGER.id],
      ['send:sent', ADMIN.id],
    ])
  })
})

describe('the state machine', () => {
  test('matches the rules’ announcementMove()', () => {
    expect(canMoveAnnouncement('draft', 'published')).toBe(false)
    expect(canMoveAnnouncement('ready', 'published')).toBe(true)
    expect(canMoveAnnouncement('published', 'draft')).toBe(false)
    expect(canMoveAnnouncement('sent', 'cancelled')).toBe(false)
    expect(canMoveAnnouncement('partiallySent', 'sent')).toBe(true)
  })
})

describe('the LINE text', () => {
  const base = { companyName: 'Pizza Mania', announcementDate: SEP_24, subject: 'เรื่องทดสอบ', body: 'บรรทัด 1\r\n\r\n\r\nบรรทัด 2   ', publisherName: 'หัวหน้า A' }

  test('says who, what, when and the number, in that order', () => {
    const text = announcementText({ ...base, docNo: 'PZM-ANN-2569-0001' })
    expect(text.split('\n')).toEqual([
      '📢 ประกาศ — Pizza Mania',
      'เลขที่ PZM-ANN-2569-0001',
      'วันที่ 24/09/2569',
      'เรื่อง เรื่องทดสอบ',
      '',
      'บรรทัด 1',
      '',
      'บรรทัด 2',
      '',
      'ผู้ประกาศ: หัวหน้า A',
    ])
  })

  test('in English when the document is in English', () => {
    expect(announcementText({ ...base, docNo: 'X' }, 'en')).toContain('24/09/2026')
  })

  test('the A5 caption carries the PDF link, because LINE cannot carry the file', () => {
    expect(a5Caption({ docNo: 'PZM-ANN-2569-0001', companyName: 'Pizza Mania', subject: 'ส', pdfUrl: 'https://x/a/1.pdf' })).toContain('https://x/a/1.pdf')
  })

  test('body clean-up and the LINE length limit', () => {
    expect(normalizeBody('a  \n\n\n\nb')).toBe('a\n\nb')
    expect(LINE_TEXT_MAX).toBe(5000)
  })

  test('company profile documents are admin-only', async () => {
    await expect(saveCompanyProfile('pizza', { docPrefix: 'X', announcementCode: 'Y' }, MANAGER)).rejects.toThrow()
    seed('lelapin__companyProfile', [{ id: 'main', docPrefix: 'LL', announcementCode: 'NOTE' } satisfies CompanyProfile])
    expect((await getCompanyProfile('lelapin')).docPrefix).toBe('LL')
  })
})
