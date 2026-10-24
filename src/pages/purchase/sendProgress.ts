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

interface ShareAttempt { page: number; version: number; confirmed: boolean }
type Progress = Record<string, { page: number; at: number; fp: string; attempt?: ShareAttempt }>

export interface ProgressScope {
  brand: string
  userId: string
  orderId: string
  /** orderFingerprint() of the order as it is being sent. */
  fingerprint: string
}

/**
 * What the sheet shows; status fields (shareStatus, sentAt, updatedAt…) are deliberately out.
 * Stored as a digest so a shared device keeps no readable note or lines (R40). Synchronous because
 * the attempt is journalled in the same tick as the share hand-off; crypto.subtle is async.
 */
export function orderFingerprint(o: Pick<PurchaseOrder, 'id' | 'lines'> & Partial<Pick<PurchaseOrder, 'revision' | 'expectedAt' | 'note'>>): string {
  const text = JSON.stringify([o.id, o.revision ?? 0, o.expectedAt ?? 0, o.note ?? '', o.lines.map((l) => [l.productId, l.orderedQty, l.unit])])
  return digest(text, 0) + digest(text, 1)
}

// shortcut: fast unkeyed hash (cyrb53 ×2, ~106 bits); guessable content can be confirmed offline, upgrade to a keyed digest if device forensics enters the threat model.
function digest(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0')
}

function read(): Progress {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Progress : {}
  } catch {
    return {}
  }
}

function write(p: Progress): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    return true
  } catch {
    return false
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
  for (const [k, v] of Object.entries(all)) if (!v || (now - v.at > TTL_MS && !v.attempt)) delete all[k]
  all[key(s)] = { page, at: now, fp: s.fingerprint }
  write(all)
}

/** Journal the uncertain hand-off synchronously, before leaving the app for LINE. */
export function beginShareAttempt(s: ProgressScope, page: number, version: number, now = Date.now()): boolean {
  const all = read()
  all[key(s)] = { page, at: now, fp: s.fingerprint, attempt: { page, version, confirmed: false } }
  return write(all)
}

// An unresolved send never expires: elapsed time does not prove LINE failed to deliver it.
export function shareToRecover(s: ProgressScope, pages: number): ShareAttempt | null {
  const p = read()[key(s)]
  const a = p?.attempt
  if (!p || p.fp !== s.fingerprint || !Number.isFinite(p.at) || !a || !Number.isInteger(a.page) || a.page < 0 || a.page >= pages || !Number.isInteger(a.version) || a.version < 1 || typeof a.confirmed !== 'boolean') return null
  return a
}

export function confirmShareAttempt(s: ProgressScope): void {
  const all = read()
  const p = all[key(s)]
  if (p?.fp === s.fingerprint && p.attempt) {
    p.attempt.confirmed = true
    write(all)
  }
}

export function clearShareAttempt(s: ProgressScope): void {
  const all = read()
  if (all[key(s)]?.attempt) {
    delete all[key(s)].attempt
    write(all)
  }
}

export function clearPageProgress(s: ProgressScope): void {
  const all = read()
  if (!(key(s) in all)) return
  delete all[key(s)]
  write(all)
}
