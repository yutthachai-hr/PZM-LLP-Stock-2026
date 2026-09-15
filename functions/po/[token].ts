import type { Env } from '../_poImage'

/** GET /po/<token>.jpg — the picture, or 404 once KV has let it expire. */
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const raw = Array.isArray(params.token) ? params.token[0] : params.token
  const token = (raw ?? '').replace(/\.jpg$/i, '')
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response('not found', { status: 404 })
  const data = await env.PO_IMAGES.get(token, { type: 'arrayBuffer' })
  if (!data) return new Response('not found', { status: 404 })
  return new Response(data, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}
