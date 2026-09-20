import type { MovementEditField, PurchaseOrder, PurchaseRequest, StockEvent, StockMovement } from '../types'
import { shownUnit } from './ledger'

/**
 * Everything that happened in the system, as one list nobody can edit.
 *
 * Nothing new is stored for this: each record already carries its own signed history —
 * a movement its edits and void, an order its revisions, cancellation and receipt, a
 * request and a task their history entries. This reads them all back into one timeline,
 * newest first, for the screen and the export. The owner's rule (20 Sep 2026): every
 * action in the system must be traceable afterwards, and this list is how.
 *
 * `t` translates; the builder itself keeps no Thai so the export follows the reader.
 */

export type ActivityArea = 'stock' | 'order' | 'request' | 'task'

export interface ActivityEntry {
  /** Stable, for React keys: `${source}:${id}:${n}`. */
  key: string
  at: number
  area: ActivityArea
  /** What kind of thing: receive / issue / adjust / consume / PO / PR / task. */
  kind: string
  docNo: string
  /** What happened, already translated. */
  action: string
  /** The subject: product and quantity, or supplier, or the task's title. */
  subject: string
  /** Old → new, reasons, notes — whatever the record kept. */
  detail: string
  by: string
  /** Where to open the record. */
  link?: string
}

export type TFn = (key: string, params?: Record<string, string | number>) => string

export interface ActivityInput {
  movements: readonly StockMovement[]
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  events: readonly StockEvent[]
  /** Only entries whose moment falls in [from, to]. */
  from: number
  to: number
  locationName: (id?: string) => string
  formatDate: (ms: number) => string
  formatDateTime: (ms: number) => string
  fmtQty: (n: number) => string
  movementType: (type: StockMovement['type']) => string
  /** One movement edit's change as text — see components/movements/labels.ts. */
  editChange: (c: { field: MovementEditField; from: string; to: string }) => string
  requestAction: (action: string) => string
  taskAction: (action: string) => string
  t: TFn
}

