import { statusFor, type ShareOutcome } from '../../share'

/**
 * What the wizard does once the share sheet / LINE picker has answered (R38 review, finding B).
 *
 * The "opened" status is written while the share is in flight, so either can fail on its own.
 * A share failure is a failed send (retry, download, copy, later). A status-write failure is not:
 * if LINE confirmed delivery, the order is recorded as sent, and if even that write fails the
 * screen says the message went but the record did not — offering to save again, never to resend.
 */
export type Settled =
  | { kind: 'cancelled' }
  | { kind: 'nextPage' }
  | { kind: 'ask' }
  | { kind: 'sent' }
  | { kind: 'sentUnsaved'; error: unknown }
  | { kind: 'failed'; error: unknown }

export async function settleShare(p: {
  shared: Promise<ShareOutcome>
  opened: Promise<unknown>
  isLast: boolean
  recordSent: () => Promise<void>
  recordFailed: () => Promise<void>
}): Promise<Settled> {
  // The picker may stay open for minutes; observe a concurrent write rejection immediately.
  const opened = p.opened.catch(() => {})
  let outcome: ShareOutcome
  try {
    outcome = await p.shared
  } catch (error) {
    await opened
    await p.recordFailed().catch(() => {})
    return { kind: 'failed', error }
  }
  // Settle the opened write before any later write; its own failure changes nothing below.
  await opened
  if (outcome === 'cancelled') return { kind: 'cancelled' }
  if (!p.isLast) return { kind: 'nextPage' }
  // Only LINE's own success report is taken as sent; the share sheet asks the person.
  if (statusFor(outcome) !== 'sent') return { kind: 'ask' }
  try {
    await p.recordSent()
    return { kind: 'sent' }
  } catch (error) {
    return { kind: 'sentUnsaved', error }
  }
}
