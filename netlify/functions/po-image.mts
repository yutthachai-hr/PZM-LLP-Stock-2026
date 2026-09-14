import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Hosts order-sheet pictures for LINE to fetch.
 *
 * A LINE image message carries URLs, and LINE's servers fetch the picture from them, so a
 * sheet has to sit somewhere public for a while. This is that somewhere: the site's own
 * function, backed by Netlify Blobs, on the same free plan as the rest of the site.
 *
 *   POST /.netlify/functions/po-image?kind=original|preview&po=<tag>
 *        body: image/jpeg, ≤ MAX_BYTES; Authorization: Bearer <Firebase ID token>
 *        → { url }             an absolute https URL under /po/
 *   GET  /po/<token>.jpg      → the picture, or 404 once it has expired
 *
 * Who may upload: anyone holding a valid ID token for the app's own Firebase project —
 * verified here against Google's public keys, never trusted from a header. A demo build has
 * no Firebase user, so a deployment with PO_IMAGE_DEMO_KEY set accepts that key in an
 * `x-demo-key` header instead. That variable must not exist on production.
 *
 * Who may read: anyone with the URL. The token is 128 random bits, so the URL is the
 * secret, and it stops working after TTL_DAYS. A picture of a purchase order is what the
 * supplier is sent anyway; what this protects against is enumeration.
 *
 * Moving to Cloudflare: the same two routes over a KV binding with `expirationTtl`, and
 * `verifyFirebaseToken` unchanged. Nothing in the app knows this is Netlify.
 */

const MAX_BYTES = 1_500_000
const TTL_DAYS = 7
const STORE = 'po-images'

/** The Firebase project whose users may upload. Pinned, not read from the token. */
const PROJECT_ID = 'pzm-stock-x5'
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

async function verifyFirebaseToken(header: string | null): Promise<string | null> {
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

function demoKeyOk(req: Request): boolean {
  const expected = (process.env.PO_IMAGE_DEMO_KEY ?? '').trim()
  if (!expected) return false
  const given = req.headers.get('x-demo-key') ?? ''
  // Constant-time-ish compare is not worth much for a demo key, but do not leak length.
  return given.length === expected.length && given === expected
}

function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function upload(req: Request): Promise<Response> {
  const uid = (await verifyFirebaseToken(req.headers.get('authorization'))) ?? (demoKeyOk(req) ? 'demo' : null)
  if (!uid) return json(401, { error: 'unauthorized' })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') === 'preview' ? 'preview' : 'original'
  const po = (url.searchParams.get('po') ?? '').slice(0, 120)
  if (!req.headers.get('content-type')?.startsWith('image/jpeg')) return json(415, { error: 'jpeg only' })
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) return json(413, { error: 'too large' })
  const body = await req.arrayBuffer()
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json(413, { error: 'too large' })

  const token = randomToken()
  const expiresAt = Date.now() + TTL_DAYS * 86_400_000
  await getStore(STORE).set(token, body, { metadata: { uid, po, kind, expiresAt } })
  return json(200, { url: `${url.origin}/po/${token}.jpg`, expiresAt })
}

async function serve(token: string): Promise<Response> {
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response('not found', { status: 404 })
  const store = getStore(STORE)
  const hit = await store.getWithMetadata(token, { type: 'arrayBuffer' })
  if (!hit) return new Response('not found', { status: 404 })
  const expiresAt = Number(hit.metadata.expiresAt ?? 0)
  if (expiresAt && Date.now() > expiresAt) {
    // Lazy expiry: Blobs has no TTL of its own, so the first fetch after the deadline
    // removes it. Nothing lists the store, so an unfetched picture simply sits there.
    await store.delete(token)
    return new Response('gone', { status: 410 })
  }
  return new Response(hit.data, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  if (req.method === 'POST') return upload(req)
  if (req.method === 'GET') {
    const token = (context.params.token ?? '').replace(/\.jpg$/i, '')
    return serve(token)
  }
  return new Response('method not allowed', { status: 405 })
}

export const config: Config = {
  path: ['/.netlify/functions/po-image', '/po/:token'],
}
