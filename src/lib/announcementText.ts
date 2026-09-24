import { translatorFor, type Lang } from '../i18n/I18nContext'
import { formatDateFor } from './format'

/**
 * An announcement as LINE text.
 *
 * TEXT announcements go out as exactly this; A5 ones go out as the picture plus a short
 * caption carrying the PDF link, because a LINE message cannot carry a PDF file. The
 * document's language is its own (Thai unless asked otherwise) — the person writing may
 * be reading the app in English, the suppliers are not.
 */

/** LINE's limit on one text message. */
export const LINE_TEXT_MAX = 5000

export interface AnnouncementTextInput {
  /** Absent before publishing: the preview says where the number will go. */
  docNo?: string
  companyName: string
  announcementDate: number
  subject: string
  body: string
  publisherName: string
}

export function announcementText(a: AnnouncementTextInput, lang: Lang = 'th'): string {
  const t = translatorFor(lang)
  const no = a.docNo ?? t('(ออกเลขเมื่อเผยแพร่)')
  return [
    `📢 ${t('ประกาศ')} — ${a.companyName}`,
    `${t('เลขที่')} ${no}`,
    `${t('วันที่')} ${formatDateFor(a.announcementDate, lang)}`,
    `${t('เรื่อง')} ${a.subject.trim()}`,
    '',
    normalizeBody(a.body),
    '',
    `${t('ผู้ประกาศ')}: ${a.publisherName}`,
  ].join('\n')
}

/** The text that travels with an A5 picture: what it is, and where the PDF is. */
export function a5Caption(
  a: { docNo: string; companyName: string; subject: string; pdfUrl: string },
  lang: Lang = 'th',
): string {
  const t = translatorFor(lang)
  return [
    `📢 ${t('ประกาศ')} ${a.docNo} — ${a.companyName}`,
    `${t('เรื่อง')} ${a.subject.trim()}`,
    `${t('ไฟล์ PDF')}: ${a.pdfUrl}`,
  ].join('\n')
}

/** Line endings as typed on any device, trailing spaces gone, at most one blank line in a row. */
export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function fitsLine(text: string): boolean {
  return text.length <= LINE_TEXT_MAX
}
