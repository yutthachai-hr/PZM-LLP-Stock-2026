import type { AppUser, Role } from '../../src/types'
import { horizonDays } from '../../src/agent/ask/guard'
import { eligibility, guidedEligibility, type Eligibility, type Ineligible } from '../../src/agent/ask/eligibility'
import type { AskIntent } from '../../src/agent/ask/intents'
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
  /** Outgoing rows of ONE product at ONE site in the usage window; above it the answer is "partial". */
  movementsPerProductSite: 200,
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
  /**
   * SHADOW ONLY (owner, Track 2): told the text and the contract's decision after the fact, e.g.
   * to record what a model would have said. Never awaited; its result is never read here.
   */
  shadow?: (text: string, decision: Eligibility) => void
  /** Per-isolate rate limiter; injected so tests control it. A first line only. */
  limiter: RateLimiter
  /** The hard, edge-wide per-user limit (Cloudflare Rate Limiting binding). Required in staging. */
  globalLimit?: (uid: string) => Promise<boolean>
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
  /** Records already resolved in this request: each is read (and listed as a source) once. */
  product?: Product
  site?: Location
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
  if (c.product && (!hint || hint === c.product.id)) return c.product
  const p = await resolveProductOnce(c, text, hint)
  if (p) c.product = p
  return p
}

async function resolveProductOnce(c: Ctx, text: string, hint?: string): Promise<Product | null> {
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
  if (c.site && hint === c.site.id) return c.site
  const s = await resolveSiteOnce(c, hint)
  if (s && s !== 'out_of_scope') c.site = s
  return s
}

