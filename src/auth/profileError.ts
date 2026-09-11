/**
 * What a failed profile subscription actually means.
 *
 * The profile listener is how the app learns who is signed in and whether they still have
 * access. Its error callback used to do one thing for every failure — clear the user and
 * show the sign-in screen — which conflates two situations that are nothing alike:
 *
 *  - **denied**: the rules refused the read. The account really has lost access, and
 *    saying so is the correct response.
 *  - **transient**: the connection dropped, or the project ran out of its daily read
 *    quota. Nothing about this person changed. Signing them out throws away whatever they
 *    were in the middle of and asks for a password the account never stopped being
 *    entitled to use — and on a shared tablet left open on a counter, this is the case
 *    that actually happens.
 *
 * Firestore's onSnapshot does not retry: one error ends the listener for good. So treating
 * everything as denied meant a single network blip logged the branch out permanently until
 * someone typed the password again.
 *
 * Only `permission-denied` is a decision. Everything else — including an error with no
 * code at all — is assumed transient, because being wrong in that direction costs a retry,
 * and being wrong in the other costs the shift's work.
 */
export type ProfileErrorKind = 'denied' | 'transient'

export function classifyProfileError(err: unknown): ProfileErrorKind {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'permission-denied' ? 'denied' : 'transient'
}

/** Backoff before re-establishing the listener: 1s, 2s, 4s … capped at 30s. */
export function retryDelayMs(attempt: number): number {
  const capped = Math.min(Math.max(attempt, 1), 5)
  return Math.min(30_000, 1000 * 2 ** (capped - 1))
}
