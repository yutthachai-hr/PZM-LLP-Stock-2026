import type { AppUser, Role } from '../../src/types'
import { guard, horizonDays, keywordRoute } from '../../src/agent/ask/guard'
import type { AskIntent, IntentVerdict } from '../../src/agent/ask/intents'
import { levelId } from '../../src/lib/levelKey'
import { usageAt, usageIndex } from '../../src/lib/inventoryRules/usage'
import { expectedDeliveryAt, remainingBaseQty } from '../../src/lib/inventoryRules/purchasing'
import { brandCollection, SERVER_BRANDS, type QueryFilter, type ServerBrand, type ServerStore } from './serverStore'

/**
 * Ask PZM, server side (owner approval 4, 9 Oct 2026): read-only answers about stock, purchase
 * orders awaiting supplier confirmation, and one product's stockout risk.
 *
 *   POST /api/ask   { brand, text, hints?: { productId?, siteId? } }
 *
 * Who: an active, unrevoked user, from `users/{uid}` (never the request). Role from that record.
 * Sites: the record's `siteIds` (empty = all, as everywhere in the app). Brand: one namespace
 * per answer; the request picks it, and — as in the rules — every active user may read every
 * brand (there is no per-user brand membership in the data model; adding one is an owner call).
 *
 * What: deterministic guard first (DENY final), then the keyword router, then — only if that is
 * unsure and a gateway is configured — a model picks a LABEL. Every figure comes from Firestore
 * through capped reads; ids from the client or a model are resolved against the database before
 * use. Nothing here writes: the store this module receives is wrapped read-only.
 */

export const ASK_LIMITS = {
  textMax: 300,
  /** Hard caps on documents read per tool call (Firestore bills per document). */
  levelsPerProduct: 50,
  openOrders: 100,
  movementsPerProductSite: 400,
  ordersPerSite: 50,
  /** Usage window for the stockout explanation, as the app's own usage index. */
  usageWindowDays: 28,
  /** Per user per isolate: soft. The hard limit is a Cloudflare WAF rate rule (runbook). */
  ratePerWindow: 20,
  rateWindowMs: 5 * 60_000,
  /** The whole request, model call included. */
  deadlineMs: 6000,
}

export const ASK_ROLES: readonly Role[] = ['admin', 'manager', 'staff']

export interface AskDeps {
  store: ServerStore
  verifyUser: (authorization: string | null) => Promise<string | null>
  now: () => number
  /** Model routing through the gateway; null = no model (the pilot works without one). */
  classify: ((text: string) => Promise<IntentVerdict>) | null
  /** Per-isolate rate limiter; injected so tests control it. */
  limiter: RateLimiter
}

export interface AskReply {
  status: number
  body: Record<string, unknown>
}

export type Source = { collection: string; ids: string[] }

/** Wraps a store so only reads are possible, and counts every document read. */
export function readOnlyCounting(store: ServerStore) {
  let reads = 0
  const ro: ServerStore = {
    get: async (c, id) => {
      reads++ // a missing document is still a billed read
      return store.get(c, id)
    },
    query: async <T,>(c: string, f: readonly QueryFilter[], limit?: number) => {
      const rows = await store.query<T>(c, f, limit)
      reads += Math.max(1, rows.length) // an empty result bills one read
      return rows
    },
    patchIf: async () => {
      throw new Error('ask: read-only')
    },
    create: async () => {
      throw new Error('ask: read-only')
    },
    commit: async () => {
      throw new Error('ask: read-only')
    },
  }
  return { store: ro, reads: () => reads }
}

