/**
 * G17 / laya-v2 — make real PZM messages safe to keep as a dataset (owner, 8 Oct 2026).
 *
 * Real traffic (LINE chats, OCR'd bills, supplier notes) is what a System-1 model has to be
 * judged on; synthetic laya-v1 cannot show whether it handles the real thing. Before a message
 * is kept, everything that identifies a person or a business partner is replaced by a typed
 * placeholder — the shape stays (so "call 081-xxx" still reads as a phone number), the value
 * does not. Product words, quantities, units and SKUs are kept: they ARE the task.
 *
 * What is replaced: phone numbers, e-mail addresses, LINE ids, Thai national ids, bank account
 * numbers, tax ids, URLs, @mentions, money amounts with a currency, and the names the caller
 * lists (people, suppliers, branches) — the owner supplies those lists; names cannot be found
 * reliably by pattern, so an unlisted name is NOT removed. That is why rows are reviewed by a
 * person before they are committed (scripts/laya-v2-collect.mjs writes them as unreviewed).
 *
 * Pure: no I/O.
 */

export interface Replacement {
  kind: string
  re: RegExp
}

const PATTERNS: Replacement[] = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'URL', re: /\bhttps?:\/\/\S+/gi },
  // No \b in front of Thai: \b only knows Latin word characters, so it never matches before ไ.
  { kind: 'LINE_ID', re: /(?:\bline\s*id|ไลน์\s*ไอดี|ไอดีไลน์)\s*[:：]?\s*@?[\w.-]+/gi },
  { kind: 'MENTION', re: /(^|\s)@[\w.฀-๿-]{2,}/g },
  // 13-digit Thai id / tax id, with or without dashes.
  { kind: 'NATIONAL_ID', re: /\b\d[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d\b/g },
  // Bank account: 10–12 digits, often grouped xxx-x-xxxxx-x.
  { kind: 'BANK_ACCOUNT', re: /\b\d{3}[-\s]\d[-\s]\d{5}[-\s]\d\b|\b\d{10,12}\b/g },
  // Thai phones: 0x-xxx-xxxx / 0xx-xxx-xxxx / +66 …
  { kind: 'PHONE', re: /(?:\+66[-\s]?|\b0)\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}\b/g },
  // Money with a currency word or sign (a bare number is a quantity and stays).
  // No trailing \b after บาท for the same reason; "not followed by a Latin letter" instead.
  { kind: 'AMOUNT', re: /(?:฿\s?|THB\s?)\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:บาท|baht|THB)(?![A-Za-z])/gi },
]

export interface AnonymiseOptions {
  /** Names to replace, by kind: people, suppliers, branches. Matched case-insensitively. */
  names?: Partial<Record<'PERSON' | 'SUPPLIER' | 'SITE', readonly string[]>>
}

export interface Anonymised {
  text: string
  /** What was replaced, by kind — counts only, never the values. */
  replaced: Record<string, number>
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function anonymise(input: string, opts: AnonymiseOptions = {}): Anonymised {
  let text = input
  const replaced: Record<string, number> = {}
  const bump = (k: string) => (replaced[k] = (replaced[k] ?? 0) + 1)
  for (const { kind, re } of PATTERNS) {
    text = text.replace(re, (_m, lead?: string) => {
      bump(kind)
      // MENTION keeps the whitespace it matched in front of the @.
      return kind === 'MENTION' && typeof lead === 'string' ? `${lead}<${kind}>` : `<${kind}>`
    })
  }
  for (const [kind, list] of Object.entries(opts.names ?? {}) as [string, readonly string[]][]) {
    // Longest first, so "Dairy Co. Ltd" goes before "Dairy Co.".
    for (const name of [...list].filter((n) => n.trim().length >= 2).sort((a, b) => b.length - a.length)) {
      text = text.replace(new RegExp(escapeRe(name.trim()), 'gi'), () => {
        bump(kind)
        return `<${kind}>`
      })
    }
  }
  return { text, replaced }
}

/** th / en / mixed by the share of Thai letters among letters. */
export function langOf(text: string): 'th' | 'en' | 'mixed' {
  const thai = (text.match(/[฀-๿]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const letters = thai + latin
  if (!letters) return 'mixed'
  const t = thai / letters
  return t >= 0.85 ? 'th' : t <= 0.15 ? 'en' : 'mixed'
}

/** A first guess at the input class, for the labeller to confirm or change. */
export function guessClass(text: string, source: string): string {
  if (/(ignore|system|note to ai|ถึงบอท|อนุมัติอัตโนมัติ|ไม่ต้องตรวจ)/i.test(text)) return source === 'chat' || source === 'line' ? 'INSTRUCTION_INJECTION' : 'DOCUMENT_INJECTION'
  if (source === 'ocr' || source === 'invoice') return 'OCR_NOISE'
  if (source === 'supplier_note') return 'SUPPLIER_SLANG'
  if ((text.match(/\b[A-Z]{2,4}-\d{2}(?:-\d{2})?-\d{3}\b/g) ?? []).length >= 2) return 'SKU_HEAVY'
  if (text.trim().length <= 12) return 'SHORT_AMBIGUOUS'
  const l = langOf(text)
  return l === 'th' ? 'THAI' : l === 'en' ? 'ENGLISH' : 'MIXED'
}
