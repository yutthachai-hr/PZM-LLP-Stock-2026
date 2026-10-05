/**
 * The supplier link's token: `v1.<payload>.<signature>`, both base64url.
 *
 * Signed (HMAC-SHA256 with SUPPLIER_LINK_SECRET, truncated to 128 bits) rather than stored:
 * nothing has to be looked up to reject a forged or edited link, and a link is bound to one
 * order, one supplier and one link version — the order's `supplierLink.version`, which the
 * server bumps to kill every older link. Short enough (well under 300 characters) to ride
 * in a LINE postback later, when the company has an Official Account.
 *
 * WebCrypto only: runs in a Pages Function and in the tests' Node alike.
 */

export type TokenBrand = 'pizza' | 'lelapin'

export interface SupplierClaims {
  brand: TokenBrand
  poId: string
  supplierId: string
  version: number
  /** Hard expiry, ms epoch. */
  expMs: number
}

interface Wire {
  b: 'p' | 'l'
  o: string
  s: string
  k: number
  e: number
}

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function mac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))).slice(0, 16)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** A secret shorter than this is refused: the whole scheme rests on it. */
export const MIN_SECRET_LENGTH = 32

export async function signSupplierToken(c: SupplierClaims, secret: string): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('SUPPLIER_LINK_SECRET is too short')
  const wire: Wire = { b: c.brand === 'lelapin' ? 'l' : 'p', o: c.poId, s: c.supplierId, k: c.version, e: Math.floor(c.expMs / 1000) }
  const payload = b64url(enc.encode(JSON.stringify(wire)))
  return `v1.${payload}.${b64url(await mac(secret, `v1.${payload}`))}`
}

/**
 * The claims of a token this server signed, or null — for a forgery, an edit, a wrong
 * secret, an expired token or plain rubbish alike. Callers answer every null the same way.
 */
export async function verifySupplierToken(token: string, secret: string, now: number): Promise<SupplierClaims | null> {
  if (!secret || secret.length < MIN_SECRET_LENGTH || typeof token !== 'string' || token.length > 400) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const sig = fromB64url(parts[2])
  if (!sig || !sameBytes(sig, await mac(secret, `v1.${parts[1]}`))) return null
  const raw = fromB64url(parts[1])
  if (!raw) return null
  let w: Wire
  try {
    w = JSON.parse(new TextDecoder().decode(raw)) as Wire
  } catch {
    return null
  }
  if ((w.b !== 'p' && w.b !== 'l') || typeof w.o !== 'string' || typeof w.s !== 'string') return null
  if (!Number.isInteger(w.k) || !Number.isInteger(w.e)) return null
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(w.o) || !/^[A-Za-z0-9_-]{1,64}$/.test(w.s)) return null
  const expMs = w.e * 1000
  if (now > expMs) return null
  return { brand: w.b === 'l' ? 'lelapin' : 'pizza', poId: w.o, supplierId: w.s, version: w.k, expMs }
}
