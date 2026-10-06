import { demoKeyOk, json, verifyFirebaseToken, type Env } from '../_poImage'

/**
 * POST /api/ocr-bill — { image: "data:image/jpeg;base64,…" | "data:application/pdf;base64,…" } → { supplier, invoiceNo, date, lines }
 *
 * Since 6 Oct 2026 any document that lists products and quantities, not only a bill: an
 * order list, a count sheet, a transfer slip — as a photo or a PDF (Gemini reads PDFs
 * directly; the Workers AI fallback takes pictures only).
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
  /** Workers AI binding (wrangler.toml [ai]) — fallback when Gemini's free quota runs out (429). */
  AI?: Ai
}

const MAX_IMAGE_CHARS = 4_000_000
const DEFAULT_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'

const PROMPT = [
  'You read a document from a Thai restaurant business that lists products and quantities:',
  'a supplier delivery note or invoice, a purchase/order list, a stock-count sheet (possibly handwritten), or a transfer slip.',
  'Return JSON only, no prose, with this shape:',
  '{"supplier": string, "invoiceNo": string, "date": "YYYY-MM-DD", "lines": [{"name": string, "qty": number, "unit": string}]}',
  'supplier: the selling company name as printed. invoiceNo: the document/invoice/bill number.',
  'date: the document date; convert Thai Buddhist years (e.g. 2569) to Gregorian (2026).',
  'lines: one per product row, name exactly as printed (include the product code if one is printed beside it), qty the quantity on that row as a number (delivered, ordered, counted or transferred), unit as printed (KG, EA, Carton, Pack...).',
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
  const m = image.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return json(415, { error: 'image or PDF data URL only' })
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
  // The fallback model reads pictures only; a PDF waits for Gemini's quota to come back.
  if (res.status === 429 && env.AI && m[1] !== 'application/pdf') return reply(await fallback(env.AI, image))
  if (res.status === 429) return json(429, { error: 'quota' })
  if (!res.ok) return json(502, { error: 'model', status: res.status })
  const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return reply(out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '')
}

/** Gemini's free tier is out for the day/minute — ask Workers AI (10k neurons/day free) instead. */
async function fallback(ai: Ai, image: string): Promise<unknown> {
  try {
    const out = (await ai.run(FALLBACK_MODEL as Parameters<Ai['run']>[0], {
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: image } }] }],
      max_tokens: 2048,
      temperature: 0,
    } as never)) as { response?: unknown }
    return out.response ?? ''
  } catch {
    return ''
  }
}

function reply(answer: unknown): Response {
  if (answer && typeof answer === 'object') return json(200, answer)
  try {
    return json(200, JSON.parse(String(answer).replace(/^[\s\S]*?(?=\{)|(?<=\})[^}]*$/g, '')))
  } catch {
    return json(502, { error: 'unreadable' })
  }
}

export const onRequest: PagesFunction<OcrEnv> = async ({ request }) =>
  request.method === 'POST' ? new Response(null, { status: 404 }) : new Response('method not allowed', { status: 405 })
