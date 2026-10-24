import type { HostedImage } from '../services/poImages'
import type { PurchaseShareStatus } from '../types'

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

/**
 * What is being sent, so the send can be picked back up after LINE Login takes the person
 * away: an order resumes through `?send=<id>`, an announcement through `?announce=<id>`
 * (share/liffResume.ts).
 */
export interface ShareSubject {
  /** 'digest' — the dashboard's daily summary (Automation Plan Phase 5, 25 Sep 2026). */
  kind: 'order' | 'announcement' | 'digest'
  id: string
  /** A multi-order send in progress (pages/purchase/sendSession), so LINE Login brings back all of it. */
  batch?: string
}

export interface SharePayload {
  subject: ShareSubject
  /**
   * The picture, as a file, for providers that take one. Absent for a text-only message
   * (an announcement in TEXT form), which is the caption alone.
   */
  file?: File
  /** The picture on a public address, for providers that take a URL. */
  hosted?: Pick<HostedImage, 'url' | 'previewUrl'>
  /**
   * The line of text that goes with the picture — "ใบสั่งซื้อ PO-00003 — Pizza Mania".
   * A phone's share sheet sends it as the message title; the LINE picker sends it as a
   * text message ahead of the picture, so the two routes read the same in the chat
   * (owner, 21 Sep 2026: the tablet and the computer were sending a bare picture).
   */
  caption: string
  /**
   * A LINE Flex card to send instead of the caption, for the LIFF picker (the digest). The
   * share sheet and the clipboard, which cannot carry one, send `caption` as before.
   */
  flex?: { altText: string; contents: Record<string, unknown> }
  /**
   * A Flex card sent between the caption and the picture — the supplier's
   * [ยืนยันวันจัดส่ง] button (5 Oct 2026). LIFF only: the picker allows link (URI) buttons
   * and nothing else, which is all this is. The share sheet cannot carry a card, so the
   * caption already holds the same link as text.
   */
  card?: { altText: string; contents: Record<string, unknown> }
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
  /**
   * LIFF in an ordinary browser before LINE Login (R40 P0). While true a share must not start:
   * the login redirect is not a send, and treating it as one wrote "opened" for nothing.
   * Synchronous, so a tap can check it without spending the gesture.
   */
  needsLogin?(): boolean
  /** Off to LINE Login (or to the LINE app from a home-screen app), back to `subject`. Writes nothing. */
  connect?(subject: ShareSubject): void
  /** True straight after a share() call that left for LINE Login instead of sharing (same tick). */
  leftForLogin?(): boolean
}

/** The order status an outcome is recorded as, or null when nothing should be written. */
export function statusFor(outcome: ShareOutcome): PurchaseShareStatus | null {
  if (outcome === 'sent') return 'sent'
  if (outcome === 'shareOpened') return 'shareOpened'
  return null
}