async function resolveSiteOnce(c: Ctx, hint?: string): Promise<Location | null | 'out_of_scope'> {
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
    // A capped read is never summed into a "total": ask for one site instead.
    if (rows.length >= ASK_LIMITS.levelsPerProduct) return { kind: 'CLARIFY', intent: 'stock_lookup', text: 'สินค้านี้มีหลายสาขาเกินขอบเขตการอ่าน — เลือกสาขาครับ', reason: 'scope_too_wide' }
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
  const capped = open.length >= ASK_LIMITS.openOrders
  if (capped) c.uncertainty.push('orders_capped')
  const waiting = open.filter((o) => o.supplierConfirmedAt === undefined && inScope(c.user, o.locationId)).sort((a, b) => a.orderedAt - b.orderedAt)
  open.forEach((o) => fresh(c, o.updatedAt))
  src(c, col(c, 'purchaseOrders'), waiting.map((o) => o.id))
  const days = (t: number) => Math.max(0, Math.floor((c.now - t) / 86_400_000))
  return {
    kind: 'ANSWER',
    intent: 'po_unconfirmed',
    // A capped read is "at least N", never a total; and "none" is only said when the read was complete.
    text: capped
      ? `ใบสั่งซื้อที่ผู้ขายยังไม่ยืนยัน อย่างน้อย ${waiting.length} ใบ (ใบสั่งซื้อเปิดอยู่มากกว่าที่อ่านได้ — เลือกสาขาเพื่อดูครบ)`
      : waiting.length
        ? `ใบสั่งซื้อที่ผู้ขายยังไม่ยืนยัน ${waiting.length} ใบ`
        : 'ไม่มีใบสั่งซื้อที่รอผู้ขายยืนยัน',
    facts: { orders: waiting.slice(0, 30).map((o) => ({ id: o.id, docNo: o.docNo, supplierName: o.supplierName, siteId: o.locationId, daysWaiting: days(o.orderedAt) })), total: waiting.length, complete: !capped },
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
  // Outgoing rows of the usage window only: the bounded aggregate (Track 4). Two equalities and a
  // range on `date` — one composite index per brand (stack/firestore.indexes.staging.json), so a
  // request reads about one row per issue in the last four weeks instead of the product's whole
  // history. Usage is what leaves a site; the window starts at the first outgoing row, so a young
  // series reads slightly HIGHER usage than the app's own index — the cautious direction.
  const from = c.now - (ASK_LIMITS.usageWindowDays + 1) * 86_400_000
  const moves = await c.store.query<Parameters<typeof usageIndex>[0][number]>(
    col(c, 'stockMovements'),
    [{ field: 'productId', op: '==', value: p.id }, { field: 'fromLocationId', op: '==', value: site.id }, { field: 'date', op: '>=', value: from }],
    ASK_LIMITS.movementsPerProductSite,
  )
  // A capped window is partial: no rate, no verdict — never a figure from part of the history.
  const partial = moves.length >= ASK_LIMITS.movementsPerProductSite
  if (partial) c.uncertainty.push('history_capped')
  const usage = partial ? undefined : usageAt(usageIndex(moves, c.now, ASK_LIMITS.usageWindowDays), site.id, p.id)
  const perDay = usage?.avgDaily ?? null
  if (perDay === null && !partial) c.uncertainty.push('too_little_history')
  const orders = await c.store.query<{ id: string; docNo: string; supplierName: string; orderedAt: number; expectedAt?: number; lines: Parameters<typeof remainingBaseQty>[0] & { productId: string }[] }>(col(c, 'purchaseOrders'), [{ field: 'status', op: '==', value: 'ordered' }, { field: 'locationId', op: '==', value: site.id }], ASK_LIMITS.ordersPerSite)
  if (orders.length >= ASK_LIMITS.ordersPerSite) c.uncertainty.push('orders_capped')
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
  else if (partial) parts.push('ประวัติการใช้มากเกินขอบเขตการอ่าน — ไม่คำนวณจากข้อมูลบางส่วน')
  else parts.push('ประวัติการใช้น้อยเกินไปที่จะคำนวณอัตราการใช้')
  parts.push(incoming.length ? `กำลังมา: ${incoming.map((x) => `${x.docNo} ${x.qty} ${unit}`).join(', ')}` : 'ไม่มีใบสั่งซื้อที่ค้างรับสำหรับสินค้านี้')
  parts.push(perDay === null ? 'ประเมินความเสี่ยงไม่ได้' : atRisk ? `เสี่ยงหมดภายใน ${days} วัน` : `ไม่เสี่ยงหมดภายใน ${days} วัน`)
  return { kind: 'ANSWER', intent: 'stockout_risk', text: parts.join('\n'), facts: { productId: p.id, siteId: site.id, onHand: r2(onHand), perDay: perDay === null ? null : r2(perDay), coverDays: cover === null ? null : r2(cover), horizonDays: days, atRisk: perDay === null ? null : atRisk, incoming, incomingComplete: orders.length < ASK_LIMITS.ordersPerSite, movementsRead: moves.length, historyComplete: !partial } }
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
  const counted = { ...readOnlyCounting(deps.store), now: deps.now }
  const b = (body ?? {}) as Record<string, unknown>
  if (!SERVER_BRANDS.includes(b.brand as ServerBrand)) return fail(400, 'bad_request')
  // Two ways to ask: free text (judged by the contract) or a guided request — an explicit
  // operation the person picked with buttons, which carries no free text at all.
  const guided = b.op !== undefined
  if (guided ? b.text !== undefined : typeof b.text !== 'string' || !b.text.trim() || b.text.length > ASK_LIMITS.textMax) return fail(400, 'bad_request')
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
  if (deps.globalLimit && !(await deps.globalLimit(user.id))) return fail(429, 'rate_limited')

  const text = typeof b.text === 'string' ? b.text.trim() : ''
  const c: Ctx = { store: counted.store, brand: b.brand as ServerBrand, user, now: t0, sources: [], uncertainty: [], freshest: 0 }
  let answer: Answer

  // ---- the eligibility contract decides; nothing else does (models are shadow-only) ----
  let e: Eligibility
  let decidedBy: 'guided' | 'contract'
  if (guided) {
    decidedBy = 'guided'
    e = guidedEligibility({ op: b.op, productId: hints.productId ?? null, siteId: hints.siteId ?? null, horizonDays: b.horizonDays })
  } else {
    decidedBy = 'contract'
    // Resolve every reference first, against the database (ids from the client are hints only).
    const product = await resolveProduct(c, text, hints.productId)
    const site = await resolveSite(c, hints.siteId)
    if (site === 'out_of_scope') return done(c, t0, counted, { kind: 'REFUSE', intent: null, text: 'สาขานี้ไม่อยู่ในสิทธิ์ของคุณ', reason: 'site_scope' }, decidedBy)
    const refs = await resolveRefs(c, text)
    const siteNames = site ? [site.name] : []
    e = eligibility(text, {
      product: () => product?.id ?? null,
      // The whole text resolves to the chosen site; a sub-phrase only if it names that site.
      site: (s) => (!site ? null : s === text || siteNames.some((n) => s.normalize('NFC').toLowerCase().includes(n.normalize('NFC').toLowerCase())) ? site.id : null),
      poExists: (d) => refs.po.has(d),
      skuExists: (k) => refs.sku.has(k),
    })
    // Already-resolved records are passed on so no tool reads them twice.
    if (e.eligible) {
      if (product) hints.productId = product.id
      if (site) hints.siteId = site.id
    }
  }
  try {
    deps.shadow?.(text, e) // shadow only: never awaited, never consulted, never allowed to fail the request
  } catch {
    /* a shadow's failure is not the person's */
  }

  if (!e.eligible) answer = notEligible(e)
  else if (e.op === 'STOCK_LOOKUP') answer = await stockLookup(c, text, hints)
  else if (e.op === 'PO_UNCONFIRMED') answer = await poUnconfirmed(c, hints)
  else answer = await stockoutRisk(c, e.horizonDays ? `${text} ${e.horizonDays} วัน` : text, hints)
  return done(c, t0, counted, answer, decidedBy, e.eligible ? e.op : null)
}

/** The answer for a request the contract did not make eligible: never a tool, never a figure. */
function notEligible(e: Extract<Eligibility, { eligible: false }>): Answer {
  const refuse = 'Ask PZM อ่านข้อมูลได้อย่างเดียว และตอบได้ 3 เรื่อง: สต๊อกคงเหลือ, ใบสั่งซื้อที่รอผู้ขายยืนยัน, ความเสี่ยงของหมด — การสร้าง แก้ไข อนุมัติ หรือบันทึกรายการให้ทำที่หน้าจอของระบบ'
  const texts: Partial<Record<Ineligible, string>> = {
    GUARD_INJECTION: 'คำขอนี้มีคำสั่งถึงผู้ช่วยเอง — ไม่ดำเนินการ',
    QUOTED_OR_DOCUMENT: 'Ask PZM ไม่ทำตามข้อความในเอกสารหรือคำพูดที่ยกมา — ถามเป็นคำถามของคุณเองครับ',
    COMPOUND_REQUEST: 'ถามทีละเรื่องครับ — เลือกจากปุ่มด้านล่างได้',
    NO_ALLOWED_OP: 'ไม่แน่ใจว่าถามเรื่องไหน — เลือก: สต๊อกคงเหลือ, ใบสั่งซื้อที่รอผู้ขายยืนยัน หรือความเสี่ยงของหมด',
    AMBIGUOUS_OP: 'คำถามนี้ตรงกับหลายเรื่อง — เลือกเรื่องเดียวจากปุ่มด้านล่างครับ',
    PRODUCT_MISSING: 'สินค้าตัวไหนครับ? เลือกสินค้าก่อน',
    SITE_MISSING: 'สาขาไหนครับ? การดูความเสี่ยงของหมดทำทีละสินค้า ทีละสาขา',
    UNRESOLVED_REFERENCE: 'ไม่พบสาขา สินค้า หรือเลขเอกสารที่อ้างถึงในข้อมูลของคุณ — เลือกจากรายการแทนครับ',
  }
  return { kind: e.kind, intent: e.op ? (e.op.toLowerCase() as AskIntent) : null, text: texts[e.reason] ?? refuse, reason: e.reason }
}

/** PO numbers and SKU codes the text mentions, each looked up once (1 read each, at most 3 each). */
async function resolveRefs(c: Ctx, text: string): Promise<{ po: Set<string>; sku: Set<string> }> {
  const t = text.normalize('NFC').toLowerCase()
  const po = new Set<string>()
  const sku = new Set<string>()
  for (const m of [...new Set(t.match(/\bpo[-\s]?\d{3,6}\b/g) ?? [])].slice(0, 3)) {
    const d = m.replace(/\s/g, '-').toUpperCase()
    const rows = await c.store.query<{ id: string; locationId: string }>(col(c, 'purchaseOrders'), [{ field: 'docNo', op: '==', value: d }], 1)
    if (rows.length && inScope(c.user, rows[0].locationId)) po.add(d)
  }
  for (const m of [...new Set(t.match(/\b[a-z]{2,4}-\d{3,5}\b/g) ?? [])].filter((x) => !/^po-/.test(x)).slice(0, 3)) {
    const k = m.toUpperCase()
    if ((await c.store.query(col(c, 'products'), [{ field: 'sku', op: '==', value: k }], 1)).length) sku.add(k)
  }
  return { po, sku }
}

function done(c: Ctx, t0: number, counted: ReturnType<typeof readOnlyCounting> & { now: () => number }, answer: Answer, decidedBy: 'guided' | 'contract', op: string | null = null): AskReply {
  return {
    status: 200,
    body: {
      ...answer,
      decidedBy,
      op,
      sources: c.sources,
      freshness: { readAt: t0, dataUpdatedAt: c.freshest || null },
      uncertainty: c.uncertainty,
      reads: counted.reads(),
      ms: counted.now() - t0,
    },
  }
}
