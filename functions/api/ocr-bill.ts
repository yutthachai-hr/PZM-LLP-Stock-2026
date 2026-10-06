import { demoKeyOk, json, verifyFirebaseToken, type Env } from '../_poImage'
import { pickReaderModel, type ListedModel } from '../_lib/geminiModel'

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
  'a supplier delivery note or invoice, a purchase/order list, a stock-count sheet (possibly handwritten), a transfer slip,',
  'or a screenshot of a chat message (LINE) in which someone lists what to order, one product per line, e.g. "Feta cheese 2 kg".',
  'Return JSON only, no prose, with this shape:',
  '{"supplier": string, "invoiceNo": string, "date": "YYYY-MM-DD", "lines": [{"name": string, "qty": number, "unit": string}]}',
  'supplier: the selling company name as printed. invoiceNo: the document/invoice/bill number.',
  'date: the document date; convert Thai Buddhist years (e.g. 2569) to Gregorian (2026).',
  'lines: one per product row, name exactly as printed (include the product code if one is printed beside it), qty the quantity on that row as a number (delivered, ordered, counted or transferred), unit as printed (KG, EA, Carton, Pack...).',
  'qty MUST be a JSON number (2, not "2 kg"); put the unit in "unit". Use exactly the key "lines".',
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

  const pinned = (env.GEMINI_MODEL ?? '').trim()
  let model = pinned || chosenModel || DEFAULT_MODEL
  let res = await generate(key, model, m[1], m[2])
  // The model was retired (Google answers 404 "no longer available"): ask which ones this key
  // can use, take the newest stable Flash, remember it, try once more.
  if (res.status === 404) {
    const next = await discoverModel(key)
    if (next && next !== model) {
      chosenModel = next
      model = next
      res = await generate(key, model, m[1], m[2])
    }
  }
  if (res.ok) {
    const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    // A second opinion on a picture the first model found nothing in (owner, 6 Oct 2026:
    // "ลองไปใช้โมเดลอื่น"): the Workers AI reader looks at it too, and the answer with lines wins.
    if (!lineCount(text) && env.AI && m[1] !== 'application/pdf') {
      const second = await fallback(env.AI, image)
      if (lineCount(second)) return reply(second, FALLBACK_MODEL)
    }
    return reply(text, model)
  }
  // Any other failure: a picture still has the Workers AI reader; a PDF does not.
  const detail = await errorDetail(res)
  if (env.AI && m[1] !== 'application/pdf') {
    const answer = await fallback(env.AI, image)
    if (answer) return reply(answer, FALLBACK_MODEL)
  }
  if (res.status === 429) return json(429, { error: 'quota', model })
  return json(502, { error: 'model', status: res.status, model, message: detail })
}

/** How many rows an answer holds, however it was shaped — 0 for none or unreadable. */
function lineCount(answer: unknown): number {
  let o: unknown = answer
  if (typeof answer === 'string') {
    const from = answer.indexOf('{')
    const to = answer.lastIndexOf('}')
    try {
      o = from >= 0 && to > from ? JSON.parse(answer.slice(from, to + 1)) : null
    } catch {
      return 0
    }
  }
  if (!o || typeof o !== 'object') return 0
  const r = o as Record<string, unknown>
  const list = r.lines ?? r.items ?? r.products ?? r.rows
  return Array.isArray(list) ? list.length : 0
}

/** Set once per isolate when discovery replaces a retired default. */
let chosenModel = ''

function generate(key: string, model: string, mime: string, data: string): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  })
}

async function discoverModel(key: string): Promise<string | null> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })
    if (!res.ok) return null
    const body = (await res.json()) as { models?: ListedModel[] }
    return pickReaderModel(body.models ?? [])
  } catch {
    return null
  }
}

/** Google's own error text (never the key), cut short — enough to say what went wrong. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } }
    return [body.error?.status, body.error?.message].filter(Boolean).join(': ').slice(0, 300)
  } catch {
    return ''
  }
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

function reply(answer: unknown, model: string): Response {
  if (answer && typeof answer === 'object') return json(200, { ...(answer as object), model })
  const text = String(answer)
  // The JSON object, whatever the model wrapped around it (prose, ```json fences).
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  try {
    if (from < 0 || to < from) throw new Error('no object')
    return json(200, { ...JSON.parse(text.slice(from, to + 1)), model })
  } catch {
    return json(502, { error: 'unreadable', model, message: text.slice(0, 200) })
  }
}

export const onRequest: PagesFunction<OcrEnv> = async ({ request }) =>
  request.method === 'POST' ? new Response(null, { status: 404 }) : new Response('method not allowed', { status: 405 })
