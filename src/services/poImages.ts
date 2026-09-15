import { BACKEND_MODE } from '../backend'
import { AppError } from '../i18n/AppError'

/**
 * Hosting an order sheet's picture where LINE can fetch it.
 *
 * A LINE image message is two URLs, not a file: LINE's servers fetch the picture from
 * wherever it is hosted, so the picture has to sit on a public HTTPS address for a while.
 * Firebase's free plan gives this project no Storage bucket, so the site's own serverless
 * function keeps it (netlify/functions/po-image.ts) — under a random, unguessable token,
 * for a few days, then gone.
 *
 * The caller proves who they are with their Firebase ID token; the function checks it
 * against Google's public keys. A demo build has no Firebase user, so a demo deployment
 * accepts a shared key instead (VITE_PO_IMAGE_DEMO_KEY) — never set on production.
 *
 * Kept deliberately small and behind one function so that moving the host (to Cloudflare
 * Pages Functions + KV, which the owner is planning) is a change to this file and the
 * function, and to nothing that decides what an order is.
 */

export interface HostedImage {
  url: string
  previewUrl: string
  /** Which rendering this is, for the order to record what was sent. */
  version: number
  /** When the host will stop serving it, ms epoch. */
  expiresAt: number
}

/**
 * Where the function lives on each host. The same code is deployed to Netlify (functions
 * under /.netlify/functions/) and to Cloudflare Pages (functions under /api/), and
 * Cloudflare Pages will not take build-time variables from its dashboard once a
 * wrangler.toml exists — so the host is recognised here, and VITE_PO_IMAGE_HOST only
 * overrides it.
 */
function defaultHost(): string {
  if (typeof location !== 'undefined' && /\.pages\.dev$/.test(location.hostname)) return '/api/po-image'
  return '/.netlify/functions/po-image'
}

function host(): string {
  return (import.meta.env.VITE_PO_IMAGE_HOST ?? '').trim() || defaultHost()
}

/**
 * Whether there is anywhere to put a picture from here.
 *
 * On localhost there is no function to call, so the answer is no and the share button
 * uses the phone's own share sheet instead (the picture is handed over as a file, which
 * needs no hosting). Elsewhere the function is assumed present; if it is not, the upload
 * fails with a plain message and the person can still download the picture.
 */
export function imageHostAvailable(): boolean {
  if (typeof location === 'undefined') return false
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return !!import.meta.env.VITE_PO_IMAGE_HOST
  return true
}

async function authHeader(): Promise<Record<string, string>> {
  if (BACKEND_MODE === 'local') {
    const key = (import.meta.env.VITE_PO_IMAGE_DEMO_KEY ?? '').trim()
    if (!key) throw new AppError('เครื่องนี้ยังไม่ได้ตั้งค่าที่เก็บรูปสำหรับส่ง LINE')
    return { 'x-demo-key': key }
  }
  const { getAuthInstance } = await import('../firebase/app')
  const user = getAuthInstance().currentUser
  if (!user) throw new AppError('กรุณาเข้าสู่ระบบใหม่')
  return { authorization: `Bearer ${await user.getIdToken()}` }
}

async function put(path: string, blob: Blob, headers: Record<string, string>): Promise<string> {
  const res = await fetch(`${host()}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/jpeg' },
    body: blob,
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AppError('กรุณาเข้าสู่ระบบใหม่')
    if (res.status === 413) throw new AppError('รูปใหญ่เกินไป')
    throw new AppError('อัปโหลดรูปไม่สำเร็จ ({status})', { status: res.status })
  }
  const body = (await res.json()) as { url?: string }
  if (!body.url) throw new AppError('อัปโหลดรูปไม่สำเร็จ ({status})', { status: res.status })
  return body.url
}

/**
 * Put one sheet's picture (and its small preview) where LINE can fetch them.
 *
 * `version` is the caller's count of renderings of this order; it travels back so the
 * order can say which picture was sent.
 */
export async function uploadPoImage(params: {
  poId: string
  original: Blob
  preview: Blob
  version: number
}): Promise<HostedImage> {
  const headers = await authHeader()
  const tag = `${encodeURIComponent(params.poId)}-${params.version}`
  const [url, previewUrl] = await Promise.all([
    put(`?kind=original&po=${tag}`, params.original, headers),
    put(`?kind=preview&po=${tag}`, params.preview, headers),
  ])
  return { url, previewUrl, version: params.version, expiresAt: Date.now() + TTL_MS }
}

/** How long the host keeps a picture. Long enough to resend on Monday what was made Friday. */
export const TTL_MS = 7 * 86_400_000
