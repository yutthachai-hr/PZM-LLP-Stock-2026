import type { MonthlyCount, Product, PurchaseOrder, StockMovement } from '../types'
import { isBig } from '../lib/monthlyCount'
import { LOSS_REASONS } from '../lib/inventoryRules/usage'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { isLegacyUnitRow } from '../lib/uom'
import { meta, round3, type IntelMeta, type Reason } from './meta'
import type { SupplierIntel } from './supplier'

/**
 * G6 — Anomalies, deterministic and explainable. No model, no LLM.
 *
 * Each finding says what changed, the normal (reference) range it was judged against, the
 * observed value, why that crossed the line, which entity, and how severe. "Normal" is
 * robust statistics on the entity's own history — median and MAD (median absolute
 * deviation), so one past spike does not widen the band for ever — with an absolute floor
 * so a product used twice a week does not alarm on a third use.
 *
 * Time-correct: only records created by `asOf` are looked at (the backtest relies on it).
 */

export type AnomalyKind =
  | 'unusualConsumption'
  | 'largeAdjustment'
  | 'receivingVariance'
  | 'priceSpike'
  | 'countVariance'
  | 'supplierDeterioration'
  | 'duplicateOperation'

export type AnomalySeverity = 'low' | 'medium' | 'high'

export interface Anomaly {
  id: string
  kind: AnomalyKind
  severity: AnomalySeverity
  entity: { type: 'product' | 'supplier' | 'movement' | 'purchaseOrder' | 'monthlyCount'; id: string; name: string; locationId?: string }
  /** What changed, in words the screen fills from `why.params`. */
  why: Reason
  observed: number
  reference: { low: number | null; high: number | null; median: number | null; basis: string }
  at: number
}

export interface AnomalyReport {
  meta: IntelMeta
  anomalies: Anomaly[]
}

