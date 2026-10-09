/**
 * Ask PZM — the deterministic layer: the guard (DENY), the keyword router and slot extraction.
 *
 * The guard runs FIRST and its DENY is final: no model output is consulted after it (pipeline.ts).
 * It denies two things: requests to change data (Ask PZM is read-only) and instructions aimed at
 * the assistant itself. It is deliberately broad — a false DENY costs a rephrase; a missed one is
 * still harmless because nothing here can write, but it must never be a model that lets it pass.
 *
 * Rules were written from the rulebook vocabulary (stack/reflex/rulebook) before the evaluation set
 * existed; the evaluation set's phrasing is separate (evalSet.ts).
 */
import type { AskIntent } from './intents'

export type GuardVerdict = { decision: 'DENY'; reason: 'WRITE' | 'INJECTION'; rule: string } | { decision: 'PASS' }

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

/** Instructions to the assistant, in chat or pasted documents. */
const INJECTION: [string, RegExp][] = [
  ['ignore-instructions', /\b(ignore|disregard|forget)\b.{0,30}\b(instruction|rule|prompt|previous|above)s?\b/],
  ['role-override', /\b(you are now|act as|pretend to be|developer mode|admin mode|jailbreak|system prompt)\b/],
  ['th-ignore', /(ไม่ต้องสนใจ|เพิกเฉย|ลืม)\S{0,6}(คำสั่ง|กฎ)/],
  ['th-role', /(โหมดแอดมิน|โหมดผู้ดูแล|โหมดนักพัฒนา|ตอนนี้คุณคือ|สมมติว่าคุณเป็น)/],
  ['secrets', /\b(api key|password|token|credential)s?\b|รหัสผ่าน/],
]

/** Requests to change data. Verb-led so that nouns ("ใบสั่งซื้อ", "purchase order", "transfer status") stay readable. */
const WRITE: [string, RegExp][] = [
  ['en-imperative', /(^|please |pls |can you |could you |go ahead and |now )(create|make|place|raise|add|adjust|set|change|update|edit|delete|remove|cancel|approve|reject|receive|record|write off|order|reorder|transfer|move|send|book|post|submit|increase|decrease|reduce)\b/],
  ['en-set-to', /\b(set|change|update)\b.{0,40}\bto\b\s*\d/],
  ['en-order-qty', /\border\s+\d+|\btransfer\s+\d+|\badd\s+\d+|\bremove\s+\d+/],
  ['th-write', /(ช่วย|กรุณา|รบกวน|ขอให้|จัดการ)?\s*(สร้าง|สั่ง(ซื้อ)?เพิ่ม|ช่วยสั่ง|สั่ง\s*\d|เพิ่มสต[๊็]?อก|เพิ่มยอด|ปรับยอด|ปรับสต[๊็]?อก|ลดยอด|แก้(ไข)?(ยอด|จำนวน|ราคา|หน่วย)|ลบ(รายการ|สินค้า|ออก)|ยกเลิก|อนุมัติ|ปฏิเสธ|รับของเข้า|ตัดสต[๊็]?อก|บันทึกของเสีย|ตั้งยอด|เปลี่ยน(หน่วย|ราคา|ยอด))/],
  ['th-transfer-cmd', /(ช่วย|กรุณา)\s*โอน|โอน\S*\s*\d+\s*\S*\s*(ไป|ให้)/],
]

export function guard(text: string): GuardVerdict {
  const t = norm(text)
  for (const [rule, re] of INJECTION) if (re.test(t)) return { decision: 'DENY', reason: 'INJECTION', rule }
  for (const [rule, re] of WRITE) if (re.test(t)) return { decision: 'DENY', reason: 'WRITE', rule }
  return { decision: 'PASS' }
}

/** Keyword evidence per read intent. A message matching exactly one is routed without a model. */
const KEYWORDS: Record<Exclude<AskIntent, 'write_request' | 'out_of_scope'>, RegExp> = {
  po_unconfirmed: /(ยัง\S{0,3}(ไม่)?\S{0,3}(ยืนยัน|คอนเฟิร์ม|ตอบ|รับออเดอร์))|รอ(ซัพ|ผู้ขาย)?\S{0,4}(ยืนยัน|ตอบ)|\b(unconfirmed|not (yet )?confirmed|awaiting (supplier )?confirmation|not acknowledged|not accepted)\b/,
  stockout_risk: /(เสี่ยง\S{0,3}หมด|ใกล้หมด|จะหมด|ขาดสต[๊็]?อก|ใช้ได้อีก\S{0,4}วัน|ต่ำกว่าจุดสั่ง)|\b(run(ning)? out|stock-?out|days of cover|below reorder|low stock)\b/,
  transfer_status: /(โอน\S{0,10}(ถึง|สถานะ|ค้าง|ระหว่าง|รอ)|ใบโอน|ระหว่างทาง|ของที่กำลังส่ง)|\b(transfers?|in transit)\b/,
  stock_lookup: /(สต[๊็]?อก|stock|คงเหลือ|เหลือ(เท่า|กี่)|มีกี่|ยอดคง|on hand|how (much|many)|balance|inventory)/,
}

export interface RouteResult {
  intent: AskIntent | null
  /** Every intent whose keywords matched; more than one = ambiguous, none = unknown. */
  matched: AskIntent[]
}

/** Keyword router. Specific intents outrank `stock_lookup`, whose words appear in all of them. */
export function keywordRoute(text: string): RouteResult {
  const t = norm(text)
  const specific = (['po_unconfirmed', 'stockout_risk', 'transfer_status'] as const).filter((k) => KEYWORDS[k].test(t))
  const matched: AskIntent[] = [...specific, ...(KEYWORDS.stock_lookup.test(t) ? (['stock_lookup'] as const) : [])]
  if (specific.length === 1) return { intent: specific[0], matched }
  if (specific.length === 0 && matched.length === 1) return { intent: 'stock_lookup', matched }
  return { intent: null, matched }
}

// ---------------------------------------------------------------- slots ----

export interface Named {
  id: string
  name: string
  aliases: string[]
}

/** The first entity whose name or alias occurs in the text; longest alias wins. Never fuzzy. */
export function findEntity<T extends Named>(text: string, items: readonly T[]): T | null {
  const t = norm(text)
  let best: { item: T; len: number } | null = null
  for (const item of items)
    for (const a of [item.name, ...item.aliases]) {
      const n = norm(a)
      if (n && occurs(t, n) && (!best || n.length > best.len)) best = { item, len: n.length }
    }
  return best?.item ?? null
}

/**
 * Does `name` occur in `text`? A name that starts or ends with a Latin letter or digit must stand
 * as a whole word on that side: "CK" (central kitchen) is not in "check" or "Pack Plus". Thai has
 * no spaces between words, so a Thai edge matches as a substring, as before.
 */
function occurs(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const left = /^[a-z0-9]/.test(name) ? '(?<![a-z0-9])' : ''
  const right = /[a-z0-9]$/.test(name) ? '(?![a-z0-9])' : ''
  return new RegExp(`${left}${esc}${right}`).test(text)
}

/** "7 วัน", "in 10 days", "สัปดาห์" → days; default 7. */
export function horizonDays(text: string): number {
  const t = norm(text)
  const m = t.match(/(\d{1,3})\s*(วัน|days?)/)
  if (m) return Math.min(90, Math.max(1, Number(m[1])))
  if (/(สัปดาห์|อาทิตย์|week)/.test(t)) return 7
  if (/(เดือน|month)/.test(t)) return 30
  return 7
}
