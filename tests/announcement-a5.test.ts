// The A5 announcement: the page it is printed on, the overflow check, and where its files
// are kept.
//
//   npm test
//
// The sheet itself is drawn by the browser (html2canvas is not run here); what is pinned
// is what the rest of the feature relies on: A5 portrait at 148 × 210 mm, one picture edge
// to edge, an overflowing body caught before it is published, and files that are kept
// without expiry and served back with the type they were stored under.

import { describe, expect, test } from 'vitest'
import { A5_MM, A5_PX, a5PdfFromJpeg, bodyFits } from '../src/lib/a5'
import { onRequestPost } from '../functions/api/po-image'
import { onRequestGet } from '../functions/a/[token]'
import { DOC_MAX_BYTES } from '../functions/_poImage'

describe('the page', () => {
  test('is A5 portrait, and the on-screen sheet has the same proportions', () => {
    expect(A5_MM).toEqual({ width: 148, height: 210 })
    expect(A5_PX.width / A5_PX.height).toBeCloseTo(148 / 210, 2)
  })

  test('a body that overflows its box is caught; one that fits is not', () => {
    expect(bodyFits(400, 400)).toBe(true)
    expect(bodyFits(401, 400)).toBe(true) // sub-pixel rounding
    expect(bodyFits(460, 400)).toBe(false)
  })

  test('the PDF is one A5 page holding the picture edge to edge', async () => {
    const calls: unknown[][] = []
    class FakePdf {
      opts: unknown
      constructor(opts: unknown) {
        this.opts = opts
        calls.push(['new', opts])
      }
      setProperties(p: Record<string, string>) {
        calls.push(['props', p])
      }
      addImage(_data: Uint8Array, format: string, x: number, y: number, w: number, h: number) {
        calls.push(['image', format, x, y, w, h])
      }
      output() {
        return new Uint8Array([37, 80, 68, 70]).buffer
      }
    }
    const pdf = await a5PdfFromJpeg(new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }), { title: 'PZM-ANN-2569-0001', author: 'Pizza Mania' }, FakePdf)
    expect(pdf.type).toBe('application/pdf')
    expect(calls[0]).toEqual(['new', { orientation: 'portrait', unit: 'mm', format: 'a5' }])
    expect(calls).toContainEqual(['image', 'JPEG', 0, 0, 148, 210])
    expect(calls).toContainEqual(['props', { title: 'PZM-ANN-2569-0001', author: 'Pizza Mania', creator: 'Inventory Pzm' }])
  })

  test('the real jsPDF produces an A5 PDF from a picture', async () => {
    // A 1×1 white JPEG.
    const jpeg = Uint8Array.from(
      atob(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      ),
      (c) => c.charCodeAt(0),
    )
    const pdf = await a5PdfFromJpeg(new Blob([jpeg], { type: 'image/jpeg' }), { title: 't', author: 'a' })
    const text = new TextDecoder('latin1').decode(new Uint8Array(await pdf.arrayBuffer()))
    expect(text.startsWith('%PDF')).toBe(true)
    // 148 × 210 mm in PDF points.
    const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!
    expect(Number(box[1])).toBeCloseTo(419.53, 1)
    expect(Number(box[2])).toBeCloseTo(595.28, 1)
  })
})

// A KV namespace in memory, enough for put / get / getWithMetadata.
function kv() {
  const store = new Map<string, { value: ArrayBuffer; opts: { expirationTtl?: number; metadata?: unknown } }>()
  return {
    store,
    async put(key: string, value: ArrayBuffer, opts: { expirationTtl?: number; metadata?: unknown } = {}) {
      store.set(key, { value, opts })
    },
    async get(key: string) {
      return store.get(key)?.value ?? null
    },
    async getWithMetadata(key: string) {
      const hit = store.get(key)
      return { value: hit?.value ?? null, metadata: hit?.opts.metadata ?? null }
    },
  }
}

const env = (ns = kv()) => ({ PO_IMAGES: ns, PO_IMAGE_DEMO_KEY: 'demo-key' })

function post(kind: string, type: string, body: Uint8Array, key = 'demo-key') {
  return new Request(`https://pzm.example/api/po-image?kind=${kind}&po=a1`, {
    method: 'POST',
    headers: { 'content-type': type, 'x-demo-key': key },
    body,
  })
}

// Pages Functions receive a context object; only the fields these handlers read are given.
type Ctx = Parameters<typeof onRequestPost>[0]
const ctx = (request: Request, e: ReturnType<typeof env>, params: Record<string, string> = {}) =>
  ({ request, env: e, params }) as unknown as Ctx

describe('the file host', () => {
  test('keeps an announcement PDF without expiry and hands back an /a/ link', async () => {
    const e = env()
    const res = await onRequestPost(ctx(post('ann-pdf', 'application/pdf', new Uint8Array([37, 80, 68, 70])), e))
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    expect(url).toMatch(/^https:\/\/pzm\.example\/a\/[0-9a-f]{32}\.pdf$/)
    const [stored] = [...e.PO_IMAGES.store.values()]
    expect(stored.opts.expirationTtl).toBeUndefined()
  })

  test('an order picture still expires after seven days', async () => {
    const e = env()
    await onRequestPost(ctx(post('original', 'image/jpeg', new Uint8Array([255, 216])), e))
    const [stored] = [...e.PO_IMAGES.store.values()]
    expect(stored.opts.expirationTtl).toBe(7 * 86_400)
  })

  test('refuses the wrong type, an empty body, and a missing key', async () => {
    const e = env()
    expect((await onRequestPost(ctx(post('ann-pdf', 'image/jpeg', new Uint8Array([1])), e))).status).toBe(415)
    expect((await onRequestPost(ctx(post('ann-pdf', 'application/pdf', new Uint8Array([])), e))).status).toBe(413)
    expect((await onRequestPost(ctx(post('ann-pdf', 'application/pdf', new Uint8Array([1]), 'wrong'), e))).status).toBe(401)
    expect(DOC_MAX_BYTES).toBe(5_000_000)
  })

  test('serves it back with the type it was stored under, and only announcement files', async () => {
    const e = env()
    const up = await onRequestPost(ctx(post('ann-pdf', 'application/pdf', new Uint8Array([37, 80, 68, 70])), e))
    const token = ((await up.json()) as { url: string }).url.split('/a/')[1]
    const got = await onRequestGet(ctx(new Request(`https://pzm.example/a/${token}`), e, { token }))
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('application/pdf')
    // The same token asked for as a picture is not found: the extension must match.
    const asJpg = token.replace('.pdf', '.jpg')
    expect((await onRequestGet(ctx(new Request('https://x'), e, { token: asJpg }))).status).toBe(404)
    // An order picture is not reachable through the announcement route.
    const po = await onRequestPost(ctx(post('original', 'image/jpeg', new Uint8Array([255, 216])), e))
    const poToken = ((await po.json()) as { url: string }).url.split('/po/')[1]
    expect((await onRequestGet(ctx(new Request('https://x'), e, { token: poToken }))).status).toBe(404)
  })
})
