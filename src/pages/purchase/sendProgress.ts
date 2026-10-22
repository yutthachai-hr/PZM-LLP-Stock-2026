import type { PurchaseOrder } from '../../types'

/**
 * Which page of a multi-page order sheet has been shared, kept across a reload (owner P0,
 * 22 Oct 2026). A phone often drops the page while LINE is in front; without this the wizard
 * came back on page 1 and the person shared it again. Local storage, because a home-screen app
 * killed in the background loses session storage too. A day is plenty: older progress is stale.
 *
 * Keyed by brand, person, order AND what the order says (R38 review, finding A): an order amended
 * after page 1 went out starts again at page 1, and a colleague on the same device starts fresh.
 */
const KEY = 'pmstock:v1:send-progress'
const TTL_MS = 86_400_000

type Progress = Record<string, { page: number; at: number; fp: string }>

export interface ProgressScope {
  brand: string
  userId: string
  orderId: string
  /** orderFingerprint() of the order as it is being sent. */
  fingerprint: string
}

/** What the sheet shows; status fields (shareStatus, sentAt, updatedAt…) are deliberately out. */
export function orderFingerprint(o: Pick<PurchaseOrder, 'id' | 'lines'> & Partial<Pick<PurchaseOrder, 'revision' | 'expectedAt' | 'note'>>): string {
  return JSON.stringify([o.id, o.revision ?? 0, o.expectedAt ?? 0, o.note ?? '', o.lines.map((l) => [l.productId, l.orderedQty, l.unit])])
}

function read(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Progress
  } catch {
    return {}
  }
}

function write(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode: progress is a convenience, the order status is the record */
  }
}

const key = (s: ProgressScope) => `${s.brand}:${s.userId}:${s.orderId}`

/** The next page to share for this order, or 0. Never beyond the order's last page. */
export function pageToResume(s: ProgressScope, pages: number, now = Date.now()): number {
  const p = read()[key(s)]
  if (!p || p.fp !== s.fingerprint || now - p.at > TTL_MS || p.page < 1) return 0
  return Math.min(p.page, Math.max(pages - 1, 0))
}

export function savePageProgress(s: ProgressScope, page: number, now = Date.now()): void {
  const all = read()
  for (const [k, v] of Object.entries(all)) if (now - v.at > TTL_MS) delete all[k]
  all[key(s)] = { page, at: now, fp: s.fingerprint }
  write(all)
}

export function clearPageProgress(s: ProgressScope): void {
  const all = read()
  if (!(key(s) in all)) return
  delete all[key(s)]
  write(all)
}
