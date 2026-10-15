import { canonicalUnit } from './units'
import type { ReadLine } from './importReview'

/**
 * A product list typed or pasted into the import window, read into lines (Owner, 15 Oct 2026:
 * "แป้งพิซซ่า 5 ถุง, มอสซาเรลล่า 3 กก., กล่องพิซซ่า 18 นิ้ว 2 แพ็ค").
 *
 * This only splits the text and reads numbers. Which product a line means, whether its unit
 * converts, and whether it may be filed are decided by lib/importReview like any file, so a
 * typed list cannot add anything a person has not confirmed. Nothing is guessed: a line with
 * no clear quantity keeps NaN and waits for one, and a size glued to its unit ("500G") stays
 * in the name, because in this catalogue it is a pack size far more often than an amount.
 */
export interface ItemText {
  lines: ReadLine[]
  /** Instructions in the text ("ยังไม่ต้องส่งผู้ขาย"), kept and shown, never acted on. */
  constraints: string[]
}

/** Unit words a quantity may be followed by. Anything else after a number is part of the name. */
const UNITS = new Set([
  'kg', 'kgs', 'kg.', 'g', 'gr', 'gram', 'grams', 'ml', 'l', 'l.', 'lt', 'ltr', 'pack', 'packs', 'pk', 'pcs', 'pc', 'ea', 'ea.',
  'ctn', 'box', 'boxes', 'bag', 'bags', 'bottle', 'bottles', 'can', 'cans',
  'กก', 'กก.', 'ก.ก.', 'กิโล', 'กิโลกรัม', 'กรัม', 'มล', 'มล.', 'ลิตร', 'แพ็ค', 'แพค', 'แพ็ก', 'ชิ้น', 'อัน', 'ถุง', 'ขวด',
  'กล่อง', 'ลัง', 'ห่อ', 'ซอง', 'แผ่น', 'ถาด', 'กระป๋อง', 'ใบ', 'ม้วน', 'ตัว', 'โหล', 'แกลลอน', 'ถัง',
])
const NUMBER = /^\d+(?:\.\d+)?$/
const PROHIBITION = /ไม่ต้อง|ห้าม|ยังไม่|อย่า(?!ง)|\bdon'?t\b|\bdo not\b|\bnot yet\b|\bnever\b/i
const THAI_DIGIT = /[๐-๙]/g

const isUnit = (w: string | undefined) => !!w && UNITS.has(w.toLowerCase())
/** As the app spells it; a trailing dot goes when only the bare word is known ("มล." is มล). */
function unitOf(w: string): string {
  const c = canonicalUnit(w)
  return c !== w ? c : canonicalUnit(w.replace(/\.$/, ''))
}

function line(name: string, qty: number, unit?: string): ReadLine {
  return { name: name.trim(), qty, ...(unit ? { unit: unitOf(unit) } : {}) }
}

/** One item: the quantity from its end, else its start, else none. */
function readOne(seg: string): ReadLine | null {
  const w = seg.split(/\s+/).filter(Boolean)
  if (!w.length) return null
  const n = w.length

  // Multiplier: "2 x mozzarella", "2x mozzarella", "mozzarella x2", "2 x 12345", "12345 x2"
  const multBoth = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i.exec(seg)
  if (multBoth) {
    const a = Number(multBoth[1])
    const b = Number(multBoth[2])
    if (a >= 100 && b < 100) return line(multBoth[1], b)
    if (b >= 100 && a < 100) return line(multBoth[2], a)
    // "12345 x2" where x is closer to tail
    if (/\s+[x×*]\d+$/i.test(seg)) return line(multBoth[1], b)
    return line(multBoth[2], a)
  }
  const multHead = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(.+)$/i.exec(seg)
  if (multHead) return line(multHead[2], Number(multHead[1]))
  const multTail = /^(.+?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i.exec(seg)
  if (multTail) return line(multTail[1], Number(multTail[2]))

  // "... 2 แพ็ค", "... 3 กก.": a number and a unit word at the end.
  if (n > 2 && NUMBER.test(w[n - 2]) && isUnit(w[n - 1])) return line(w.slice(0, -2).join(' '), Number(w[n - 2]), w[n - 1])

  // "5 ถุง แป้งพิซซ่า": a number and a unit word at the start.
  if (n > 2 && NUMBER.test(w[0]) && isUnit(w[1])) return line(w.slice(2).join(' '), Number(w[0]), w[1])

  // "RANCH 1", "12345 2": bare quantity at the end.
  if (n > 1 && NUMBER.test(w[n - 1])) return line(w.slice(0, -1).join(' '), Number(w[n - 1]))

  // "3 mozzarella": bare quantity at the start followed by non-unit words.
  if (n > 1 && NUMBER.test(w[0]) && !isUnit(w[1])) return line(w.slice(1).join(' '), Number(w[0]))

  // ponytail: unclear quantity or single token (12345, 10, 7UP, 15/10/2026, 17:00) keeps NaN waiting for user input
  return line(seg, NaN)
}

export function readItemText(text: string): ItemText {
  const out: ItemText = { lines: [], constraints: [] }
  const plain = text.replace(THAI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0e50))
  for (const raw of plain.split(/\r?\n|[,;、]|\s+(?:และ|and)\s+/i)) {
    const seg = raw.trim().replace(/\s+/g, ' ')
    if (!seg) continue
    if (PROHIBITION.test(seg)) {
      out.constraints.push(seg)
      continue
    }
    const l = readOne(seg)
    if (l && l.name) out.lines.push(l)
  }
  return out
}