export class RateLimiter {
  private hits = new Map<string, number[]>()
  private max: number
  private windowMs: number
  constructor(max = ASK_LIMITS.ratePerWindow, windowMs = ASK_LIMITS.rateWindowMs) {
    this.max = max
    this.windowMs = windowMs
  }
  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/
const SKU = /\b([A-Z]{2,4}-\d{3,5})\b/i
const fail = (status: number, error: string): AskReply => ({ status, body: { error } })

interface Product {
  id: string
  name: string
  sku?: string
  unit?: string
  unitType?: string
}
interface Location {
  id: string
  name: string
}

interface Ctx {
  store: ServerStore
  brand: ServerBrand
  user: AppUser
  now: number
  sources: Source[]
  uncertainty: string[]
  freshest: number
}

const col = (c: Ctx, name: string) => brandCollection(c.brand, name)
const src = (c: Ctx, collection: string, ids: string[]) => ids.length && c.sources.push({ collection, ids: ids.slice(0, 20) })
const fresh = (c: Ctx, at: unknown) => typeof at === 'number' && at > c.freshest && (c.freshest = at)
/** The sites this user may see; null = all. */
const scope = (u: AppUser) => (u.siteIds && u.siteIds.length ? u.siteIds : null)
const inScope = (u: AppUser, siteId: string) => !scope(u) || scope(u)!.includes(siteId)
const r2 = (n: number) => Math.round(n * 100) / 100

/** A product id from the client or the text, resolved against the database. Never trusted as-is. */
async function resolveProduct(c: Ctx, text: string, hint?: string): Promise<Product | null> {
  if (hint) {
    const p = (await c.store.get<Product>(col(c, 'products'), hint))?.doc
    if (p) {
      src(c, col(c, 'products'), [hint])
      return { ...p, id: hint }
    }
    c.uncertainty.push('product_hint_not_found')
    return null
  }
  const m = text.match(SKU)
  if (!m) return null
  const rows = await c.store.query<Product>(col(c, 'products'), [{ field: 'sku', op: '==', value: m[1].toUpperCase() }], 2)
  if (rows.length !== 1) return null
  src(c, col(c, 'products'), [rows[0].id])
  return rows[0]
}

async function resolveSite(c: Ctx, hint?: string): Promise<Location | null | 'out_of_scope'> {
  if (!hint) return null
  const l = (await c.store.get<Location>(col(c, 'locations'), hint))?.doc
  if (!l) {
    c.uncertainty.push('site_hint_not_found')
    return null
  }
  if (!inScope(c.user, hint)) return 'out_of_scope'
  src(c, col(c, 'locations'), [hint])
  return { ...l, id: hint }
}

type Answer = { kind: 'ANSWER' | 'CLARIFY' | 'REFUSE'; intent: AskIntent | null; text: string; facts?: Record<string, unknown>; reason?: string }

async function stockLookup(c: Ctx, text: string, hints: Hints): Promise<Answer> {
  const p = await resolveProduct(c, text, hints.productId)
  if (!p) return { kind: 'CLARIFY', intent: 'stock_lookup', text: 'เลือกสินค้าที่ต้องการดูก่อนครับ', reason: 'product' }
  const site = await resolveSite(c, hints.siteId)
  if (site === 'out_of_scope') return { kind: 'REFUSE', intent: 'stock_lookup', text: 'สาขานี้ไม่อยู่ในสิทธิ์ของคุณ', reason: 'site_scope' }
  const unit = p.unitType || p.unit || ''
  let rows: { locationId: string; qty: number; updatedAt?: number; id: string }[]
  if (site) {
    const id = levelId(site.id, p.id)
    const l = (await c.store.get<{ locationId: string; qty: number; updatedAt?: number }>(col(c, 'stockLevels'), id))?.doc
    rows = l ? [{ ...l, id }] : []
  } else {
    rows = await c.store.query(col(c, 'stockLevels'), [{ field: 'productId', op: '==', value: p.id }], ASK_LIMITS.levelsPerProduct)
    if (rows.length >= ASK_LIMITS.levelsPerProduct) c.uncertainty.push('levels_capped')
    // Base balances only: a legacy "#unit" balance is another unit and is not added in.
    rows = rows.filter((r) => !r.id.includes('#') && inScope(c.user, r.locationId))
  }
  rows.forEach((r) => fresh(c, r.updatedAt))
  src(c, col(c, 'stockLevels'), rows.map((r) => r.id))
  const total = rows.reduce((a, r) => a + (r.qty ?? 0), 0)
  const where = site ? site.name : scope(c.user) ? 'สาขาในสิทธิ์ของคุณ' : 'ทุกสาขา'
  return { kind: 'ANSWER', intent: 'stock_lookup', text: `${p.name}${p.sku ? ` (${p.sku})` : ''} ที่${where}: ${r2(total)} ${unit}`, facts: { productId: p.id, siteId: site?.id ?? null, qty: r2(total), unit, bySite: rows.map((r) => ({ siteId: r.locationId, qty: r2(r.qty) })) } }
}

async function poUnconfirmed(c: Ctx, hints: Hints): Promise<Answer> {
  const site = await resolveSite(c, hints.siteId)
  if (site === 'out_of_scope') return { kind: 'REFUSE', intent: 'po_unconfirmed', text: 'สาขานี้ไม่อยู่ในสิทธิ์ของคุณ', reason: 'site_scope' }
  const f: QueryFilter[] = [{ field: 'status', op: '==', value: 'ordered' }, ...(site ? [{ field: 'locationId', op: '==' as const, value: site.id }] : [])]
  const open = await c.store.query<{ id: string; docNo: string; supplierName: string; locationId: string; orderedAt: number; supplierConfirmedAt?: number; updatedAt?: number }>(col(c, 'purchaseOrders'), f, ASK_LIMITS.openOrders)
  if (open.length >= ASK_LIMITS.openOrders) c.uncertainty.push('orders_capped')
  const waiting = open.filter((o) => o.supplierConfirmedAt === undefined && inScope(c.user, o.locationId)).sort((a, b) => a.orderedAt - b.orderedAt)
  open.forEach((o) => fresh(c, o.updatedAt))
  src(c, col(c, 'purchaseOrders'), waiting.map((o) => o.id))
  const days = (t: number) => Math.max(0, Math.floor((c.now - t) / 86_400_000))
  return {
    kind: 'ANSWER',
    intent: 'po_unconfirmed',
    text: waiting.length ? `ใบสั่งซื้อที่ผู้ขายยังไม่ยืนยัน ${waiting.length} ใบ` : 'ไม่มีใบสั่งซื้อที่รอผู้ขายยืนยัน',
    facts: { orders: waiting.slice(0, 30).map((o) => ({ id: o.id, docNo: o.docNo, supplierName: o.supplierName, siteId: o.locationId, daysWaiting: days(o.orderedAt) })), total: waiting.length },
  }
}

async function stockoutRisk(c: Ctx, text: string, hints: Hints): Promise<Answer> {
  const p = await resolveProduct(c, text, hints.productId)
  const site = await resolveSite(c, hints.siteId)
  if (site === 'out_of_scope') return { kind: 'REFUSE', intent: 'stockout_risk', text: 'สาขานี้ไม่อยู่ในสิทธิ์ของคุณ', reason: 'site_scope' }
  // Maximum query scope: one product at one site. The brand-wide view already exists in the app.
  if (!p || !site) return { kind: 'CLARIFY', intent: 'stockout_risk', text: 'ระบุสินค้าและสาขาครับ — ภาพรวมทุกรายการดูได้ที่หน้า "ความเสี่ยงของขาด" ในแอป', reason: !p ? 'product' : 'site' }
  const days = horizonDays(text)
  const lid = levelId(site.id, p.id)
  const level = (await c.store.get<{ qty: number; updatedAt?: number }>(col(c, 'stockLevels'), lid))?.doc
  const onHand = level?.qty ?? 0
  fresh(c, level?.updatedAt)
  src(c, col(c, 'stockLevels'), level ? [lid] : [])
  // Outgoing rows only (two equalities: no composite index). Usage is what leaves a site; the
  // history window then starts at the first outgoing row, not the first receipt, so a young
  // series reads slightly HIGHER usage than the app's own index — the cautious direction.
  const moves = await c.store.query<Parameters<typeof usageIndex>[0][number]>(col(c, 'stockMovements'), [{ field: 'productId', op: '==', value: p.id }, { field: 'fromLocationId', op: '==', value: site.id }], ASK_LIMITS.movementsPerProductSite)
  if (moves.length >= ASK_LIMITS.movementsPerProductSite) c.uncertainty.push('history_capped')
  const usage = usageAt(usageIndex(moves, c.now, ASK_LIMITS.usageWindowDays), site.id, p.id)
  const perDay = usage?.avgDaily ?? null
  if (perDay === null) c.uncertainty.push('too_little_history')
  const orders = await c.store.query<{ id: string; docNo: string; supplierName: string; orderedAt: number; expectedAt?: number; lines: Parameters<typeof remainingBaseQty>[0] & { productId: string }[] }>(col(c, 'purchaseOrders'), [{ field: 'status', op: '==', value: 'ordered' }, { field: 'locationId', op: '==', value: site.id }], ASK_LIMITS.ordersPerSite)
  const incoming = orders.flatMap((o) =>
    (o.lines as unknown as ({ productId: string } & Parameters<typeof remainingBaseQty>[0])[])
      .filter((l) => l.productId === p.id)
      .map((l) => ({ poId: o.id, docNo: o.docNo, supplierName: o.supplierName, qty: r2(remainingBaseQty(l).qty), expectedAt: expectedDeliveryAt(o) ?? null })),
  ).filter((x) => x.qty > 0)
  src(c, col(c, 'purchaseOrders'), incoming.map((x) => x.poId))
  const cover = perDay && perDay > 0 ? onHand / perDay : null
  const atRisk = cover !== null && cover < days
  const unit = p.unitType || p.unit || ''
  const parts = [`${p.name} ที่${site.name}: คงเหลือ ${r2(onHand)} ${unit}`]
  if (perDay !== null) parts.push(`ใช้เฉลี่ย ${r2(perDay)} ${unit}/วัน (${ASK_LIMITS.usageWindowDays} วันล่าสุด) → พอใช้ประมาณ ${r2(cover ?? 0)} วัน`)
  else parts.push('ประวัติการใช้น้อยเกินไปที่จะคำนวณอัตราการใช้')
  parts.push(incoming.length ? `กำลังมา: ${incoming.map((x) => `${x.docNo} ${x.qty} ${unit}`).join(', ')}` : 'ไม่มีใบสั่งซื้อที่ค้างรับสำหรับสินค้านี้')
  parts.push(perDay === null ? 'ประเมินความเสี่ยงไม่ได้' : atRisk ? `เสี่ยงหมดภายใน ${days} วัน` : `ไม่เสี่ยงหมดภายใน ${days} วัน`)
  return { kind: 'ANSWER', intent: 'stockout_risk', text: parts.join('\n'), facts: { productId: p.id, siteId: site.id, onHand: r2(onHand), perDay: perDay === null ? null : r2(perDay), coverDays: cover === null ? null : r2(cover), horizonDays: days, atRisk: perDay === null ? null : atRisk, incoming, movementsRead: moves.length } }
}

interface Hints {
  productId?: string
  siteId?: string
}

async function caller(deps: AskDeps, store: ServerStore, authorization: string | null): Promise<AppUser | null> {
  const uid = await deps.verifyUser(authorization)
  if (!uid) return null
  if (await store.get('revokedUsers', uid)) return null
  const user = (await store.get<AppUser>('users', uid))?.doc
  return user && user.active === true ? { ...user, id: uid } : null
}

export async function runAsk(deps: AskDeps, authorization: string | null, body: unknown): Promise<AskReply> {
  const t0 = deps.now()
  const counted = readOnlyCounting(deps.store)
  const b = (body ?? {}) as Record<string, unknown>
  if (!SERVER_BRANDS.includes(b.brand as ServerBrand)) return fail(400, 'bad_request')
  if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > ASK_LIMITS.textMax) return fail(400, 'bad_request')
  const h = (b.hints ?? {}) as Record<string, unknown>
  const hints: Hints = {}
  for (const k of ['productId', 'siteId'] as const) {
    if (h[k] === undefined) continue
    if (typeof h[k] !== 'string' || !ID.test(h[k] as string)) return fail(400, 'bad_request')
    hints[k] = h[k] as string
  }
  // Anything else in the body (a role, a uid, a site list) is ignored, never read.
  const user = await caller(deps, counted.store, authorization)
  if (!user) return fail(401, 'unauthorized')
  if (!ASK_ROLES.includes(user.role)) return fail(403, 'forbidden')
  if (!deps.limiter.allow(user.id, t0)) return fail(429, 'rate_limited')

