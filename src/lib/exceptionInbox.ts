import type { MonthlyCount, PurchaseOrder, PurchaseRequest, Transfer } from '../types'
import { daysLate, deliveryState } from './inventoryRules/purchasing'
import { PO_PARTIAL_DAYS, TRANSFER_STUCK_CRITICAL_DAYS, TRANSFER_STUCK_DAYS } from './inventoryRules/notifications'
import { DAY_MS } from './inventoryRules/time'

/**
 * The Exception Inbox (plan C3): every piece of work waiting on a หัวหน้า's decision, in
 * one list, worst first. Pure — the page gathers the records and draws the result.
 *
 * Each kind is something that does not move until a person acts. Without this page each
 * one sat on its own screen (requests, orders, transfers, counts) and was found by
 * remembering to look.
 */

export type InboxKind =
  | 'transferDiscrepancy'
  | 'transferStuck'
  | 'poDelayed'
  | 'poDatePending'
  | 'prApproval'
  | 'poDraft'
  | 'transferApproval'
  | 'poPartial'
  | 'countToPost'

export type InboxSeverity = 'critical' | 'high' | 'medium'
export type InboxGroup = 'approve' | 'stuck' | 'problem'

export interface InboxItem {
  /** Unique across kinds: `<kind>__<record id>`. */
  id: string
  kind: InboxKind
  group: InboxGroup
  severity: InboxSeverity
  /** Fills the kind's words (INBOX_TITLE / INBOX_DETAIL). */
  params: Record<string, string | number>
  link: string
  /** Since when it has been waiting — older first within a severity. */
  since: number
  locationId?: string
}

export const INBOX_GROUP: Record<InboxKind, InboxGroup> = {
  transferDiscrepancy: 'problem',
  transferStuck: 'stuck',
  poDelayed: 'stuck',
  poDatePending: 'approve',
  prApproval: 'approve',
  poDraft: 'approve',
  transferApproval: 'approve',
  poPartial: 'stuck',
  countToPost: 'approve',
}

/** Thai lookup keys for t(); {slots} filled from `params`. */
export const INBOX_TITLE: Record<InboxKind, string> = {
  transferDiscrepancy: 'ใบโอนมีผลต่างรอตัดสิน: {docNo}', // i18n-key
  transferStuck: 'สินค้าโอนค้างในทาง {days} วัน: {docNo}', // i18n-key
  poDelayed: 'ของยังไม่มา: {supplier} ({docNo})', // i18n-key
  poDatePending: 'รออนุมัติวันส่งใหม่: {supplier} ({docNo})', // i18n-key
  prApproval: 'รายการขอสั่งซื้อรออนุมัติ {docNo}', // i18n-key
  poDraft: 'ใบสั่งซื้อร่างรออนุมัติ: {supplier} ({docNo})', // i18n-key
  transferApproval: 'คำขอโอนสินค้ารออนุมัติ {docNo}', // i18n-key
  poPartial: 'ใบสั่งซื้อรับไม่ครบค้างนาน: {supplier} ({docNo})', // i18n-key
  countToPost: 'ยอดนับประจำเดือนรอปิดยอด: {location} {month}', // i18n-key
}

export const INBOX_DETAIL: Record<InboxKind, string> = {
  transferDiscrepancy: 'จาก {from} ไป {to} — ปลายทางรับไม่ตรงกับที่ส่ง', // i18n-key
  transferStuck: 'จาก {from} ไป {to} — ปลายทางยังไม่กดรับ', // i18n-key
  poDelayed: 'เลยกำหนดส่ง {days} วัน · {location}', // i18n-key
  poDatePending: 'ผู้ขายขอเลื่อนวันส่งเกินช่วงที่อนุญาต · {location}', // i18n-key
  prApproval: '{by} · {location} · {n} รายการ', // i18n-key
  poDraft: '{by} · {location} · {n} รายการ', // i18n-key
  transferApproval: '{by} · จาก {from} ไป {to} · {n} รายการ', // i18n-key
  poPartial: 'ยังค้างรับ {n} รายการ · ส่งครั้งล่าสุด {days} วันก่อน · {location}', // i18n-key
  countToPost: 'ยืนยันยอดนับแล้ว {n} รายการ — กดปิดยอดเพื่อปรับสต๊อก', // i18n-key
}

