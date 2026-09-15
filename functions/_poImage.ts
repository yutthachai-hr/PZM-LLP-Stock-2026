import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Order-sheet picture hosting for Cloudflare Pages — the same contract as
 * netlify/functions/po-image.mts, over a KV namespace instead of Netlify Blobs.
 *
 *   POST /api/po-image?kind=original|preview&po=<tag>   (see api/po-image.ts)
 *   GET  /po/<token>.jpg                                 (see po/[token].ts)
 *
 * The app is told where to POST through VITE_PO_IMAGE_HOST=/api/po-image on this host;
 * the GET path is the same on both hosts, so the URLs handed to LINE never change shape.
 *
 * KV gives the pictures a real TTL (`expirationTtl`), so unlike the Blobs version there
 * is no lazy expiry: an expired key is simply gone. The KV free plan allows 1,000 writes
 * a day — one sheet is two writes (original + preview), so that is 500 sheets a day.
 *
 * Nothing in the app knows which host it is on. Keep the two implementations in step:
 * `tests/image-host.test.ts` pins the shared constants against each other.
 */

export interface Env {
  PO_IMAGES: KVNamespace
  /** Demo deployments only: a shared key accepted in place of a Firebase token. */
  PO_IMAGE_DEMO_KEY?: string
}

export const MAX_BYTES = 1_500_000
export const TTL_SECONDS = 7 * 86_400

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