  const text = b.text.trim()
  const c: Ctx = { store: counted.store, brand: b.brand as ServerBrand, user, now: t0, sources: [], uncertainty: [], freshest: 0 }
  let decidedBy: 'guard' | 'router' | 'model' | 'none' = 'none'
  let verdict: IntentVerdict | null = null
  let answer: Answer

  const g = guard(text)
  if (g.decision === 'DENY') {
    decidedBy = 'guard'
    answer = { kind: 'REFUSE', intent: null, text: g.reason === 'WRITE' ? 'Ask PZM อ่านข้อมูลได้อย่างเดียว — การสร้างหรือแก้ไขรายการให้ทำที่หน้าจอของระบบ' : 'คำขอนี้มีคำสั่งถึงผู้ช่วยเอง — ไม่ดำเนินการ', reason: g.reason }
  } else {
    let intent = keywordRoute(text).intent
    if (intent) decidedBy = 'router'
    else if (deps.classify) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        verdict = await Promise.race([deps.classify(text), new Promise<null>((r) => (timer = setTimeout(() => r(null), ASK_LIMITS.deadlineMs / 2)))])
        if (!verdict) c.uncertainty.push('model_timeout')
        else if (verdict.failure) c.uncertainty.push(`model_${verdict.failure.toLowerCase()}`)
      } catch {
        verdict = null
        c.uncertainty.push('model_error') // a model failure is never the user's failure
      } finally {
        if (timer) clearTimeout(timer)
      }
      intent = verdict?.intent ?? null
      if (intent) decidedBy = 'model'
    }
    if (intent === 'write_request') answer = { kind: 'REFUSE', intent, text: 'Ask PZM อ่านข้อมูลได้อย่างเดียว', reason: 'WRITE' }
    else if (intent === 'stock_lookup') answer = await stockLookup(c, text, hints)
    else if (intent === 'po_unconfirmed') answer = await poUnconfirmed(c, hints)
    else if (intent === 'stockout_risk') answer = await stockoutRisk(c, text, hints)
    else if (intent === 'transfer_status') answer = { kind: 'CLARIFY', intent, text: 'เรื่องใบโอนยังไม่เปิดใน Ask PZM รุ่นทดลอง — ดูได้ที่หน้า "ใบโอน"', reason: 'unsupported' }
    else if (intent === 'out_of_scope') answer = { kind: 'REFUSE', intent, text: 'ถามได้เรื่องสต๊อก ใบสั่งซื้อที่รอยืนยัน และความเสี่ยงของหมดครับ', reason: 'OUT_OF_SCOPE' }
    else answer = { kind: 'CLARIFY', intent: null, text: 'ไม่แน่ใจว่าถามเรื่องไหน — สต๊อกคงเหลือ, ใบสั่งซื้อที่รอผู้ขายยืนยัน หรือความเสี่ยงของหมด?', reason: 'intent' }
  }
  if (decidedBy === 'model') c.uncertainty.push('intent_from_model')
  return {
    status: 200,
    body: {
      ...answer,
      decidedBy,
      ...(verdict ? { model: { name: verdict.model, intent: verdict.intent, confidence: Math.round(verdict.confidence * 1000) / 1000 } } : {}),
      sources: c.sources,
      freshness: { readAt: t0, dataUpdatedAt: c.freshest || null },
      uncertainty: c.uncertainty,
      reads: counted.reads(),
      ms: deps.now() - t0,
    },
  }
}