export interface InboxInput {
  now: number
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  transfers: readonly Transfer[]
  counts: readonly MonthlyCount[]
  locationName: (id: string | undefined) => string
  leadTimeOf?: (supplierId: string) => number | undefined
}

const RANK: Record<InboxSeverity, number> = { critical: 0, high: 1, medium: 2 }
const days = (now: number, since: number) => Math.max(0, Math.floor((now - since) / DAY_MS))

export function inboxItems(input: InboxInput): InboxItem[] {
  const { now } = input
  const loc = input.locationName
  const out: InboxItem[] = []
  const push = (kind: InboxKind, recordId: string, severity: InboxSeverity, since: number, link: string, params: InboxItem['params'], locationId?: string) =>
    out.push({ id: `${kind}__${recordId}`, kind, group: INBOX_GROUP[kind], severity, since, link, params, ...(locationId ? { locationId } : {}) })

  for (const tr of input.transfers) {
    const route = { docNo: tr.docNo, from: loc(tr.fromLocationId), to: loc(tr.toLocationId) }
    const link = `/transfers/${tr.id}`
    if (tr.status === 'discrepancy' || tr.status === 'pendingDiscrepancyApproval') {
      push('transferDiscrepancy', tr.id, 'high', tr.receivedAt ?? tr.updatedAt, link, route, tr.toLocationId)
    } else if (tr.status === 'pendingApproval') {
      push('transferApproval', tr.id, 'medium', tr.submittedAt ?? tr.createdAt, link, { ...route, by: tr.requestedByName, n: tr.items.length }, tr.fromLocationId)
    } else if (tr.status === 'inTransit' || tr.status === 'receiving') {
      const since = tr.approvedAt ?? tr.submittedAt ?? tr.createdAt
      const d = days(now, since)
      if (d >= TRANSFER_STUCK_DAYS) push('transferStuck', tr.id, d >= TRANSFER_STUCK_CRITICAL_DAYS ? 'critical' : 'high', since, link, { ...route, days: d }, tr.toLocationId)
    }
  }

  for (const po of input.orders) {
    const link = `/orders?po=${po.id}`
    const base = { supplier: po.supplierName, docNo: po.docNo, location: loc(po.locationId) }
    if (po.status === 'draft') {
      push('poDraft', po.id, 'medium', po.createdAt, link, { ...base, by: po.createdByName, n: po.lines.length }, po.locationId)
      continue
    }
    if (po.status !== 'ordered') continue
    if (po.pendingDeliveryDate) push('poDatePending', po.id, 'high', po.pendingDeliveryDate.at, link, base, po.locationId)
    const lead = input.leadTimeOf?.(po.supplierId)
    if (deliveryState(po, now, lead) === 'delayed') {
      const late = daysLate(po, now, lead)
      push('poDelayed', po.id, late >= 3 ? 'critical' : 'high', now - late * DAY_MS, link, { ...base, days: late }, po.locationId)
    }
    if (po.receipts?.length) {
      const owed = po.lines.filter((l) => l.orderedQty - (l.receivedQty ?? 0) > 1e-9).length
      const last = Math.max(...po.receipts.map((r) => r.date))
      const d = days(now, last)
      if (owed && d >= PO_PARTIAL_DAYS) push('poPartial', po.id, 'medium', last, link, { ...base, n: owed, days: d }, po.locationId)
    }
  }

  for (const pr of input.requests) {
    if (pr.status !== 'pendingApproval') continue
    push('prApproval', pr.id, 'medium', pr.submittedAt ?? pr.createdAt, `/requests/${pr.id}`, { docNo: pr.docNo, by: pr.requestedByName, location: loc(pr.locationId), n: pr.items.length }, pr.locationId)
  }

  for (const c of input.counts) {
    if (c.status !== 'recorded' && c.status !== 'posting') continue
    push('countToPost', c.id, 'medium', c.confirmedAt ?? c.updatedAt, `/counts/${c.id}`, { location: loc(c.locationId), month: c.month, n: Object.keys(c.lines).length }, c.locationId)
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.since - b.since)
}