export function buildActivityLog(input: ActivityInput): ActivityEntry[] {
  const { from, to, t } = input
  const out: ActivityEntry[] = []
  const inRange = (at: number) => at >= from && at <= to
  const push = (e: ActivityEntry) => {
    if (inRange(e.at)) out.push(e)
  }

  // ---- stock movements: filed, each edit, voided ----
  for (const m of input.movements) {
    const kind = input.movementType(m.type)
    const where =
      m.fromLocationId && m.toLocationId
        ? `${input.locationName(m.fromLocationId)} → ${input.locationName(m.toLocationId)}`
        : input.locationName(m.fromLocationId ?? m.toLocationId)
    const subject = `${m.productName} · ${input.fmtQty(m.qty)} ${shownUnit(m)} · ${where}`
    const link = `/movements?product=${m.productId}`
    push({
      key: `mv:${m.id}:0`,
      at: m.createdAt,
      area: 'stock',
      kind,
      docNo: m.docNo,
      action: t('บันทึกรายการ'),
      subject,
      detail: [m.reason ? t('เหตุผล: {r}', { r: m.reason }) : '', m.note ?? '', t('วันที่เอกสาร {d}', { d: input.formatDate(m.date) })]
        .filter(Boolean)
        .join(' · '),
      by: m.byUserName,
      link,
    })
    ;(m.edits ?? []).forEach((e, i) => {
      const detail = e.changes?.length
        ? e.changes.map((c) => input.editChange(c)).join(' · ')
        : e.changed.map((c) => t(c)).join(', ')
      push({ key: `mv:${m.id}:e${i}`, at: e.at, area: 'stock', kind, docNo: m.docNo, action: t('แก้ไขรายการ'), subject, detail, by: e.byName, link })
    })
    if (m.voided && m.updatedAt) {
      push({ key: `mv:${m.id}:void`, at: m.updatedAt, area: 'stock', kind, docNo: m.docNo, action: t('ยกเลิกรายการ (คืนสต๊อก)'), subject, detail: '', by: m.updatedByName ?? '', link })
    }
  }

  // ---- purchase orders: placed, approved, sent, revised, received, cancelled ----
  for (const o of input.orders) {
    const kind = t('ใบสั่งซื้อ')
    const subject = `${o.supplierName} · ${t('{n} รายการ', { n: o.lines.length })} · ${input.locationName(o.locationId)}`
    const link = `/orders?po=${o.id}`
    const base = { area: 'order' as const, kind, docNo: o.docNo, subject, link }
    push({ ...base, key: `po:${o.id}:0`, at: o.createdAt, action: o.status === 'draft' || o.batchId || o.approvedAt ? t('สร้างร่าง') : t('สั่งซื้อ'), detail: o.requestId ? t('จากรายการขอสั่งซื้อ') : '', by: o.createdByName })
    if (o.approvedAt) push({ ...base, key: `po:${o.id}:ap`, at: o.approvedAt, action: t('อนุมัติและสั่ง'), detail: '', by: o.approvedByName ?? '' })
    if (o.sentAt) push({ ...base, key: `po:${o.id}:sent`, at: o.sentAt, action: t('ส่งเข้า LINE แล้ว'), detail: '', by: o.sentByName ?? '' })
    for (const r of o.revisions ?? []) {
      const detail = r.changes
        .map((c) => {
          switch (c.kind) {
            case 'qty':
              return `${c.productName}: ${input.fmtQty(c.from)} → ${input.fmtQty(c.to)} ${c.unit}`
            case 'add':
              return t('เพิ่ม {name} {qty} {unit}', { name: c.productName, qty: input.fmtQty(c.to), unit: c.unit })
            case 'remove':
              return t('ตัด {name} ({qty} {unit})', { name: c.productName, qty: input.fmtQty(c.from), unit: c.unit })
            case 'expectedAt':
              return t('กำหนดส่ง: {from} → {to}', { from: c.from !== undefined ? input.formatDate(c.from) : '—', to: c.to !== undefined ? input.formatDate(c.to) : '—' })
            case 'note':
              return t('หมายเหตุ: {from} → {to}', { from: c.from ?? '—', to: c.to ?? '—' })
          }
        })
        .join(' · ')
      push({ ...base, key: `po:${o.id}:r${r.rev}`, at: r.at, action: t('แก้ไขใบสั่งซื้อ (Rev.{n})', { n: r.rev }), detail: `${r.reason} — ${detail}`, by: r.byName })
    }
    if (o.status === 'received' && o.receivedAt) {
      const short = o.lines.filter((l) => (l.receivedQty ?? l.orderedQty) !== l.orderedQty)
      push({
        ...base,
        key: `po:${o.id}:rc`,
        at: o.receivedAt,
        action: t('รับของเข้าคลัง'),
        detail: [o.invoiceNo ? t('บิล {no}', { no: o.invoiceNo }) : '', o.movementDocNo ?? '', ...short.map((l) => `${l.productName}: ${input.fmtQty(l.orderedQty)} → ${input.fmtQty(l.receivedQty ?? 0)}${l.note ? ` (${l.note})` : ''}`)]
          .filter(Boolean)
          .join(' · '),
        by: o.receivedByName ?? '',
      })
    }
    if (o.status === 'cancelled' && o.cancelledAt) {
      push({ ...base, key: `po:${o.id}:x`, at: o.cancelledAt, action: t('ยกเลิกใบสั่งซื้อ'), detail: o.cancelReason ?? '', by: o.cancelledByName ?? '' })
    }
  }

  // ---- purchase requests: every history entry ----
  for (const r of input.requests) {
    const kind = t('รายการขอสั่งซื้อ')
    const subject = `${input.locationName(r.locationId)} · ${t('ผู้ขอ')}: ${r.requestedByName}`
    r.history.forEach((h, i) => {
      const detail = [
        h.itemIdx !== undefined ? r.items.find((it) => it.idx === h.itemIdx)?.productName : '',
        h.oldValue !== undefined || h.newValue !== undefined ? `${h.oldValue ?? '—'} → ${h.newValue ?? '—'}` : '',
        h.detail ?? '',
      ]
        .filter(Boolean)
        .join(' · ')
      push({ key: `pr:${r.id}:${i}`, at: h.at, area: 'request', kind, docNo: r.docNo, action: input.requestAction(h.action), subject, detail, by: h.byName, link: `/requests/${r.id}` })
    })
  }

  // ---- tasks: every history entry ----
  for (const e of input.events) {
    const kind = t('งาน')
    const subject = `${e.title}${e.locationId ? ` · ${input.locationName(e.locationId)}` : ''}`
    ;(e.history ?? []).forEach((h, i) => {
      const ms = (v?: string) => (v && /^\d{12,}$/.test(v) ? input.formatDateTime(Number(v)) : v)
      const detail = [h.detail ?? '', h.oldValue !== undefined || h.newValue !== undefined ? `${ms(h.oldValue) ?? '—'} → ${ms(h.newValue) ?? '—'}` : '']
        .filter(Boolean)
        .join(' · ')
      push({ key: `ev:${e.id}:${i}`, at: h.at, area: 'task', kind, docNo: e.id.startsWith('sc__') ? t('ตามตาราง') : '', action: input.taskAction(h.action), subject, detail, by: h.byName, link: `/calendar?item=task__${e.id}` })
    })
  }

  return out.sort((a, b) => b.at - a.at)
}
