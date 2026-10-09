/**
 * Ask PZM — the positive, typed READ-only eligibility contract (owner directive, Track 2,
 * 9 Oct 2026). Replaces "deny what looks bad, answer the rest" with "answer only what positively
 * is one of three reads, completely specified; refuse or ask about everything else".
 *
 * Allowed operations, and what each needs before a read tool may run:
 *   STOCK_LOOKUP    a product (resolved), optionally a site (resolved)
 *   PO_UNCONFIRMED  nothing; a PO number, if mentioned, must resolve
 *   STOCKOUT_RISK   a product AND a site (resolved); a horizon in days, default 7
 *
 * A request is NOT eligible — no tool runs — when any of these hold. They describe what a read
 * question is not, in general terms; none was fitted to a test row:
 *   - the deterministic guard denies it (writes, instructions to the assistant);
 *   - it states a quantity with a unit ("20 ลัง", "5 kg"): a question asks for amounts, it does
 *     not give them (a horizon in days is the one number a read takes);
 *   - it reports an event (arrived, damaged, counted, received) — that is a record to file;
 *   - it asks for an action beyond looking (polite request words not followed by a look verb);
 *   - it joins two requests ("…แล้ว…", "…and…", "if…");
 *   - it quotes someone, or carries a pasted document (invoice, supplier note, OCR, delivery note);
 *   - it matches no allowed operation, or more than one;
 *   - a required product/site is missing, or a mentioned branch / SKU / PO does not resolve.
 *
 * A model never makes a request eligible: models are shadow-only (they may be recorded beside
 * the decision, never consulted by it). Pure: no I/O; resolution is injected.
 */
import { guard, horizonDays } from './guard'

export const ALLOWED_OPS = ['STOCK_LOOKUP', 'PO_UNCONFIRMED', 'STOCKOUT_RISK'] as const
export type AllowedOp = (typeof ALLOWED_OPS)[number]

export type Ineligible =
  | 'GUARD_WRITE'
  | 'GUARD_INJECTION'
  | 'QUANTITY_STATED'
  | 'EVENT_REPORTED'
  | 'ACTION_REQUESTED'
  | 'COMPOUND_REQUEST'
  | 'QUOTED_OR_DOCUMENT'
  | 'NO_ALLOWED_OP'
  | 'AMBIGUOUS_OP'
  | 'PRODUCT_MISSING'
  | 'SITE_MISSING'
  | 'UNRESOLVED_REFERENCE'

/** Refusals are for things Ask PZM will never do; clarifications for reads it could do with more. */
export const REFUSE: readonly Ineligible[] = ['GUARD_WRITE', 'GUARD_INJECTION', 'QUANTITY_STATED', 'EVENT_REPORTED', 'ACTION_REQUESTED', 'QUOTED_OR_DOCUMENT']

export type Eligibility =
  | { eligible: true; op: AllowedOp; productId?: string; siteId?: string; horizonDays?: number }
  | { eligible: false; kind: 'REFUSE' | 'CLARIFY'; reason: Ineligible; op?: AllowedOp }

