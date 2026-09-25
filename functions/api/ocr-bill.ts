import { demoKeyOk, json, verifyFirebaseToken, type Env } from '../_poImage'

/**
 * POST /api/ocr-bill — { image: "data:image/jpeg;base64,…" } → { supplier, invoiceNo, date, lines }
 *
 * A supplier's delivery note or invoice read by Google's Gemini (Automation Plan Phase 4 —
 * owner, 25 Sep 2026). The key lives only here, as the Pages secret GEMINI_API_KEY; without
 * it the function answers 503 "not_configured" and no picture leaves the system. Setting the
 * key is the owner's decision to send bill pictures to Google.
 *
 * Signed-in users only (the same Firebase token check as po-image; the demo key on a demo
 * deployment). The answer is passed through as the model gave it — the app cleans and
 * checks it (src/lib/billOcr.ts), and a person confirms before anything is filed.
 */

interface OcrEnv extends Env {
  GEMINI_API_KEY?: string
  /** Optional override of the model, e.g. when Google retires the default. */
  GEMINI_MODEL?: string
}

const MAX_IMAGE_CHARS = 4_000_000
const DEFAULT_MODEL = 'gemini-2.5-flash'

const PROMPT = [
  'You read a supplier delivery note or invoice from a Thai restaurant supplier.',
  'Return JSON only, no prose, with this shape:',
  '{"supplier": string, "invoiceNo": string, "date": "YYYY-MM-DD", "lines": [{"name": string, "qty": number, "unit": string}]}',
  'supplier: the selling company name as printed. invoiceNo: the document/invoice/bill number.',
  'date: the document date; convert Thai Buddhist years (e.g. 2569) to Gregorian (2026).',
  'lines: one per product row, name exactly as printed, qty the delivered quantity as a number, unit as printed (KG, EA, Carton, Pack...).',
  'Leave a field empty or out when it is not on the page. Never invent rows.',
].join('\n')

export const onRequestPost: PagesFunction<OcrEnv> = async ({ request, env }) => {
  const uid = (await verifyFirebaseToken(request.headers.get('authorization'))) ?? (demoKeyOk(request, env) ? 'demo' : null)
  if (!uid) return json(401, { error: 'unauthorized' })
  const key = (env.GEMINI_API_KEY ?? '').trim()
  if (!key) return json(503, { error: 'not_configured' })

  let image = ''
  try {
    const body = (await request.json()) as { image?: unknown }
    image = typeof body.image === 'string' ? body.image : ''
  } catch {
    return json(400, { error: 'bad request' })
  }
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return json(415, { error: 'image data URL only' })
  if (image.length > MAX_IMAGE_CHARS) return json(413, { error: 'too large' })

  const model = (env.GEMINI_MODEL ?? '').trim() || DEFAULT_MODEL
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  })
  if (!res.ok) return json(502, { error: 'model', status: res.status })
  const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    return json(200, JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')))
  } catch {
    return json(502, { error: 'unreadable' })
  }
}

export const onRequest: PagesFunction<OcrEnv> = async ({ request }) =>
  request.method === 'POST' ? new Response(null, { status: 404 }) : new Response('method not allowed', { status: 405 })
