/**
 * The A5 announcement as paper: 148 × 210 mm, portrait.
 *
 * The sheet is drawn once in the DOM (components/AnnouncementSheet.tsx), photographed once
 * (lib/poImage.ts renderElementToJpeg), and that one picture becomes both the image that
 * goes into LINE and the single page of the PDF. Thai is shaped by the browser, so it is
 * right in both — jsPDF's own text drawing does not shape Thai vowels and tone marks.
 * The cost is honest: the PDF's text is a picture, and cannot be selected or searched.
 */

export const A5_MM = { width: 148, height: 210 } as const

/** The sheet's size on screen, in CSS px at 96 per inch: 148 mm ≈ 559 px, 210 mm ≈ 794 px. */
export const A5_PX = { width: 559, height: 794 } as const

/**
 * A short announcement is what A5 is for. Past this many characters the screen warns before
 * anything is measured; the measurement (`bodyFits`) is what actually decides.
 */
export const A5_SOFT_CHARS = 900

/**
 * Whether the body's box holds its text. The box has a fixed height inside the page; text
 * that overflows it is clipped rather than pushing the footer off the paper, and this is
 * how the screen knows it happened. One px of slack for sub-pixel rounding.
 */
export function bodyFits(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight <= clientHeight + 1
}

type PdfCtor = new (opts: { orientation: 'portrait'; unit: 'mm'; format: 'a5' }) => {
  addImage(data: Uint8Array, format: string, x: number, y: number, w: number, h: number): void
  setProperties(p: Record<string, string>): void
  output(type: 'arraybuffer'): ArrayBuffer
}

/**
 * One A5 page holding the sheet's picture edge to edge.
 *
 * `jsPDF` is passed in by the caller (or loaded here on first use) because it is a large
 * library that most sessions never need.
 */
export async function a5PdfFromJpeg(
  jpeg: Blob,
  meta: { title: string; author: string },
  Ctor?: PdfCtor,
): Promise<Blob> {
  const PDF = Ctor ?? ((await import('jspdf')).jsPDF as unknown as PdfCtor)
  const doc = new PDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
  doc.setProperties({ title: meta.title, author: meta.author, creator: 'Inventory Pzm' })
  const bytes = new Uint8Array(await jpeg.arrayBuffer())
  doc.addImage(bytes, 'JPEG', 0, 0, A5_MM.width, A5_MM.height)
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })
}
