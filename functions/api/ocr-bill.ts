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

export interface OcrTrace {
  fileType: string
  sizeBytes: number
  model: string
  retries: number
  upstreamStatus?: number
  durations: {
    modelMs: number
    fallbackMs?: number
    parseMs?: number
    totalMs: number
  }
}

const MAX_IMAGE_CHARS = 4_000_000
const DEFAULT_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'
const MAX_RETRIES = 2
const PER_ATTEMPT_TIMEOUT_MS = 40_000
const AGGREGATE_TIMEOUT_MS = 75_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function retryDelay(attempt: number): number {
  const base = 500 * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * (base / 2))
  return base + jitter
}

function isTransient(status: number): boolean {
  return status === 503 || status === 500 || status === 504
}

function createAttemptSignal(
  parentSignal?: AbortSignal,
  timeoutMs = PER_ATTEMPT_TIMEOUT_MS,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  }, timeoutMs)

  let onParentAbort: (() => void) | undefined
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer)
      controller.abort(parentSignal.reason)
    } else {
      onParentAbort = () => {
        clearTimeout(timer)
        controller.abort(parentSignal.reason)
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (parentSignal && onParentAbort) {
        parentSignal.removeEventListener('abort', onParentAbort)
      }
    },
  }
}

async function safeReadJson<T>(
  res: Response,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<{ data: T | null; isTimeout?: boolean }> {
  const { signal: timeoutSignal, cleanup } = createAttemptSignal(signal, timeoutMs)
  let timedOut = false
  try {
    const jsonPromise = res.json() as Promise<T>
    const abortPromise = new Promise<never>((_, reject) => {
      timeoutSignal.addEventListener(
        'abort',
        () => {
          timedOut = true
          reject(timeoutSignal.reason ?? new DOMException('Timeout', 'TimeoutError'))
        },
        { once: true },
      )
    })
    const data = await Promise.race([jsonPromise, abortPromise])
    return { data }
  } catch {
    return { data: null, isTimeout: timedOut }
  } finally {
    cleanup()
  }
}

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
  const t0 = Date.now()
  const deadline = t0 + AGGREGATE_TIMEOUT_MS
  const getRemainingMs = () => deadline - Date.now()

  const serverController = new AbortController()
  const serverTimer = setTimeout(() => {
    serverController.abort(new DOMException('Aggregate timeout', 'TimeoutError'))
  }, AGGREGATE_TIMEOUT_MS)

  let onClientAbort: (() => void) | undefined
  if (request.signal) {
    if (request.signal.aborted) {
      serverController.abort(request.signal.reason)
    } else {
      onClientAbort = () => serverController.abort(request.signal.reason)
      request.signal.addEventListener('abort', onClientAbort, { once: true })
    }
  }

  try {
    const uid = (await verifyFirebaseToken(request.headers.get('authorization'))) ?? (demoKeyOk(request, env) ? 'demo' : null)
    if (!uid) return json(401, { error: 'unauthorized' })
    const key = (env.GEMINI_API_KEY ?? '').trim()
    if (!key) return json(503, { error: 'not_configured' })

    let image = ''
    try {
      const body = (await request.json()) as { image?: unknown }
      image = typeof body.image === 'string' ? body.image : ''
    } catch {
      return json(400, { error: 'bad_request' })
    }
    const m = image.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/)
    if (!m) return json(415, { error: 'invalid_format' })
    if (image.length > MAX_IMAGE_CHARS) return json(413, { error: 'too_large' })

    const mime = m[1]
    const data = m[2]
    const sizeBytes = Math.round(data.length * 0.75)
    const pinned = (env.GEMINI_MODEL ?? '').trim()
    let model = pinned || chosenModel || DEFAULT_MODEL

    let res: Response | null = null
    let retries = 0
    let lastErr: unknown = null
    let modelMs = 0

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (getRemainingMs() <= 0) {
        lastErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        break
      }
      if (attempt > 0) {
        retries++
        const delay = retryDelay(attempt - 1)
        if (delay >= getRemainingMs()) {
          lastErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
          break
        }
        await sleep(delay)
        if (getRemainingMs() <= 0) {
          lastErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
          break
        }
      }

      const attemptBudget = Math.min(PER_ATTEMPT_TIMEOUT_MS, getRemainingMs())
      if (attemptBudget <= 0) {
        lastErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        break
      }
      const { signal: attemptSignal, cleanup: cleanupAttempt } = createAttemptSignal(serverController.signal, attemptBudget)
      const attemptT0 = Date.now()
      lastErr = null

      try {
        res = await generate(key, model, mime, data, attemptSignal)
        modelMs += Date.now() - attemptT0
      } catch (err) {
        modelMs += Date.now() - attemptT0
        lastErr = err
        res = null
        cleanupAttempt()
        if (attempt < MAX_RETRIES && getRemainingMs() > 0) continue
        break
      } finally {
        cleanupAttempt()
      }

      // The model was retired (Google answers 404 "no longer available"): ask which ones this key
      // can use, take the newest stable Flash, remember it, try once more.
      if (res.status === 404) {
        const discoverBudget = Math.min(PER_ATTEMPT_TIMEOUT_MS, getRemainingMs())
        if (discoverBudget <= 0) {
          lastErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
          break
        }
        const next = await discoverModel(key, serverController.signal, discoverBudget)
        if (next && next !== model) {
          chosenModel = next
          model = next
          const retryBudget = Math.min(PER_ATTEMPT_TIMEOUT_MS, getRemainingMs())
          if (retryBudget <= 0) {
            lastErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
            break
          }
          const { signal: discoverSignal, cleanup: cleanupDiscover } = createAttemptSignal(serverController.signal, retryBudget)
          const discoverT0 = Date.now()
          try {
            res = await generate(key, model, mime, data, discoverSignal)
            modelMs += Date.now() - discoverT0
          } catch (err) {
            modelMs += Date.now() - discoverT0
            lastErr = err
            res = null
          } finally {
            cleanupDiscover()
          }
        }
      }

      if (res && res.ok) break
      if (res && isTransient(res.status)) {
        if (attempt < MAX_RETRIES && getRemainingMs() > 0) continue
        break
      }
      // Non-transient errors (400, 401, 413, 415, 429) must never retry
      break
    }

    if (res && res.ok) {
      const parseT0 = Date.now()
      const remaining = getRemainingMs()
      if (remaining <= 0) {
        const trace: OcrTrace = {
          fileType: mime,
          sizeBytes,
          model,
          retries,
          upstreamStatus: 504,
          durations: { modelMs, parseMs: 0, totalMs: Date.now() - t0 },
        }
        console.info('[ocr-bill]', JSON.stringify(trace))
        return json(504, { error: 'upstream_timeout', upstreamStatus: 504, model, message: 'Upstream body read timed out', trace })
      }

      const { data: out, isTimeout: bodyTimeout } = await safeReadJson<{
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }>(res, serverController.signal, Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining))
      const parseMs = Date.now() - parseT0

      if (bodyTimeout || getRemainingMs() <= 0) {
        const trace: OcrTrace = {
          fileType: mime,
          sizeBytes,
          model,
          retries,
          upstreamStatus: 504,
          durations: { modelMs, parseMs, totalMs: Date.now() - t0 },
        }
        console.info('[ocr-bill]', JSON.stringify(trace))
        return json(504, { error: 'upstream_timeout', upstreamStatus: 504, model, message: 'Upstream body read timed out', trace })
      }

      if (!out || !out.candidates || !out.candidates.length) {
        // Malformed upstream envelope on HTTP 200 -> typed unreadable
        const trace: OcrTrace = {
          fileType: mime,
          sizeBytes,
          model,
          retries,
          upstreamStatus: res.status,
          durations: { modelMs, parseMs, totalMs: Date.now() - t0 },
        }
        console.info('[ocr-bill]', JSON.stringify(trace))
        return json(502, { error: 'unreadable', model, message: 'Invalid response envelope from upstream model', trace })
      }

      const text = out.candidates[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''

      // A second opinion on a picture the first model found nothing in
      let fallbackMs: number | undefined
      if (!lineCount(text) && env.AI && mime !== 'application/pdf') {
        const fbBudget = Math.min(25_000, getRemainingMs())
        if (fbBudget <= 0) {
          lastErr = new DOMException('Aggregate timeout', 'TimeoutError')
        } else {
          const fbT0 = Date.now()
          const { answer: second, timedOut } = await fallback(env.AI, image, serverController.signal, fbBudget)
          fallbackMs = Date.now() - fbT0
          if (timedOut) {
            lastErr = new DOMException('Aggregate timeout', 'TimeoutError')
          } else if (lineCount(second)) {
            const trace: OcrTrace = {
              fileType: mime,
              sizeBytes,
              model: FALLBACK_MODEL,
              retries,
              upstreamStatus: res.status,
              durations: { modelMs, fallbackMs, parseMs, totalMs: Date.now() - t0 },
            }
            console.info('[ocr-bill]', JSON.stringify(trace))
            return reply(second, FALLBACK_MODEL, trace)
          }
        }
      }

      const trace: OcrTrace = {
        fileType: mime,
        sizeBytes,
        model,
        retries,
        upstreamStatus: res.status,
        durations: { modelMs, fallbackMs, parseMs, totalMs: Date.now() - t0 },
      }
      console.info('[ocr-bill]', JSON.stringify(trace))
      return reply(text, model, trace)
    }

    // Any other failure: a picture still has the Workers AI reader; a PDF does not.
    let fallbackMs: number | undefined
    if (env.AI && mime !== 'application/pdf') {
      const fbBudget = Math.min(25_000, getRemainingMs())
      if (fbBudget <= 0) {
        lastErr = new DOMException('Aggregate timeout', 'TimeoutError')
      } else {
        const fbT0 = Date.now()
        const { answer, timedOut } = await fallback(env.AI, image, serverController.signal, fbBudget)
        fallbackMs = Date.now() - fbT0
        if (timedOut) {
          lastErr = new DOMException('Aggregate timeout', 'TimeoutError')
        } else if (answer && lineCount(answer)) {
          const trace: OcrTrace = {
            fileType: mime,
            sizeBytes,
            model: FALLBACK_MODEL,
            retries,
            upstreamStatus: res?.status,
            durations: { modelMs, fallbackMs, totalMs: Date.now() - t0 },
          }
          console.info('[ocr-bill]', JSON.stringify(trace))
          return reply(answer, FALLBACK_MODEL, trace)
        }
      }
    }

    const remainingForError = Math.min(5000, Math.max(0, getRemainingMs()))
    const detail = res ? await errorDetail(res, remainingForError) : lastErr instanceof Error ? lastErr.message : 'network error'
    const isTimeout =
      (lastErr instanceof DOMException && lastErr.name === 'TimeoutError') ||
      (lastErr instanceof Error && /timeout/i.test(lastErr.message)) ||
      serverController.signal.aborted ||
      getRemainingMs() <= 0 ||
      res?.status === 504

    const trace: OcrTrace = {
      fileType: mime,
      sizeBytes,
      model,
      retries,
      upstreamStatus: res?.status ?? (isTimeout ? 504 : undefined),
      durations: { modelMs, fallbackMs, totalMs: Date.now() - t0 },
    }
    console.info('[ocr-bill]', JSON.stringify(trace))

    if (isTimeout) {
      return json(504, { error: 'upstream_timeout', upstreamStatus: 504, model, message: detail, trace })
    }
    if (res && res.status === 429) {
      return json(429, { error: 'quota', upstreamStatus: 429, model, message: detail, trace })
    }
    if (res && res.status === 503) {
      return json(503, { error: 'model_unavailable', upstreamStatus: 503, model, message: detail, trace })
    }
    if (res && res.status === 400) {
      return json(400, { error: 'bad_request', upstreamStatus: 400, model, message: detail, trace })
    }

    return json(502, { error: 'model_unavailable', upstreamStatus: res?.status ?? 502, model, message: detail, trace })
  } finally {
    clearTimeout(serverTimer)
    if (request.signal && onClientAbort) {
      request.signal.removeEventListener('abort', onClientAbort)
    }
  }
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

