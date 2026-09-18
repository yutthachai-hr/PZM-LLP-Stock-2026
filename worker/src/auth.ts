/**
 * A Google access token from the service-account key, with nothing but WebCrypto.
 *
 * The key is the JSON Google gives when a key is created for the service account; it
 * lives in the Worker as the secret FIREBASE_SERVICE_ACCOUNT and nowhere else. The
 * account should hold only `roles/datastore.user` — enough to read and write documents,
 * not to change rules, indexes or anything else in the project.
 */

export interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
  token_uri?: string
}

const SCOPE = 'https://www.googleapis.com/auth/datastore'
const TOKEN_URI = 'https://oauth2.googleapis.com/token'

let cached: { token: string; exp: number; email: string } | null = null

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))

export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set')
  const sa = JSON.parse(raw) as ServiceAccount
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing fields')
  return sa
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

/** The signed assertion Google exchanges for a token. Exported for the tests. */
export async function signAssertion(sa: ServiceAccount, nowSec: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = { iss: sa.client_email, scope: SCOPE, aud: sa.token_uri ?? TOKEN_URI, iat: nowSec, exp: nowSec + 3600 }
  const unsigned = `${b64urlJson(header)}.${b64urlJson(claims)}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(sa.private_key), new TextEncoder().encode(unsigned))
  return `${unsigned}.${b64url(sig)}`
}

export async function accessToken(sa: ServiceAccount, fetcher: typeof fetch = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.email === sa.client_email && cached.exp - 60 > now) return cached.token
  const res = await fetcher(sa.token_uri ?? TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signAssertion(sa, now) }),
  })
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, exp: now + json.expires_in, email: sa.client_email }
  return json.access_token
}
