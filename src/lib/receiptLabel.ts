import type { StockMovement } from '../types'

type Noted = Pick<StockMovement, 'note' | 'supplierName' | 'invoiceNo' | 'poDocNo'>

/**
 * What a movement's "note / bill" column says, for receipts filed either way.
 *
 * Since 24 Sep 2026 a receipt carries its supplier, bill number and order as fields and
 * keeps `note` for the note alone; before that the supplier and bill number were typed into
 * `note` itself. Both kinds sit side by side in every report, so this is the one place that
 * reads them: new rows compose "SIAMFOOD · IV-1001 · PO-00005 · note", old rows print their
 * note as they always did. `tr` translates a note that is a stored UI key ("ตั้งยอดคงเหลือ").
 */
export function movementNote(m: Noted, tr: (s: string) => string = (s) => s): string {
  const note = m.note?.trim() ?? ''
  const paperwork = [m.supplierName, m.invoiceNo, m.poDocNo].map((v) => v?.trim()).filter(Boolean)
  if (paperwork.length === 0) return note ? tr(note) : ''
  return [...paperwork, ...(note ? [note] : [])].join(' · ')
}