function generate(key: string, model: string, mime: string, data: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
    signal,
  })
}

async function discoverModel(key: string, parentSignal?: AbortSignal, maxMs = 10_000): Promise<string | null> {
  const { signal, cleanup } = createAttemptSignal(parentSignal, maxMs)
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key },
      signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as { models?: ListedModel[] }
    return pickReaderModel(body.models ?? [])
  } catch {
    return null
  } finally {
    cleanup()
  }
}

/** Google's own error text (never the key), cut short — enough to say what went wrong. */
async function errorDetail(res: Response, maxMs = 5000): Promise<string> {
  try {
    const { data: body } = await safeReadJson<{ error?: { message?: string; status?: string } }>(res, undefined, maxMs)
    if (!body?.error) return `HTTP ${res.status}`
    return [body.error.status, body.error.message].filter(Boolean).join(': ').slice(0, 200)
  } catch {
    return `HTTP ${res.status}`
  }
}

/** Gemini's free tier is out for the day/minute — ask Workers AI (10k neurons/day free) instead. */
async function fallback(
  ai: Ai,
  image: string,
  parentSignal?: AbortSignal,
  maxMs = 25_000,
): Promise<{ answer: unknown; timedOut: boolean }> {
  const { signal, cleanup } = createAttemptSignal(parentSignal, maxMs)
  try {
    const runPromise = ai.run(FALLBACK_MODEL as Parameters<Ai['run']>[0], {
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: image } }] }],
      max_tokens: 2048,
      temperature: 0,
    } as never) as Promise<{ response?: unknown }>
    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Timeout', 'TimeoutError')), { once: true })
    })
    const out = await Promise.race([runPromise, abortPromise])
    return { answer: out.response ?? '', timedOut: false }
  } catch (err) {
    const isTimeout =
      signal.aborted ||
      (err instanceof DOMException && err.name === 'TimeoutError') ||
      (err instanceof Error && /timeout/i.test(err.message))
    return { answer: '', timedOut: Boolean(isTimeout) }
  } finally {
    cleanup()
  }
}

function reply(answer: unknown, model: string, trace?: OcrTrace): Response {
  if (answer && typeof answer === 'object') return json(200, { ...(answer as object), model, trace })
  const text = String(answer)
  // The JSON object, whatever the model wrapped around it (prose, ```json fences).
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  try {
    if (from < 0 || to < from) throw new Error('no object')
    return json(200, { ...JSON.parse(text.slice(from, to + 1)), model, trace })
  } catch {
    return json(502, { error: 'unreadable', model, message: 'Invalid JSON response from model', trace })
  }
}

export const onRequest: PagesFunction<OcrEnv> = async ({ request }) =>
  request.method === 'POST' ? new Response(null, { status: 404 }) : new Response('method not allowed', { status: 405 })
