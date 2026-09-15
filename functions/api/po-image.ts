import { MAX_BYTES, TTL_SECONDS, demoKeyOk, json, randomToken, verifyFirebaseToken, type Env } from '../_poImage'

/** POST /api/po-image?kind=original|preview&po=<tag> — body image/jpeg → { url, expiresAt }. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const uid = (await verifyFirebaseToken(request.headers.get('authorization'))) ?? (demoKeyOk(request, env) ? 'demo' : null)
  if (!uid) return json(401, { error: 'unauthorized' })

  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') === 'preview' ? 'preview' : 'original'
  const po = (url.searchParams.get('po') ?? '').slice(0, 120)
  if (!request.headers.get('content-type')?.startsWith('image/jpeg')) return json(415, { error: 'jpeg only' })
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) return json(413, { error: 'too large' })
  const body = await request.arrayBuffer()
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json(413, { error: 'too large' })

  const token = randomToken()
  const expiresAt = Date.now() + TTL_SECONDS * 1000
  await env.PO_IMAGES.put(token, body, { expirationTtl: TTL_SECONDS, metadata: { uid, po, kind, expiresAt } })
  return json(200, { url: `${url.origin}/po/${token}.jpg`, expiresAt })
}

export const onRequest: PagesFunction<Env> = async ({ request }) =>
  request.method === 'POST' ? new Response(null, { status: 404 }) : new Response('method not allowed', { status: 405 })
