import type { BrandId } from '../../brand/brand'
import { genId } from '../../lib/id'
import { needsResend } from '../../lib/poRevision'
import type { PurchaseOrder } from '../../types'

/**
 * Several orders sent to LINE in one go, as one session (owner P0, R40). The list of orders used
 * to live only in React state, so LINE Login, a reload or the phone dropping the page while LINE
 * was in front brought the person back to a one-order wizard — or, choosing the batch again, to
 * supplier #1 even though it had already gone.
 *
 * What is kept is only the plan: which orders, in which order, since when. Where each order got
 * to is read from the order itself (`shareStatus`, `sentAt`, written under Firestore Rules by the
 * person's own sign-in), so the same session continues correctly in any browser the person is
 * signed in to — the home-screen app, Safari after LINE Login, LINE's own browser. The plan
 * travels in the URL for those hops (no storage is shared between them) and in this device's
 * storage for a plain reload.
 */
export interface SendSession {
  v: 1
  id: string
  brand: BrandId
  /** Who started it; empty when read back from a URL, which proves nothing about the person. */
  userId: string
  orderIds: string[]
  startedAt: number
}

const MAX_ORDERS = 50
const MAX_AGE_MS = 7 * 86_400_000
const ID = /^[A-Za-z0-9_-]{1,64}$/
const KEY = 'pmstock:v1:send-session'

/** Already delivered for what the order now says: sent, and not amended since. */
export function delivered(o: PurchaseOrder): boolean {
  return o.shareStatus === 'sent' && !needsResend(o)
}

/** The orders a batch goes through: placed, chosen, in the chosen order, not already delivered. */
export function queueFor(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter((o) => o.status === 'ordered' && !delivered(o))
}

export function startSession(brand: BrandId, userId: string, orderIds: string[], now = Date.now()): SendSession {
  return { v: 1, id: genId(), brand, userId, orderIds: orderIds.slice(0, MAX_ORDERS), startedAt: now }
}

/**
 * Finished within this session: delivered, skipped since the session began, or no longer a placed
 * order (cancelled or received meanwhile — nothing to send). Opened, failed or unknown is not
 * finished: the person is asked, or sends it again.
 */
export function sessionDone(o: PurchaseOrder, s: SendSession): boolean {
  return o.status !== 'ordered' || delivered(o) || (o.shareStatus === 'skipped' && (o.updatedAt ?? 0) >= s.startedAt)
}

/** `1.<id>.<startedAt>.<a~b~c>`, or '' when an id cannot travel in a URL as it is. */
export function encodeSession(s: SendSession): string {
  if (!ID.test(s.id) || !s.orderIds.length || !s.orderIds.every((id) => ID.test(id))) return ''
  return `1.${s.id}.${s.startedAt}.${s.orderIds.join('~')}`
}

/** A session read back from a URL; null for anything malformed, too long or older than a week. */
export function decodeSession(raw: string | null, brand: BrandId, now = Date.now()): SendSession | null {
  const m = /^1\.([A-Za-z0-9_-]{1,64})\.(\d{13})\.([A-Za-z0-9_~-]+)$/.exec(raw ?? '')
  if (!m) return null
  const startedAt = Number(m[2])
  const orderIds = m[3].split('~')
  if (now - startedAt > MAX_AGE_MS || startedAt > now + 60_000) return null
  if (orderIds.length > MAX_ORDERS || !orderIds.every((id) => ID.test(id))) return null
  return { v: 1, id: m[1], brand, userId: '', orderIds, startedAt }
}

const key = (brand: string, userId: string) => `${KEY}:${brand}:${userId}`

export function saveSession(s: SendSession): void {
  try {
    localStorage.setItem(key(s.brand, s.userId), JSON.stringify(s))
  } catch {
    /* private mode: the URL still carries it across LINE Login */
  }
}

/** The unfinished session this person left on this device for this brand, if any. */
export function activeSession(brand: BrandId, userId: string, now = Date.now()): SendSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(key(brand, userId)) ?? 'null') as SendSession | null
    if (!s || s.v !== 1 || s.brand !== brand || s.userId !== userId || !Array.isArray(s.orderIds)) return null
    return now - s.startedAt > MAX_AGE_MS ? null : s
  } catch {
    return null
  }
}

export function clearSession(s: Pick<SendSession, 'brand' | 'userId'>): void {
  try {
    localStorage.removeItem(key(s.brand, s.userId))
  } catch {
    /* nothing kept */
  }
}
