/**
 * Ask PZM, the app side (owner approval 4, 9 Oct 2026; staging only).
 *
 * The page sends the question and, at most, the ids of a product and a site it found in data
 * the app ALREADY holds (useData) — no extra listener, no extra read. Those ids are hints: the
 * server resolves each one against the database before using it, and decides who the user is,
 * their role and their sites from its own records. Nothing here can write.
 */
import { getBrand } from '../brand/brand'
import type { Product, StockLocation } from '../types'

/** On only in a build made with VITE_ASK_PZM=on (staging). Production builds never set it. */
export const ASK_PZM_ON = import.meta.env.VITE_ASK_PZM === 'on'

export interface AskAnswer {
  kind: 'ANSWER' | 'CLARIFY' | 'REFUSE'
  intent: string | null
  text: string
  reason?: string
  facts?: Record<string, unknown>
  decidedBy: 'contract' | 'guided'
  op: AskOp | null
  sources: { collection: string; ids: string[] }[]
  freshness: { readAt: number; dataUpdatedAt: number | null }
  uncertainty: string[]
  reads: number
  ms: number
}

export type AskFailure = 'unauthorized' | 'rate_limited' | 'not_available' | 'network' | 'error'

const norm = (s: string) => s.normalize('NFC').toLowerCase()

/** The longest product name or SKU found in the text, from the catalogue already in memory. */
export function hintProduct(text: string, products: readonly Pick<Product, 'id' | 'name' | 'sku'>[]): string | undefined {
  const t = norm(text)
  let best: { id: string; len: number } | undefined
  for (const p of products)
    for (const k of [p.name, p.sku]) {
      const n = k ? norm(k) : ''
      if (n.length >= 2 && t.includes(n) && (!best || n.length > best.len)) best = { id: p.id, len: n.length }
    }
  return best?.id
}

export function hintSite(text: string, locations: readonly Pick<StockLocation, 'id' | 'name'>[]): string | undefined {
  const t = norm(text)
  let best: { id: string; len: number } | undefined
  for (const l of locations) {
    const n = norm(l.name)
    if (n.length >= 2 && t.includes(n) && (!best || n.length > best.len)) best = { id: l.id, len: n.length }
  }
  return best?.id
}

/** The three things Ask PZM does; a guided request names one explicitly (no free text). */
export const ASK_OPS = ['STOCK_LOOKUP', 'PO_UNCONFIRMED', 'STOCKOUT_RISK'] as const
export type AskOp = (typeof ASK_OPS)[number]

export type AskRequest = { text: string; hints: { productId?: string; siteId?: string } } | { op: AskOp; hints: { productId?: string; siteId?: string }; horizonDays?: number }

export async function askPzm(req: AskRequest): Promise<{ ok: true; answer: AskAnswer } | { ok: false; failure: AskFailure }> {
  const { authHeader } = await import('./poImages')
  let res: Response
  try {
    res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ brand: getBrand(), ...req }) })
  } catch {
    return { ok: false, failure: 'network' }
  }
  if (res.status === 401) return { ok: false, failure: 'unauthorized' }
  if (res.status === 429) return { ok: false, failure: 'rate_limited' }
  if (res.status === 404 || res.status === 503) return { ok: false, failure: 'not_available' }
  if (!res.ok) return { ok: false, failure: 'error' }
  return { ok: true, answer: (await res.json()) as AskAnswer }
}
