import type { PurchaseOrderLine } from '../types'

/**
 * The purchase order as a picture.
 *
 * The supplier gets one JPG in a chat, the same as they always have. What is here is the
 * arithmetic around that: how many lines fit on one picture before it stops being readable
 * on a phone, and how to photograph a DOM element at a density that survives LINE's
 * recompression.
 */

/**
 * Lines per picture. Beyond this the sheet is split into "1/2", "2/2".
 *
 * Forty rows at the sheet's line height is a tall, narrow image that still opens at a
 * readable size on a phone. The default is always one picture: most orders are under ten
 * lines, and a supplier who has only ever received one image should keep receiving one.
 */
export const LINES_PER_PAGE = 40

export function paginateLines<T extends PurchaseOrderLine>(
  lines: readonly T[],
  perPage = LINES_PER_PAGE,
): T[][] {
  if (lines.length <= perPage) return [[...lines]]
  const pages: T[][] = []
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage))
  return pages
}

export interface RenderOptions {
  /** Device-pixel multiplier. 2 reads well on a phone; 1 is for the small preview. */
  scale?: number
  /** JPEG quality, 0–1. */
  quality?: number
}

/**
 * Photograph an element as a JPEG.
 *
 * html2canvas is loaded on first use — it is a large library for a button most sessions
 * never press. White background regardless of the page, because the picture ends up in a
 * bright chat window.
 */
export async function renderElementToJpeg(el: HTMLElement, opts: RenderOptions = {}): Promise<Blob> {
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(el, {
    scale: opts.scale ?? 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  })
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', opts.quality ?? 0.92),
  )
  if (!blob) throw new Error('no image')
  return blob
}

/** The file name a downloaded or shared sheet carries. */
export function sheetFileName(docNo: string, page?: { n: number; of: number }): string {
  return page && page.of > 1 ? `${docNo}-${page.n}of${page.of}.jpg` : `${docNo}.jpg`
}
