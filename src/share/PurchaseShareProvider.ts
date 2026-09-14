import type { HostedImage } from '../services/poImages'
import type { PurchaseOrder, PurchaseShareStatus } from '../types'

/**
 * How an order sheet reaches a supplier.
 *
 * The purchase side of the app knows nothing about LINE. It knows that an order has a
 * picture, that the picture can be handed to a provider, and that the provider comes back
 * with one of the outcomes below. Today there are two providers — the person's own LINE
 * through LIFF, and the phone's share sheet — and the LINE Official Account or an e-mail
 * would be a third file here, not a change to the orders.
 *
 * What an outcome may honestly claim:
 *   - `sent`        the provider itself reported the message went (LINE said so). It does
 *                   not mean the supplier has read it, and no screen says that it does.
 *   - `shareOpened` the picture was handed over — to the share sheet, to a download — and
 *                   nothing more is known. The person says what happened next.
 *   - `cancelled`   the person closed the picker without sending. Nothing is recorded.
 */
export type ShareOutcome = 'sent' | 'shareOpened' | 'cancelled'

export interface SharePayload {
  order: PurchaseOrder
  page: { n: number; of: number }
  /** The picture, as a file, for providers that take one. */
  file: File
  /** The picture on a public address, for providers that take a URL. */
  hosted?: HostedImage
}

export interface PurchaseShareProvider {
  id: 'line-liff' | 'web-share'
  /** Shown on the button ("send LINE", "share picture"). A t() key. */
  label: string
  /** Whether this provider can work on this device right now. */
  isAvailable(): Promise<boolean>
  /** Whether `share` needs `hosted` filled in. */
  needsHosting: boolean
  share(payload: SharePayload): Promise<ShareOutcome>
}

/** The order status an outcome is recorded as, or null when nothing should be written. */
export function statusFor(outcome: ShareOutcome): PurchaseShareStatus | null {
  if (outcome === 'sent') return 'sent'
  if (outcome === 'shareOpened') return 'shareOpened'
  return null
}