export interface Resolver {
  /** A product named or coded in the text (or chosen by the person), or null. */
  product(text: string): string | null
  /** A site named in the text (or chosen by the person), or null. */
  site(text: string): string | null
  /** Does this PO number exist (in this brand, in the caller's scope)? */
  poExists?(docNo: string): boolean
  /** Does this SKU-like code exist? */
  skuExists?(code: string): boolean
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim()

const UNIT = '(kg|kgs|g|gram|grams|กก\\.?|กิโล(กรัม)?|โล|ขีด|ถุง|ลัง|ใบ|ขวด|กล่อง|แพ็ค|แพค|ชิ้น|อัน|ถาด|กระป๋อง|กป\\.?|ม้วน|pack|packs|bag|bags|box|boxes|carton|cartons|can|cans|ea|pcs|piece|pieces|bottle|bottles|tray|trays|litre|liter|l|ml|ลิตร)'
const QUANTITY = new RegExp(`\\d+(?:[.,]\\d+)?\\s*${UNIT}(?![a-z])`)
const DAYS = /\d+\s*(วัน|days?)\b/g

const EVENT = /(มาถึง|มาส่ง|ได้รับ(ของ|แล้ว)|รับของ|เสียไป|เสียหาย|หาย(ไป)?แล้ว|หมดแล้ว|นับ(สต[๊็]?อก)?(เสร็จ|แล้ว)|ส่งมาแล้ว|ของมาแล้ว)|\b(arrived|delivered|we got|got the|received|damaged|broken|spoiled|counted|is actually|are actually)\b/
const LOOK = '(ดู|เช็ค|เช็ก|ตรวจ|บอก|หา|แสดง|check|show|tell|see|look|find|list|view)'
// Thai has no spaces between words: a verb must not match inside a longer word
// (ขอ in ของ "thing", ทำ in ทำไม "why", แก้ in แก้ว "glass").
const POLITE = new RegExp(`(ช่วย|ขอให้|อยากให้|ทำให้|ให้หน่อย|หน่อยนะ|ทีดิ|ด่วน|จัด(?!ส่ง)|เติม|อัพ|อัป|ตัด|แก้(?!ว)|ทำ(?!ไม)|ต้องการ|ขอ(?!ง|ดู)|please|could you|can you|make sure|i need|we need|need the|set |mark |fix|get rid|do it|make it|update|let's)`)
const POLITE_THEN_LOOK = new RegExp(`(ช่วย|ขอ|please|could you|can you)\\s*${LOOK}`)
const COMPOUND = /(แล้ว(?!หรือยัง)(?=\s*\S)|และ|ถ้า|พร้อมทั้ง|จากนั้น|ด้วย(?!กัน)|\bthen\b|\band\b|\bif\b|\balso\b|;)/
const QUOTED = /["“”'‘’「」«»]|(ใบแจ้งหนี้|ใบกำกับ|ใบส่งของ|หมายเหตุ|ข้อความจาก|พี่บอกว่า|เขาบอกว่า|ผู้จัดการบอก)|\b(invoice|supplier note|delivery note|ocr|the manager said|says:|note:)\b/

const PO_REF = /\bpo[-\s]?\d{3,6}\b/g
const SKU_REF = /\b[a-z]{2,4}-\d{3,5}\b/g
const SITE_MENTION = /(สาขา|\bbranch\b|\bat\s+[a-z])/

const OP_CUES: Record<AllowedOp, RegExp> = {
  PO_UNCONFIRMED: /((po|ใบสั่งซื้อ|purchase orders?|orders?|ออเดอร์)\S*.{0,40}((ยัง|ไม่ได้)\S{0,3}(ไม่)?\S{0,3}(ยืนยัน|คอนเฟิร์ม|confirm|ตอบ|รับ|accept|acknowledge)|รอ\S{0,10}(ยืนยัน|confirm|ตอบ)|unconfirmed|not (yet )?(confirmed|acknowledged|accepted)|awaiting (supplier )?confirmation))|(unconfirmed (po|purchase))|((supplier|vendor|ซัพ\S*|ผู้ขาย|ร้านค้า)\S*.{0,30}(ยังไม่|not yet|has not|have not|hasn't|haven't)\S*.{0,20}(ยืนยัน|คอนเฟิร์ม|confirm|ตอบ|accept|acknowledg|รับออเดอร์))/,
  STOCKOUT_RISK: /(เสี่ยง\S{0,3}หมด|จะหมด|ใกล้หมด|ขาดสต[๊็]?อก|run(ning)? out|stock-?out|days of cover|พอใช้กี่วัน|ใช้ได้อีกกี่วัน)/,
  STOCK_LOOKUP: /(สต[๊็]?อก|\bstock\b|คงเหลือ|เหลือ(เท่า|กี่|ไง|อยู่|ไหม)|มี(กี่|เท่า)|ยอดคง|how much|how many|on hand|\bbalance\b|\binventory\b)/,
}

export function eligibility(text: string, r: Resolver): Eligibility {
  const g = guard(text)
  if (g.decision === 'DENY') return { eligible: false, kind: 'REFUSE', reason: g.reason === 'WRITE' ? 'GUARD_WRITE' : 'GUARD_INJECTION' }
  const t = norm(text)
  const no = (reason: Ineligible, op?: AllowedOp): Eligibility => ({ eligible: false, kind: REFUSE.includes(reason) ? 'REFUSE' : 'CLARIFY', reason, ...(op ? { op } : {}) })

  if (QUOTED.test(t)) return no('QUOTED_OR_DOCUMENT')
  if (QUANTITY.test(t.replace(DAYS, ' '))) return no('QUANTITY_STATED')
  if (EVENT.test(t)) return no('EVENT_REPORTED')
  if (POLITE.test(t) && !POLITE_THEN_LOOK.test(t)) return no('ACTION_REQUESTED')
  if (COMPOUND.test(t)) return no('COMPOUND_REQUEST')

  const ops = ALLOWED_OPS.filter((op) => OP_CUES[op].test(t))
  // A risk or PO question usually mentions stock too; the specific one wins over STOCK_LOOKUP.
  const specific = ops.filter((o) => o !== 'STOCK_LOOKUP')
  if (specific.length > 1) return no('AMBIGUOUS_OP')
  const op = (specific.length ? specific[0] : ops[0]) as AllowedOp | undefined
  if (!op) return no('NO_ALLOWED_OP')

  // Every reference in the text must resolve; an unknown one is never "probably that one".
  for (const m of t.match(PO_REF) ?? []) if (!r.poExists?.(m.replace(/\s/g, '-').toUpperCase())) return no('UNRESOLVED_REFERENCE', op)
  for (const m of t.match(SKU_REF) ?? []) if (!/^po-/.test(m) && !r.skuExists?.(m.toUpperCase())) return no('UNRESOLVED_REFERENCE', op)
  const siteId = r.site(text)
  if (!siteId && SITE_MENTION.test(t)) return no('UNRESOLVED_REFERENCE', op)
  // "does <someone> have X" / "<someone> มี X ไหม": a question about another party's stock
  // (a supplier, a person) unless that someone is one of our sites. Ours only.
  const subject = t.match(/\bdoes\s+(.{2,40}?)\s+have\b/)?.[1] ?? t.match(/^(.{2,30}?)\s*มี\S{0,20}(ไหม|มั้ย|หรือเปล่า)/)?.[1]
  if (subject && !r.site(subject)) return no('UNRESOLVED_REFERENCE', op)

  if (op === 'PO_UNCONFIRMED') return { eligible: true, op, ...(siteId ? { siteId } : {}) }
  const productId = r.product(text)
  if (!productId) return no('PRODUCT_MISSING', op)
  if (op === 'STOCK_LOOKUP') return { eligible: true, op, productId, ...(siteId ? { siteId } : {}) }
  if (!siteId) return no('SITE_MISSING', op)
  return { eligible: true, op, productId, siteId, horizonDays: horizonDays(text) }
}

/** The guided path: a person picked the operation and the records; no language involved. */
export function guidedEligibility(req: { op: unknown; productId?: string | null; siteId?: string | null; horizonDays?: unknown }): Eligibility {
  if (!ALLOWED_OPS.includes(req.op as AllowedOp)) return { eligible: false, kind: 'REFUSE', reason: 'NO_ALLOWED_OP' }
  const op = req.op as AllowedOp
  const days = typeof req.horizonDays === 'number' && Number.isInteger(req.horizonDays) && req.horizonDays >= 1 && req.horizonDays <= 90 ? req.horizonDays : 7
  if (op === 'PO_UNCONFIRMED') return { eligible: true, op, ...(req.siteId ? { siteId: req.siteId } : {}) }
  if (!req.productId) return { eligible: false, kind: 'CLARIFY', reason: 'PRODUCT_MISSING', op }
  if (op === 'STOCK_LOOKUP') return { eligible: true, op, productId: req.productId, ...(req.siteId ? { siteId: req.siteId } : {}) }
  if (!req.siteId) return { eligible: false, kind: 'CLARIFY', reason: 'SITE_MISSING', op }
  return { eligible: true, op, productId: req.productId, siteId: req.siteId, horizonDays: days }
}
