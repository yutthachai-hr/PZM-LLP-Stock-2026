/**
 * Ask PZM — the answers. Pure functions over a read-only snapshot: every figure comes from the
 * snapshot, never from a model. A missing slot asks a question back instead of guessing.
 */
import { findEntity, horizonDays, type Named } from './guard'
import type { AskIntent } from './intents'

export interface AskSnapshot {
  asOf: number
  sites: Named[]
  products: (Named & { sku: string; unit: string })[]
  /** On-hand per product per site, in the product's stock unit. */
  balances: { productId: string; siteId: string; qty: number }[]
  /** Average daily usage per product per site (the app's demand figure). */
  usage: { productId: string; siteId: string; perDay: number }[]
  orders: { docNo: string; supplierName: string; status: 'draft' | 'ordered' | 'received' | 'cancelled'; locationId: string; orderedAt: number; supplierConfirmedAt?: number }[]
  transfers: { docNo: string; fromId: string; toId: string; status: string }[]
}

export type Answer =
  | { kind: 'ANSWER'; intent: AskIntent; text: string; facts: Record<string, unknown> }
  | { kind: 'CLARIFY'; intent: AskIntent | null; text: string }
  | { kind: 'REFUSE'; reason: 'WRITE' | 'INJECTION' | 'OUT_OF_SCOPE'; text: string }

const OPEN_TRANSFER = ['pendingApproval', 'inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval']
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')
const siteName = (s: AskSnapshot, id: string) => s.sites.find((x) => x.id === id)?.name ?? id

export function answer(intent: AskIntent, text: string, s: AskSnapshot): Answer {
  switch (intent) {
    case 'stock_lookup': {
      const p = findEntity(text, s.products)
      if (!p) return { kind: 'CLARIFY', intent, text: 'สินค้าตัวไหนครับ? (ระบุชื่อหรือรหัสสินค้า)' }
      const site = findEntity(text, s.sites)
      const rows = s.balances.filter((b) => b.productId === p.id && (!site || b.siteId === site.id))
      const total = rows.reduce((a, b) => a + b.qty, 0)
      const where = site ? site.name : 'ทุกสาขา'
      return { kind: 'ANSWER', intent, text: `${p.name} (${p.sku}) ที่${where}: ${fmt(total)} ${p.unit}`, facts: { productId: p.id, siteId: site?.id ?? null, qty: total, unit: p.unit } }
    }
    case 'po_unconfirmed': {
      const site = findEntity(text, s.sites)
      const open = s.orders.filter((o) => o.status === 'ordered' && o.supplierConfirmedAt === undefined && (!site || o.locationId === site.id)).sort((a, b) => a.orderedAt - b.orderedAt)
      const list = open.map((o) => `${o.docNo} · ${o.supplierName} · ${siteName(s, o.locationId)}`)
      return { kind: 'ANSWER', intent, text: open.length ? `ใบสั่งซื้อที่ผู้ขายยังไม่ยืนยัน ${open.length} ใบ:\n${list.join('\n')}` : 'ไม่มีใบสั่งซื้อที่รอผู้ขายยืนยัน', facts: { docNos: open.map((o) => o.docNo) } }
    }
    case 'stockout_risk': {
      const days = horizonDays(text)
      const site = findEntity(text, s.sites)
      const risky = s.usage
        .filter((u) => u.perDay > 0 && (!site || u.siteId === site.id))
        .map((u) => {
          const qty = s.balances.find((b) => b.productId === u.productId && b.siteId === u.siteId)?.qty ?? 0
          return { ...u, qty, cover: qty / u.perDay }
        })
        .filter((r) => r.cover < days)
        .sort((a, b) => a.cover - b.cover)
      const name = (id: string) => s.products.find((p) => p.id === id)?.name ?? id
      const list = risky.map((r) => `${name(r.productId)} @ ${siteName(s, r.siteId)}: เหลือ ${fmt(r.cover)} วัน`)
      return { kind: 'ANSWER', intent, text: risky.length ? `เสี่ยงหมดภายใน ${days} วัน ${risky.length} รายการ:\n${list.join('\n')}` : `ไม่มีสินค้าที่เสี่ยงหมดภายใน ${days} วัน`, facts: { days, items: risky.map((r) => ({ productId: r.productId, siteId: r.siteId, cover: Math.round(r.cover * 100) / 100 })) } }
    }
    case 'transfer_status': {
      const site = findEntity(text, s.sites)
      const open = s.transfers.filter((t) => OPEN_TRANSFER.includes(t.status) && (!site || t.fromId === site.id || t.toId === site.id))
      const list = open.map((t) => `${t.docNo} · ${siteName(s, t.fromId)} → ${siteName(s, t.toId)} · ${t.status}`)
      return { kind: 'ANSWER', intent, text: open.length ? `ใบโอนที่ยังไม่ปิด ${open.length} ใบ:\n${list.join('\n')}` : 'ไม่มีใบโอนที่ค้างอยู่', facts: { docNos: open.map((t) => t.docNo) } }
    }
    case 'write_request':
      return { kind: 'REFUSE', reason: 'WRITE', text: 'Ask PZM อ่านข้อมูลได้อย่างเดียว — การสร้างหรือแก้ไขรายการให้ทำที่หน้าจอของระบบ' }
    case 'out_of_scope':
      return { kind: 'REFUSE', reason: 'OUT_OF_SCOPE', text: 'ถามได้เรื่องสต๊อก ใบสั่งซื้อ ความเสี่ยงของหมด และใบโอนครับ' }
  }
}
