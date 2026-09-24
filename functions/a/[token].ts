import { DOC_KINDS, type Env } from '../_poImage'

/**
 * GET /a/<token>.pdf|.jpg — an announcement's PDF or picture, as it was published.
 *
 * Public by design: the link goes into suppliers' LINE groups. What protects it is the
 * 32-hex random token, the same as an order picture. Served with the type it was stored
 * under, never guessed from the extension, and only for announcement kinds — an order
 * picture is not reachable here.
 */
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const raw = Array.isArray(params.token) ? params.token[0] : params.token
  const m = /^([0-9a-f]{32})\.(pdf|jpg)$/i.exec(raw ?? '')
  if (!m) return new Response('not found', { status: 404 })
  const { value, metadata } = await env.PO_IMAGES.getWithMetadata<{ kind?: string; type?: string }>(m[1], {
    type: 'arrayBuffer',
  })
  const kind = metadata?.kind ? DOC_KINDS[metadata.kind] : undefined
  if (!value || !kind || kind.ext !== m[2].toLowerCase()) return new Response('not found', { status: 404 })
  return new Response(value, {
    status: 200,
    headers: {
      'content-type': kind.type,
      'content-disposition': 'inline',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  })
}
