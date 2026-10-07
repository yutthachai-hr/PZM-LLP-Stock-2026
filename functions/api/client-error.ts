import { handleClientError } from '../_lib/clientError'

/** POST /api/client-error — E4, see functions/_lib/clientError.ts. Logs only; never Firestore. */
export const onRequestPost: PagesFunction = async ({ request }) => {
  const { status } = await handleClientError(request)
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}

export const onRequest: PagesFunction = async () => new Response(null, { status: 405, headers: { Allow: 'POST' } })