export const ANOMALY_CONFIG = {
  baselineDays: 28,
  recentDays: 7,
  minBaselineDays: 14,
  minActiveDays: 5,
  robustZ: 3.5,
  highZ: 6,
  /** An unusual day must also be at least this much above the median, absolutely. */
  minExcess: 2,
  adjustmentDaysOfUse: 5,
  receivingTolerance: 0.2,
  rejectShare: 0.1,
  priceRise: 0.2,
  priceDrop: 0.3,
  priceHigh: 0.5,
  deteriorationDrop: 0.2,
  deteriorationMinSample: 5,
  duplicateWindowMs: 10 * 60_000,
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median and MAD scaled to a normal σ (×1.4826). */
export function robust(xs: readonly number[]): { median: number; sigma: number } | null {
  const m = median(xs)
  if (m === null) return null
  const mad = median(xs.map((x) => Math.abs(x - m))) ?? 0
  return { median: m, sigma: mad * 1.4826 }
}

export interface AnomalyInput {
  movements: readonly StockMovement[]
  products: readonly Product[]
  orders: readonly PurchaseOrder[]
  counts: readonly MonthlyCount[]
  supplierIntel?: ReadonlyMap<string, SupplierIntel>
  now: number
  asOf?: number
}

const known = (asOf: number) => (m: { createdAt: number }) => m.createdAt <= asOf

export function detectAnomalies(input: AnomalyInput): AnomalyReport {
  const asOf = input.asOf ?? input.now
  const C = ANOMALY_CONFIG
  const moves = input.movements.filter((m) => !m.voided && !isLegacyUnitRow(m) && known(asOf)(m) && m.date <= asOf)
  const productName = (id: string) => input.products.find((p) => p.id === id)?.name ?? id
  const out: Anomaly[] = []
  const today = bkkDayStart(asOf)

  // ---- unusual consumption: a recent day far above this product's usual day, here ----
  const usedByDay = new Map<string, Map<number, number>>()
  for (const m of moves) {
    if (!m.fromLocationId) continue
    const use = m.type === 'issue' || m.type === 'consume' || (m.type === 'adjust' && (LOSS_REASONS as readonly string[]).includes(m.reason ?? ''))
    if (!use) continue
    const k = `${m.productId}__${m.fromLocationId}`
    const days = usedByDay.get(k) ?? new Map<number, number>()
    const d = bkkDayStart(m.date)
    days.set(d, (days.get(d) ?? 0) + m.qty)
    usedByDay.set(k, days)
  }
  for (const [k, days] of usedByDay) {
    const [productId, locationId] = k.split('__')
    const recentFrom = today - (C.recentDays - 1) * DAY_MS
    const baseFrom = recentFrom - C.baselineDays * DAY_MS
    const firstDay = Math.min(...days.keys())
    if (firstDay > recentFrom - C.minBaselineDays * DAY_MS) continue
    const baseline: number[] = []
    for (let d = Math.max(baseFrom, firstDay); d < recentFrom; d += DAY_MS) baseline.push(days.get(d) ?? 0)
    if (baseline.filter((x) => x > 0).length < C.minActiveDays) continue
    const r = robust(baseline)
    if (!r) continue
    const sigma = Math.max(r.sigma, 0.5)
    for (let d = recentFrom; d <= today; d += DAY_MS) {
      const x = days.get(d) ?? 0
      const z = (x - r.median) / sigma
      if (z < C.robustZ || x - r.median < Math.max(C.minExcess, r.median * 0.5)) continue
      out.push({
        id: `unusualConsumption__${k}__${d}`,
        kind: 'unusualConsumption',
        severity: z >= C.highZ ? 'high' : 'medium',
        entity: { type: 'product', id: productId, name: productName(productId), locationId },
        why: { code: 'anomaly.unusualConsumption', params: { observed: round3(x), median: round3(r.median), high: round3(r.median + C.robustZ * sigma), z: Math.round(z * 10) / 10, days: baseline.length } },
        observed: round3(x),
        reference: { low: 0, high: round3(r.median + C.robustZ * sigma), median: round3(r.median), basis: `median ± ${C.robustZ}·MAD over ${baseline.length} days` },
        at: d,
      })
    }
  }

  // ---- large adjustments: bigger than days of this product's use, or its usual adjustment ----
  const adjustments = moves.filter((m) => m.type === 'adjust')
  for (const m of adjustments.filter((a) => a.date >= today - C.recentDays * DAY_MS)) {
    const loc = m.fromLocationId ?? m.toLocationId ?? ''
    const days = usedByDay.get(`${m.productId}__${loc}`)
    const used = days ? [...days.entries()].filter(([d]) => d < bkkDayStart(m.date) && d >= bkkDayStart(m.date) - C.baselineDays * DAY_MS).reduce((s, [, q]) => s + q, 0) : 0
    const perDay = used / C.baselineDays
    const past = adjustments.filter((a) => a.productId === m.productId && a.id !== m.id && a.date < m.date).map((a) => a.qty)
    const r = past.length >= 3 ? robust(past) : null
    const byUse = perDay > 0 ? m.qty / perDay : null
    const highRef = Math.max(perDay * C.adjustmentDaysOfUse, r ? r.median + C.robustZ * Math.max(r.sigma, 1) : 0)
    if (!(highRef > 0) || m.qty <= highRef) continue
    out.push({
      id: `largeAdjustment__${m.id}`,
      kind: 'largeAdjustment',
      severity: byUse !== null && byUse >= C.adjustmentDaysOfUse * 2 ? 'high' : 'medium',
      entity: { type: 'movement', id: m.id, name: `${m.docNo} · ${m.productName}`, locationId: loc },
      why: { code: 'anomaly.largeAdjustment', params: { qty: m.qty, unit: m.unit, high: round3(highRef), daysOfUse: byUse === null ? '—' : Math.round(byUse * 10) / 10, docNo: m.docNo } },
      observed: m.qty,
      reference: { low: null, high: round3(highRef), median: r ? round3(r.median) : null, basis: `${C.adjustmentDaysOfUse} days of use, or median ± ${C.robustZ}·MAD of past adjustments` },
      at: m.date,
    })
  }

  // ---- receiving variance: a delivery far from what was owed, or much refused ----
  for (const o of input.orders) {
    for (const rc of o.receipts ?? []) {
      if (rc.date > asOf || rc.date < today - C.recentDays * DAY_MS) continue
      for (const l of rc.lines) {
        const line = o.lines.find((x) => x.productId === l.productId)
        if (!line || !(line.orderedQty > 0)) continue
        // Receipt lines are in the order line's own unit, like orderedQty.
        const got = l.qty
        const rejected = l.rejectedQty ?? 0
        const share = got + rejected > 0 ? rejected / (got + rejected) : 0
        const off = (got - line.orderedQty) / line.orderedQty
        if (share < C.rejectShare && off <= C.receivingTolerance) continue
        out.push({
          id: `receivingVariance__${o.id}__${rc.receiptId ?? rc.docNo}__${l.productId}`,
          kind: 'receivingVariance',
          severity: share >= 0.3 || off > 0.5 ? 'high' : 'medium',
          entity: { type: 'purchaseOrder', id: o.id, name: `${o.docNo} · ${line.productName}`, locationId: o.locationId },
          why: { code: share >= C.rejectShare ? 'anomaly.rejected' : 'anomaly.overReceived', params: { docNo: o.docNo, received: got, rejected, ordered: line.orderedQty, pct: Math.round((share >= C.rejectShare ? share : off) * 100) } },
          observed: share >= C.rejectShare ? round3(share) : round3(off),
          reference: { low: null, high: share >= C.rejectShare ? C.rejectShare : C.receivingTolerance, median: null, basis: share >= C.rejectShare ? 'share refused at the door' : 'received over ordered' },
          at: rc.date,
        })
      }
    }
  }

  // ---- price spikes: the latest price against the product's earlier ones ----
  for (const p of input.products) {
    const hist = (p.costHistory ?? []).filter((e) => e.at <= asOf).sort((a, b) => a.effectiveAt - b.effectiveAt)
    if (hist.length < 4) continue
    const last = hist[hist.length - 1]
    if (last.effectiveAt < today - C.baselineDays * DAY_MS) continue
    const ref = median(hist.slice(0, -1).slice(-6).map((e) => e.cost))
    if (!ref) continue
    const change = (last.cost - ref) / ref
    if (change < C.priceRise && change > -C.priceDrop) continue
    out.push({
      id: `priceSpike__${p.id}__${last.effectiveAt}`,
      kind: 'priceSpike',
      severity: Math.abs(change) >= C.priceHigh ? 'high' : 'medium',
      entity: { type: 'product', id: p.id, name: p.name },
      why: { code: change > 0 ? 'anomaly.priceRise' : 'anomaly.priceDrop', params: { cost: round3(last.cost), median: round3(ref), pct: Math.round(change * 100) } },
      observed: round3(last.cost),
      reference: { low: round3(ref * (1 - C.priceDrop)), high: round3(ref * (1 + C.priceRise)), median: round3(ref), basis: 'median of the last 6 earlier prices' },
      at: last.effectiveAt,
    })
  }

  // ---- count variance: a big difference that repeats in the same direction ----
  const posted = input.counts.filter((c) => c.confirmedAt !== undefined && c.confirmedAt <= asOf && c.results).sort((a, b) => a.month.localeCompare(b.month))
  for (let i = 0; i < posted.length; i++) {
    const c = posted[i]
    if ((c.confirmedAt ?? 0) < today - 40 * DAY_MS) continue
    const prev = posted.slice(0, i).reverse().find((x) => x.locationId === c.locationId)
    for (const [pid, r] of Object.entries(c.results ?? {})) {
      if (!isBig(r.systemQty, r.diff, r.value)) continue
      const before = prev?.results?.[pid]
      const repeats = !!before && Math.sign(before.diff) === Math.sign(r.diff) && isBig(before.systemQty, before.diff, before.value)
      out.push({
        id: `countVariance__${c.id}__${pid}`,
        kind: 'countVariance',
        severity: repeats ? 'high' : 'low',
        entity: { type: 'product', id: pid, name: productName(pid), locationId: c.locationId },
        why: { code: repeats ? 'anomaly.countVarianceRepeats' : 'anomaly.countVariance', params: { diff: r.diff, system: r.systemQty, value: r.value, month: c.month, prevDiff: before?.diff ?? '—' } },
        observed: r.diff,
        reference: { low: round3(-Math.max(r.systemQty * 0.1, 0)), high: round3(Math.max(r.systemQty * 0.1, 0)), median: 0, basis: 'within 10% of the books and under 500 baht' },
        at: c.countDate,
      })
    }
  }

  // ---- supplier deterioration: on-time rate fell sharply, on enough deliveries ----
  for (const s of input.supplierIntel?.values() ?? []) {
    const { recent, previous } = s.stats.trend
    if (recent.rate === null || previous.rate === null) continue
    if (recent.n < C.deteriorationMinSample || previous.n < C.deteriorationMinSample) continue
    const drop = previous.rate - recent.rate
    if (drop < C.deteriorationDrop) continue
    out.push({
      id: `supplierDeterioration__${s.supplierId}`,
      kind: 'supplierDeterioration',
      severity: drop >= 0.35 ? 'high' : 'medium',
      entity: { type: 'supplier', id: s.supplierId, name: s.supplierName },
      why: { code: 'anomaly.supplierDeterioration', params: { recent: Math.round(recent.rate * 100), previous: Math.round(previous.rate * 100), n: recent.n, m: previous.n } },
      observed: round3(recent.rate),
      reference: { low: round3(previous.rate - C.deteriorationDrop), high: null, median: round3(previous.rate), basis: 'on-time rate of the 30 days before' },
      at: asOf,
    })
  }

  // ---- suspicious duplicates: the same operation twice, minutes apart, separate documents ----
  const recent = moves.filter((m) => m.createdAt >= asOf - C.recentDays * DAY_MS).sort((a, b) => a.createdAt - b.createdAt)
  for (let i = 0; i < recent.length; i++) {
    const a = recent[i]
    for (let j = i + 1; j < recent.length && recent[j].createdAt - a.createdAt <= C.duplicateWindowMs; j++) {
      const b = recent[j]
      if (a.docNo === b.docNo || a.type !== b.type || a.productId !== b.productId || a.qty !== b.qty) continue
      if (a.fromLocationId !== b.fromLocationId || a.toLocationId !== b.toLocationId || a.byUserId !== b.byUserId) continue
      out.push({
        id: `duplicateOperation__${a.id}__${b.id}`,
        kind: 'duplicateOperation',
        severity: a.type === 'receive' || a.type === 'adjust' ? 'high' : 'medium',
        entity: { type: 'movement', id: b.id, name: `${a.docNo} / ${b.docNo} · ${a.productName}`, locationId: a.toLocationId ?? a.fromLocationId },
        why: { code: 'anomaly.duplicate', params: { first: a.docNo, second: b.docNo, qty: a.qty, unit: a.unit, minutes: Math.round((b.createdAt - a.createdAt) / 60_000), by: a.byUserName } },
        observed: Math.round((b.createdAt - a.createdAt) / 60_000),
        reference: { low: Math.round(C.duplicateWindowMs / 60_000), high: null, median: null, basis: 'same type, product, quantity, place and person within 10 minutes' },
        at: b.date,
      })
    }
  }

  const rank: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 }
  return {
    meta: meta('anomaly', input, []),
    anomalies: out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.at - x.at),
  }
}
