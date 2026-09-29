import type { PurchaseOrder, StockMovement } from '../types'
import { bkkDayEnd, bkkDayStart, DAY_MS } from './inventoryRules/time'
import { isTransfer } from './stats/periodCompare'

/**
 * What the panels at the foot of the sidebar show (owner, 27 Sep 2026: the space under the
 * menu was "ว่างเกินไป"). Built only from what the app already holds — the movement
 * listener and the order cache the dashboard filled — so they cost no read and no write.
 */

export type LiveKind = 'receive' | 'issue' | 'transfer' | 'adjust' | 'consume' | 'order'

export interface LiveItem {
  key: string
  at: number
  kind: LiveKind
  who: string
  docNo: string
  /** The first product, or the supplier for an order. */
  subject: string
  /** Lines on the document. */
  lines: number
  link: string
}

/** How far back the feed looks: long enough that a quiet weekend still shows something. */
export const FEED_DAYS = 3

function kindOf(m: StockMovement): LiveKind {
  if (m.type === 'receive') return 'receive'
  if (m.type === 'adjust') return 'adjust'
  if (m.type === 'consume') return 'consume'
  return isTransfer(m) ? 'transfer' : 'issue'
}

/**
 * The latest documents, newest first: one entry per stock document (its rows grouped by
 * document number) and one per order placed. Voided rows and draft or cancelled orders
 * are not news.
 */
export function recentActivity(
  movements: readonly StockMovement[],
  orders: readonly PurchaseOrder[],
  now: number,
  limit = 4,
): LiveItem[] {
  const since = now - FEED_DAYS * DAY_MS
  const docs = new Map<string, LiveItem>()
  for (const m of movements) {
    // No upper bound: the panel's clock ticks once a minute, so a document filed since the
    // last tick is "in the future" by up to a minute — and it is exactly the news to show.
    if (m.voided || m.createdAt < since) continue
    const seen = docs.get(m.docNo)
    if (seen) {
      seen.lines++
      continue
    }
    docs.set(m.docNo, {
      key: `m:${m.docNo}`,
      at: m.createdAt,
      kind: kindOf(m),
      who: m.byUserName,
      docNo: m.docNo,
      subject: m.productName,
      lines: 1,
      link: `/movements?doc=${encodeURIComponent(m.docNo)}`,
    })
  }
  const items = [...docs.values()]
  for (const o of orders) {
    if (o.status === 'draft' || o.status === 'cancelled') continue
    if (o.createdAt < since) continue
    items.push({
      key: `o:${o.id}`,
      at: o.createdAt,
      kind: 'order',
      who: o.createdByName,
      docNo: o.docNo,
      subject: o.supplierName,
      lines: o.lines.length,
      link: `/orders?po=${encodeURIComponent(o.id)}`,
    })
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Orders still open that are due today — the deliveries to expect. */
export function dueToday(orders: readonly PurchaseOrder[], now: number): number {
  const from = bkkDayStart(now)
  const to = bkkDayEnd(now)
  return orders.filter((o) => o.status === 'ordered' && o.expectedAt !== undefined && o.expectedAt >= from && o.expectedAt <= to)
    .length
}

/** "just now", "5 min", "2 h", "3 d" — as translation keys with their number. */
export function sinceLabel(at: number, now: number): { key: string; n?: number } {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return { key: 'เมื่อสักครู่' } // i18n-key
  if (min < 60) return { key: '{n} นาที', n: min } // i18n-key
  const h = Math.floor(min / 60)
  if (h < 24) return { key: '{n} ชม.', n: h } // i18n-key
  return { key: '{n} วัน', n: Math.floor(h / 24) } // i18n-key
}
