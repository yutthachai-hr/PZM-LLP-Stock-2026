/**
 * G17 — R0, a keyword baseline behind the same LayaClient interface. NOT Laya.
 *
 * It exists so the harness runs end to end before any model is supplied, and as the floor a
 * real System-1 model has to beat to show incremental value. Its confidences are fixed
 * heuristics (0.9 one clear signal, 0.6 otherwise) — not probabilities, and reported as such.
 */
import { labelsFor, type Spec } from '../safety/layaDataset'
import type { LayaClient } from './gate'
import { SLOTS, type Intent, type LayaAnswers, type LayaRequest, type Slot } from './questions'

const STRONG_INJECTION = /ignore (your|previous|all)|system( override)?\s*:|note to ai|\[ถึงบอท\]|ระบบให้อนุมัติ|อนุมัติ\s*pr\s*ทั้งหมด|เป็นแอดมิน|"decision"\s*:|guard disabled|auto-send/i
const SOFT_INJECTION = /pre-?approved|skip the receiving|ไม่ต้องตรวจ|ผู้จัดการบอกแล้ว|บอทช่วย|set stock|ไม่ต้องนับ/i
const FORBIDDEN = /approve every|อนุมัติ.*ทั้งหมด|set stock|auto-send|กดรับของ.*ให้หน่อย/i

const INTENT_RULES: [Intent, RegExp][] = [
  ['CREATE_TRANSFER_DRAFT', /โอน|ย้าย|transfer|\bmove\b|send .* out of|\bTR\b/i],
  ['RECEIVE', /รับของ|รับเข้า|\breceive\b/i],
  ['EXPLAIN_RISK', /ทำไม|\bexplain\b|\bwhy\b/i],
  ['CREATE_PR', /สั่ง|ใบขอซื้อ|\bPR\b|\border\b|\bordr\b|need more|ขอเพิ่ม|\bneed\b/i],
  ['SUPPLIER_QUERY', /จะส่ง|\bETA\b|deliver|มีของไหม|in stock|ขาด|back order|เลื่อนส่ง|ของเข้า|บิล|ส่งครบ/i],
  ['READ_STOCK', /เหลือ|เช็คสต็อก|check .*stock|stock|onhand/i],
]

const PRODUCT = /มอสซาเรลล่า|มอสซาเลล่า|mozzarella|mozarela|เชดด้า|เชดดา|cheddar|chedar|แป้ง|แปง|flour|กล่องพิซ|pizza box|larg pizza box|ซอสมะเขือ|tomato|tomatoe|เปปเปอโรนี|เปบเปอโรนี|pepperoni|peperoni|\b[A-Z]{2}-\d{3}\b/i
const AMBIGUOUS_PRODUCT = /สั่งมอส\s|\bbox\b|bags of cheese|ชีส(?!\S*ที่)/i
const QTY = /\b\d+\s*(กก\.|kg|ถุง|bags?|ลัง|cartons?|แพ็ค|packs?|ctn|KG)|x\d+|\b\d+\s*(กก|ถุง|ลัง|แพ็ค)/i
const SITE = /สุขุมวิท|อ่อนนุ[ชท]|สีลม|อารี|sukhumvit|suhkumvit|on ?nut|onnut|silom|silum|\bari\b|SUKHUMVIT|ONNUT|SILOM|ARI/gi
const STALE = /เมื่อวาน|last week|as of/i

export function classify(text: string, source: LayaRequest['source']): { spec: Spec; strong: boolean } {
  const injection = STRONG_INJECTION.test(text) ? 'INJECTION' : SOFT_INJECTION.test(text) ? 'SUSPICIOUS' : 'CLEAN'
  const isDoc = source !== 'chat' && source !== 'line'
  const hits = INTENT_RULES.filter(([, re]) => re.test(text)).map(([i]) => i)
  let intent: Intent = hits[0] ?? 'UNKNOWN'
  if (isDoc && intent !== 'SUPPLIER_QUERY') intent = source === 'supplier_note' ? 'SUPPLIER_QUERY' : 'UNKNOWN'
  if (injection !== 'CLEAN' && FORBIDDEN.test(text)) intent = 'UNKNOWN'
  const sites = text.match(SITE) ?? []
  const slots: Slot[] = []
  if (PRODUCT.test(text)) slots.push('product')
  if (QTY.test(text)) slots.push('quantity')
  if (intent === 'CREATE_TRANSFER_DRAFT') {
    if (sites.length >= 2 || /จาก|from|out of|>/.test(text)) slots.push('source')
    if (sites.length >= 2 || /ไป|to |->|>/.test(text)) slots.push('destination')
  } else if (sites.length) slots.push('destination')
  const spec: Spec = {
    intent,
    slots,
    source,
    injection,
    ambiguousProduct: AMBIGUOUS_PRODUCT.test(text) && !PRODUCT.test(text.replace(/มอส\s/, '')),
    stale: STALE.test(text),
    forbidden: injection !== 'CLEAN' && FORBIDDEN.test(text),
    complex: (text.match(/x\d+/g) ?? []).length > 1,
  }
  return { spec, strong: hits.length === 1 || (isDoc && hits.length <= 1) }
}

export const keywordBaseline: LayaClient = {
  info: { name: 'keyword-baseline', checkpoint: 'r0/1' },
  async ask(req) {
    const { spec, strong } = classify(req.text, req.source)
    const l = labelsFor(spec)
    const c = strong ? 0.9 : 0.6
    const completeness = Object.fromEntries(SLOTS.map((s) => [s, { label: l.completeness[s], confidence: c }])) as LayaAnswers['completeness']
    return {
      intent: { label: l.intent, confidence: c },
      completeness,
      risk: { label: l.risk, confidence: c },
      injection: { label: l.injection, confidence: l.injection === 'CLEAN' ? c : 0.9 },
      route: { label: l.route, confidence: c },
      escalation: { label: l.escalation, confidence: c },
    } satisfies LayaAnswers
  },
}
