/**
 * What went wrong with a live listener, in the words a screen needs (plan C1).
 *
 * A listener the database ends delivers nothing more. Before C1 the app logged it and
 * carried on showing whatever it had — or an empty list, which reads as "nothing here".
 */
export type LiveErrorKind = 'denied' | 'quota' | 'offline' | 'other'

export function liveErrorKind(err: unknown): LiveErrorKind {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'permission-denied' || code === 'unauthenticated') return 'denied'
  if (code === 'resource-exhausted') return 'quota'
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'offline'
  return 'other'
}

/** Whether to try again by itself: a dropped connection heals; a refusal does not. */
export function retriesBySelf(kind: LiveErrorKind): boolean {
  return kind === 'offline' || kind === 'other'
}

export interface LiveFailure {
  collection: string
  kind: LiveErrorKind
  /**
   * When the subscription that failed was started. A retry pressed after that moment did
   * not cover it — its refusal was still on the way — so the caller retries it once more
   * (DataContext; found by the flakiness runs, 7 Oct 2026).
   */
  startedAt?: number
}

/** The message a banner shows for a failed listener. Thai lookup keys for t(). */
export const LIVE_ERROR_TEXT: Record<LiveErrorKind, string> = {
  denied: 'ไม่มีสิทธิ์อ่านข้อมูลบางส่วน — ตัวเลขบนจออาจไม่ครบ', // i18n-key
  quota: 'โควตาการอ่านข้อมูลวันนี้เต็ม — ตัวเลขบนจออาจไม่เป็นปัจจุบัน', // i18n-key
  offline: 'การเชื่อมต่อขาด — ตัวเลขบนจออาจไม่เป็นปัจจุบัน', // i18n-key
  other: 'โหลดข้อมูลไม่สำเร็จ — ตัวเลขบนจออาจไม่ครบ', // i18n-key
}

/** The one failure worth telling first: a refusal before a quota before a dropped line. */
export function worstFailure(failures: readonly (LiveFailure | null)[]): LiveFailure | null {
  const rank: Record<LiveErrorKind, number> = { denied: 3, quota: 2, other: 1, offline: 0 }
  let worst: LiveFailure | null = null
  for (const f of failures) if (f && (!worst || rank[f.kind] > rank[worst.kind])) worst = f
  return worst
}
