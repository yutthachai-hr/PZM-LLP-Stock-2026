import type { Ref } from 'react'
import { A5_PX } from '../lib/a5'
import { formatDateFor } from '../lib/format'
import { translatorFor, type Lang } from '../i18n/I18nContext'

/**
 * A company announcement on one A5 page, as suppliers see it — in the LINE picture and as
 * the PDF's only page. The same element is previewed on screen, measured for overflow,
 * and photographed, so what the หัวหน้า checks is what goes out.
 *
 * Sized in CSS px to A5 (lib/a5.ts). The body has a fixed share of the page and clips
 * instead of growing: an announcement too long for A5 must not push the signature off the
 * paper. `bodyRef` lets the screen compare the body's scrollHeight with its height and say
 * so before anything is published.
 *
 * The logo comes from the company profile (Settings → ข้อมูลบริษัท), never from a file in
 * the code; a company with none uploaded shows its name alone.
 *
 * Photographed by html2canvas, so the same two constraints as PoSheet: no opacity
 * modifiers on colours (html2canvas cannot parse oklab), and a white page always.
 */
export function AnnouncementSheet({
  companyName,
  logoDataUrl,
  accent,
  docNo,
  announcementDate,
  subject,
  body,
  publisherName,
  lang = 'th',
  ref,
  bodyRef,
}: {
  companyName: string
  logoDataUrl?: string
  /** The brand's accent (BrandDef.accent) — a plain hex, which html2canvas can read. */
  accent: string
  docNo?: string
  announcementDate: number
  subject: string
  body: string
  publisherName: string
  lang?: Lang
  ref?: Ref<HTMLDivElement>
  bodyRef?: Ref<HTMLDivElement>
}) {
  const t = translatorFor(lang)
  const date = formatDateFor(announcementDate, lang)
  return (
    <div
      ref={ref}
      className="flex flex-col bg-white text-ink"
      style={{ width: A5_PX.width, height: A5_PX.height, padding: '34px 38px', boxSizing: 'border-box' }}
    >
      <header className="flex items-center gap-4 pb-3" style={{ borderBottom: `3px solid ${accent}` }}>
        {logoDataUrl ? (
          <img src={logoDataUrl} alt="" style={{ height: 64, maxWidth: 150, objectFit: 'contain' }} />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold leading-tight" style={{ color: accent }}>
            {companyName}
          </div>
        </div>
      </header>

      <div className="mt-5 text-center">
        <div className="text-2xl font-bold tracking-wide">{t('ประกาศ')}</div>
        <div className="mt-1 text-xs text-ink-soft">
          {t('เลขที่')} {docNo ?? t('(ออกเลขเมื่อเผยแพร่)')} · {t('วันที่')} {date}
        </div>
      </div>

      <div className="mt-5 text-[15px] font-bold leading-snug">
        {t('เรื่อง')} {subject}
      </div>

      <div
        ref={bodyRef}
        className="mt-3 min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-[14px] leading-[1.75]"
      >
        {body}
      </div>

      <footer className="mt-4 flex items-end justify-between border-t border-line-strong pt-3 text-xs text-ink-soft">
        <div>
          <div className="text-ink-faint">{t('ผู้ประกาศ')}</div>
          <div className="mt-0.5 text-sm font-semibold text-ink">{publisherName}</div>
        </div>
        <div className="text-right text-ink-faint">
          {companyName}
          <br />
          {date}
        </div>
      </footer>
    </div>
  )
}
