import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Order-sheet picture hosting: a Pages Function over a KV namespace. (Until 17 Sep 2026
 * the same contract ran on Netlify Blobs; that implementation is gone.)
 *
 *   POST /api/po-image?kind=original|preview&po=<tag>   (see api/po-image.ts)
 *   GET  /po/<token>.jpg                                 (see po/[token].ts)
 *   POST /api/po-image?kind=ann-pdf|ann-image|ann-preview&po=<tag>   announcement files
 *   GET  /a/<token>.pdf|.jpg                             (see a/[token].ts)
 *
 * The app POSTs to /api/po-image (src/services/poImages.ts) and hands LINE the GET URL.
 *
 * KV gives the pictures a real TTL (`expirationTtl`), so unlike the Blobs version there
 * is no lazy expiry: an expired key is simply gone. The KV free plan allows 1,000 writes
 * a day — one sheet is two writes (original + preview), so that is 500 sheets a day.
 *
 * `tests/image-host.test.ts` pins the constants the app relies on.
 */

export interface Env {
  PO_IMAGES: KVNamespace
  /** Demo deployments only: a shared key accepted in place of a Firebase token. */
  PO_IMAGE_DEMO_KEY?: string
}

export const MAX_BYTES = 1_500_000
export const TTL_SECONDS = 7 * 86_400

/**
 * Company announcements (24 Sep 2026) share the namespace but not the rules above: an
 * announcement is a record the company keeps — "what did we send the suppliers, and when"
 * — so its files have no expiry, and an A5 PDF may be larger than an order picture.
 * Served from /a/<token>.<ext> (see a/[token].ts) with the type stored beside it.
 * Announcements are rare (a few a month), so the KV free plan's 1,000 writes a day and
 * 1 GB are not in question.
 */
export const DOC_MAX_BYTES = 5_000_000
export const DOC_KINDS: Record<string, { type: string; ext: string }> = {
  'ann-pdf': { type: 'application/pdf', ext: 'pdf' },
  'ann-image': { type: 'image/jpeg', ext: 'jpg' },
  'ann-preview': { type: 'image/jpeg', ext: 'jpg' },
}

/** The Firebase project whose users may upload. Pinned, not read from the token. */
export const PROJECT_ID = 'pzm-stock-x5'
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

export async function verifyFirebaseToken(header: string | null): Promise<string | null> {
  const m = header?.match(/^Bearer (.+)$/i)
  if (!m) return null
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}

export function demoKeyOk(req: Request, env: Env): boolean {
  const expected = (env.PO_IMAGE_DEMO_KEY ?? '').trim()
  if (!expected) return false
  const given = req.headers.get('x-demo-key') ?? ''
  return given.length === expected.length && given === expected
}

export function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
