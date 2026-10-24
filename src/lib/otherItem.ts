// Adapted from PR1 Smart Other (4898dbbf), deliberately not its early-write command.
// Keep punctuation/numbers in identity: productMatch's supplier/name stripping is too
// permissive for experimental specifications. Suggestions are never identity decisions.
import type { Product, Supplier } from '../types'

export const otherTextKey = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
export const isOtherPlaceholder = (p: Pick<Product, 'name' | 'active'>) => p.active !== false && /\(\s*OTHER\s*\)\s*$/i.test(p.name.trim())
export const isKnownOtherSupplier = (s: Pick<Supplier, 'id' | 'name' | 'active'> | null | undefined) => !!s && s.id !== '__other' && s.active !== false && otherTextKey(s.name) === 'other'
export const makeOtherSku = (seq: number) => `RND-${String(seq).padStart(6, '0')}`
export function otherIdentity(supplierId: string, parentId: string, name: string, spec: string, unit: string): string {
  return JSON.stringify([supplierId, parentId, otherTextKey(name), otherTextKey(spec), otherTextKey(unit)])
}
export async function otherHash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
