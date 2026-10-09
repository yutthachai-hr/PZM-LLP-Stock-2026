import type { Product, PurchaseOrder, StockLocation, StockMovement, Supplier, Transfer } from '../types'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import type { HistoricalData } from './backtest'

/**
 * A seeded, synthetic operating history for the G8 benchmark when no production backup is
 * at hand (this container has none — the real backups live on the owner's machine; run
 * `npm run intel:backtest -- <backup.json>` there).
 *
 * Known ground truth by construction: four suppliers with fixed behaviour (reliable, often
 * late, getting worse half-way, new), five products used daily at two branches with noise,
 * a warehouse that reorders at a reorder point and refills the branches twice a week. Every
 * row is dated and keyed the way the app does it (createdAt = the moment it was keyed, a
 * receipt keyed the day it arrived), so the as-of slices behave as they would on real data.
 * Deterministic: the same seed gives the same history.
 */

export interface SyntheticOptions {
  seed?: number
  days?: number
  start?: number
}

export function syntheticHistory(opts: SyntheticOptions = {}): HistoricalData & { start: number; end: number } {
  let seed = opts.seed ?? 42
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647)
  const days = opts.days ?? 150
  const start = bkkDayStart(opts.start ?? Date.UTC(2026, 3, 1))
  const end = start + days * DAY_MS
  const hour = 3_600_000

  const suppliers: Supplier[] = [
    { id: 'reliable', name: 'RELIABLE CO', leadTimeDays: 2, active: true },
    { id: 'late', name: 'OFTEN LATE CO', leadTimeDays: 3, active: true },
    { id: 'worse', name: 'GETTING WORSE CO', leadTimeDays: 2, active: true },
    { id: 'fresh', name: 'NEW CO', leadTimeDays: 2, active: true },
  ].map((s) => ({ contactNumber: '', email: '', type: 'takingReturn', createdAt: start, updatedAt: start, ...s }) as Supplier)
  // [on-time probability, max delay days] — 'worse' switches half-way.
  const behaviour = (id: string, at: number): [number, number] =>
    id === 'reliable' ? [0.95, 1] : id === 'late' ? [0.45, 4] : id === 'worse' ? (at < start + (days / 2) * DAY_MS ? [0.95, 1] : [0.3, 4]) : [0.8, 2]

  const locations: StockLocation[] = [
    { id: 'wh', name: 'WAREHOUSE', type: 'warehouse', active: true, createdAt: start },
    { id: 'b1', name: 'BRANCH 1', type: 'branch', active: true, createdAt: start },
    { id: 'b2', name: 'BRANCH 2', type: 'branch', active: true, createdAt: start },
  ]
  const specs: { id: string; supplier: string; use: [number, number]; min: number }[] = [
    { id: 'flour', supplier: 'reliable', use: [6, 4], min: 20 },
    { id: 'cheese', supplier: 'late', use: [4, 3], min: 15 },
    { id: 'tomato', supplier: 'worse', use: [5, 5], min: 20 },
    { id: 'olive', supplier: 'fresh', use: [1, 1], min: 5 },
    { id: 'box', supplier: 'late', use: [10, 8], min: 40 },
  ]
  const products: Product[] = specs.map((s) => ({ id: s.id, sku: s.id.toUpperCase(), name: s.id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: s.min, hasImage: false, active: true, supplierId: s.supplier, createdAt: start, updatedAt: start }) as Product)

  const movements: StockMovement[] = []
  const orders: PurchaseOrder[] = []
  const transfers: Transfer[] = []
  const stock = new Map<string, number>()
  const k = (l: string, p: string) => `${l}:${p}`
  let n = 0
  const move = (m: Omit<StockMovement, 'id' | 'docNo' | 'productName' | 'unit' | 'byUserId' | 'byUserName'>) => {
    n++
    movements.push({ id: `m${n}`, docNo: `D-${n}`, productName: m.productId.toUpperCase(), unit: 'KG', byUserId: 'u', byUserName: 'U', ...m } as StockMovement)
    if (m.toLocationId) stock.set(k(m.toLocationId, m.productId), (stock.get(k(m.toLocationId, m.productId)) ?? 0) + m.qty)
    if (m.fromLocationId) stock.set(k(m.fromLocationId, m.productId), (stock.get(k(m.fromLocationId, m.productId)) ?? 0) - m.qty)
  }
  // Opening stock.
  for (const s of specs) {
    move({ type: 'receive', productId: s.id, qty: s.min * 4, toLocationId: 'wh', date: start, createdAt: start })
    for (const b of ['b1', 'b2']) move({ type: 'receive', productId: s.id, qty: s.min, toLocationId: b, date: start, createdAt: start })
  }
  const pending: { po: PurchaseOrder; arrive: number }[] = []
  let poN = 0
  let trN = 0
  for (let d = 1; d < days; d++) {
    const day = start + d * DAY_MS
    // Deliveries that land today, keyed at 10:00.
    for (const p of pending.filter((x) => x.arrive === day)) {
      const qty = p.po.lines[0].orderedQty
      move({ type: 'receive', productId: p.po.lines[0].productId, qty, toLocationId: 'wh', date: day, createdAt: day + 3 * hour, poId: p.po.id } as never)
      p.po.lines[0].receivedQty = qty
      p.po.status = 'received'
      p.po.receipts = [{ docNo: `RC-${p.po.id}`, date: day, invoiceNo: 'i', byId: 'u', byName: 'U', lines: [{ productId: p.po.lines[0].productId, qty }] }]
      p.po.receivedAt = day + 3 * hour
    }
    // The branches use, through the day (keyed in the evening). A branch can only use what it has.
    for (const s of specs) {
      for (const b of ['b1', 'b2']) {
        const want = Math.max(0, Math.round(s.use[0] + (rnd() - 0.5) * 2 * s.use[1]))
        const have = stock.get(k(b, s.id)) ?? 0
        const qty = Math.min(want, Math.max(0, have))
        if (qty > 0) move({ type: 'consume', productId: s.id, qty, fromLocationId: b, date: day, createdAt: day + 12 * hour })
      }
    }
    // Twice a week the warehouse tops the branches up to 3× their minimum, from what it has.
    if (d % 3 === 0) {
      for (const s of specs) {
        for (const b of ['b1', 'b2']) {
          const need = s.min * 3 - (stock.get(k(b, s.id)) ?? 0)
          const give = Math.min(need, Math.max(0, stock.get(k('wh', s.id)) ?? 0))
          if (give <= 0) continue
          trN++
          const at = day + 2 * hour
          transfers.push({ id: `t${trN}`, docNo: `TR-${trN}`, status: 'completed', revision: 1, fromLocationId: 'wh', toLocationId: b, dispatchDate: day, requestedBy: 'u', requestedByName: 'U', submittedAt: at, approvedAt: at, receivedAt: at + 4 * hour, items: [{ idx: 0, productId: s.id, productName: s.id.toUpperCase(), sku: s.id, unit: 'KG', requestedQty: give, dispatchQty: give }], history: [], createdAt: at, updatedAt: at } as Transfer)
          move({ type: 'issue', productId: s.id, qty: give, fromLocationId: 'wh', toLocationId: b, date: day, createdAt: at + 4 * hour, transferId: `t${trN}` } as never)
        }
      }
    }
    // The warehouse reorders at its reorder point, once nothing is already on order.
    for (const s of specs) {
      const onOrder = pending.some((x) => x.po.status === 'ordered' && x.po.lines[0].productId === s.id)
      if (onOrder || (stock.get(k('wh', s.id)) ?? 0) > s.min * 2) continue
      const sup = suppliers.find((x) => x.id === s.supplier)!
      const [onTime, maxDelay] = behaviour(sup.id, day)
      const due = day + sup.leadTimeDays! * DAY_MS
      const late = rnd() > onTime ? 1 + Math.floor(rnd() * maxDelay) : 0
      poN++
      const po: PurchaseOrder = {
        id: `po${poN}`, docNo: `PO-${poN}`, supplierId: sup.id, supplierName: sup.name, status: 'ordered', locationId: 'wh', orderedAt: day + hour, expectedAt: due,
        lines: [{ productId: s.id, productName: s.id.toUpperCase(), unit: 'KG', orderedQty: s.min * 4 }],
        createdBy: 'u', createdByName: 'U', createdAt: day + hour, updatedAt: day + hour,
      }
      orders.push(po)
      pending.push({ po, arrive: Math.min(end - DAY_MS, due + late * DAY_MS) })
    }
  }
  return { products, locations, suppliers, orders, transfers, movements, start, end }
}
