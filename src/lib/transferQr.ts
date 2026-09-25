/**
 * What a transfer's Master QR carries, and how a scan is read back (Automation Plan
 * Phase 2, 25 Sep 2026).
 *
 * The code is the receiving page's own address, so a phone camera app opens it directly
 * and the in-app scanner reads the same thing. A scanner that only hands back text — a
 * handheld reader, someone typing the number off the sheet — may give just "TR-00012";
 * that is accepted too, and looked up by number.
 */

export function transferReceiveUrl(origin: string, transferId: string): string {
  return `${origin.replace(/\/+$/, '')}/transfers/${encodeURIComponent(transferId)}/receive`
}

export type ScannedTransfer = { id: string } | { docNo: string } | null

/** A scanned code as a transfer to open: by id from our own link, or by its TR- number. */
export function readTransferCode(code: string): ScannedTransfer {
  const text = code.trim()
  if (!text) return null
  const link = text.match(/\/transfers\/([^/?#\s]+)(?:\/receive)?\/?(?:[?#].*)?$/)
  if (link && link[1] !== 'today' && link[1] !== 'new') return { id: decodeURIComponent(link[1]) }
  const doc = text.toUpperCase().match(/^TR-?(\d{1,8})$/)
  if (doc) return { docNo: `TR-${doc[1].padStart(5, '0')}` }
  return null
}
