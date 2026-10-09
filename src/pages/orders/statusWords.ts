import type { Lang } from '../../i18n/I18nContext'

/**
 * The three short words the order list shows for where an order stands (owner, 6 Oct 2026):
 * short enough that ordered, sent and confirmed sit on one line in both languages.
 *
 * Kept out of the phrase table on purpose: "ส่ง LINE" there is the button ("Send via LINE"),
 * and "ยืนยัน" is the verb on a dozen buttons. As a state they mean something else in
 * English, so they are spelled out here per language.
 */
const WORDS = {
  ordered: { th: 'สั่งแล้ว', en: 'Ordered' }, // i18n-key
  lineSent: { th: 'ส่ง LINE', en: 'LINE sent' }, // i18n-key
  confirmed: { th: 'ยืนยัน', en: 'Approved' }, // i18n-key
} as const

export type StatusWord = keyof typeof WORDS

export function statusWord(word: StatusWord, lang: Lang): string {
  return WORDS[word][lang]
}
