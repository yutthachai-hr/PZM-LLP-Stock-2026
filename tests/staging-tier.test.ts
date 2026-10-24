// R67 dedicated OCR staging (owner, 24 Oct 2026): a separate Pages project and Firebase project.
// The production / staging boundary, for the build, the browser's config, the functions and the
// staging deployment's own bindings. Production behaviour is pinned in preview-isolation.test.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildTier, firebaseProjectFor, functionTier, PRODUCTION_PROJECT, PRODUCTION_WEB_API_KEY, stagingWebProject } from '../src/lib/deployTier'

const ROOT = join(__dirname, '..')
const web = (project: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ apiKey: 'k', authDomain: `${project}.firebaseapp.com`, projectId: project, storageBucket: `${project}.firebasestorage.app`, appId: 'a', ...over })
const STG_WEB = web('pzm-stock-staging')

// A fake key, assembled so no scanner mistakes this file for a credential.
const KEY = ['-----BEGIN', 'PRIVATE KEY-----', 'AA==', '-----END', 'PRIVATE KEY-----'].join(' ')
const sa = (project: string) => JSON.stringify({ type: 'service_account', project_id: project, client_email: `ocr@${project}.iam.gserviceaccount.com`, private_key: KEY })
const STG_ENV = { DEPLOY_TIER: 'staging', FIREBASE_PROJECT_ID: 'pzm-stock-staging', FIREBASE_SERVICE_ACCOUNT: sa('pzm-stock-staging') }

describe('the staging web config', () => {
  test('a separate project is accepted', () => {
    expect(stagingWebProject(STG_WEB)).toBe('pzm-stock-staging')
  })
  test.each([
    ['missing', undefined],
    ['not JSON', '{nope'],
    ['incomplete', JSON.stringify({ projectId: 'pzm-stock-staging' })],
    ['the production project', web(PRODUCTION_PROJECT)],
    ['production auth domain', web('pzm-stock-staging', { authDomain: `${PRODUCTION_PROJECT}.firebaseapp.com` })],
    ['production bucket', web('pzm-stock-staging', { storageBucket: `${PRODUCTION_PROJECT}.firebasestorage.app` })],
    ['production sender id', web('pzm-stock-staging', { messagingSenderId: '789071579161' })],
    // R67 review (PR #59): JSON escapes decode to production after a text search.
    // The escape is in the JSON text itself, so JSON.parse decodes it back to production.
    ['production id written with a JSON escape', web(PRODUCTION_PROJECT).split('x5').join('x\\u0035')],
    ['production number written with a JSON escape', web('pzm-stock-staging', { appId: '1:789071579161:web:x' }).replace('789071579161', '789\\u003071579161')],
    ['production id in capitals', web('PZM-STOCK-X5')],
    ['production auth domain in capitals', web('pzm-stock-staging', { authDomain: 'PZM-Stock-X5.firebaseapp.com' })],
    // Sign-in goes to the project of the API key: production's key would reach production Auth.
    ['the production web API key', web('pzm-stock-staging', { apiKey: PRODUCTION_WEB_API_KEY })],
    ['a project id Firebase would never issue', web('Pzm_Staging')],
  ])('refused: %s', (_, value) => {
    expect(stagingWebProject(value)).toBeNull()
  })

  test('the production identifiers it refuses are the ones the app ships', async () => {
    const src = readFileSync(join(ROOT, 'src/firebase/config.ts'), 'utf8')
    expect(src).toContain(`apiKey: '${PRODUCTION_WEB_API_KEY}'`)
    expect(src).toContain(`projectId: '${PRODUCTION_PROJECT}'`)
  })
})

describe('build tier: staging is explicit, never a Pages git build', () => {
  test('a local build asked for staging, with a separate project, builds staging', () => {
    expect(buildTier({ DEPLOY_TIER: 'staging', VITE_STAGING_FIREBASE_CONFIG: STG_WEB })).toBe('staging')
  })
  test('a staging build without a valid separate project fails', () => {
    expect(() => buildTier({ DEPLOY_TIER: 'staging' })).toThrow(/staging/)
    expect(() => buildTier({ DEPLOY_TIER: 'staging', VITE_STAGING_FIREBASE_CONFIG: web(PRODUCTION_PROJECT) })).toThrow(/staging/)
  })
  test('a Cloudflare Pages git build never becomes staging, whatever its branch', () => {
    for (const b of ['main', 'staging', 'fix/x'])
      expect(() => buildTier({ CF_PAGES: '1', CF_PAGES_BRANCH: b, DEPLOY_TIER: 'staging', VITE_STAGING_FIREBASE_CONFIG: STG_WEB }), b).toThrow(/direct upload/)
  })
  test('production and preview builds are unchanged by a stray staging config', () => {
    expect(buildTier({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main', VITE_STAGING_FIREBASE_CONFIG: STG_WEB })).toBe('production')
    expect(buildTier({ CF_PAGES: '1', CF_PAGES_BRANCH: 'demo', VITE_STAGING_FIREBASE_CONFIG: STG_WEB })).toBe('preview')
  })
})

describe('the browser of a staging build opens only the staging project', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  const savedProd = web(PRODUCTION_PROJECT)
  const load = async (host: string, config: string | undefined, saved: string | null = savedProd) => {
    vi.stubEnv('VITE_DEPLOY_TIER', 'staging')
    vi.stubEnv('VITE_DEMO_MODE', '')
    vi.stubEnv('VITE_STAGING_FIREBASE_CONFIG', config ?? '')
    vi.stubGlobal('location', { hostname: host })
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: () => {}, removeItem: () => {} })
    return (await import('../src/firebase/config')).getFirebaseConfig()
  }
  test('the staging project, even with the production config saved in this browser', async () => {
    expect((await load('pzmstock-staging.pages.dev', STG_WEB))?.projectId).toBe('pzm-stock-staging')
    expect((await load('abc123.pzmstock-staging.pages.dev', STG_WEB))?.projectId).toBe('pzm-stock-staging')
    expect((await load('localhost', STG_WEB))?.projectId).toBe('pzm-stock-staging')
  })
  test('never the production project: not BUILT_IN, not a saved config, not a production config baked in', async () => {
    expect(await load('pzmstock-staging.pages.dev', undefined)).toBeNull()
    expect(await load('pzmstock-staging.pages.dev', web(PRODUCTION_PROJECT))).toBeNull()
  })
  test('a staging bundle served on the production host gets no project', async () => {
    expect(await load('pzmstock.pages.dev', STG_WEB)).toBeNull()
  })
})

describe('which Firebase project a function trusts', () => {
  const at = (host: string) => `https://${host}/api/ocr-bill`
  test('the production host: always the production project, whatever the variables say', () => {
    expect(firebaseProjectFor(at('pzmstock.pages.dev'), {})).toBe(PRODUCTION_PROJECT)
    expect(firebaseProjectFor(at('pzmstock.pages.dev'), STG_ENV)).toBe(PRODUCTION_PROJECT)
    expect(firebaseProjectFor(at('pzmstock.pages.dev'), { FIREBASE_PROJECT_ID: 'pzm-stock-staging' })).toBe(PRODUCTION_PROJECT)
  })
  test('a complete staging environment: its own project', () => {
    expect(firebaseProjectFor(at('pzmstock-staging.pages.dev'), STG_ENV)).toBe('pzm-stock-staging')
    expect(firebaseProjectFor('http://localhost:8788/api/ocr-bill', STG_ENV)).toBe('pzm-stock-staging')
  })
  test('a production project id in other letters is still production', () => {
    const upper = { ...STG_ENV, FIREBASE_PROJECT_ID: 'PZM-STOCK-X5', FIREBASE_SERVICE_ACCOUNT: sa('PZM-STOCK-X5') }
    expect(functionTier('pzmstock-staging.pages.dev', upper)).toBe('preview')
    expect(firebaseProjectFor(at('pzmstock-staging.pages.dev'), upper)).toBeNull()
  })
  test('anything else trusts no project (a preview, an incomplete or production-keyed staging)', () => {
    expect(firebaseProjectFor(at('pzmstock-staging.pages.dev'), {})).toBeNull()
    expect(firebaseProjectFor(at('pzmstock-staging.pages.dev'), { ...STG_ENV, FIREBASE_SERVICE_ACCOUNT: sa(PRODUCTION_PROJECT) })).toBeNull()
    expect(firebaseProjectFor(at('pzmstock-staging.pages.dev'), { ...STG_ENV, FIREBASE_PROJECT_ID: PRODUCTION_PROJECT })).toBeNull()
    expect(firebaseProjectFor(at('abc.pzmstock.pages.dev'), {})).toBeNull()
  })
})

describe("the staging deployment's own configuration", () => {
  const prod = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')
  const stg = readFileSync(join(ROOT, 'deploy/staging/wrangler.toml'), 'utf8')
  const ids = (toml: string) => [...toml.matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)].map((m) => m[1])
  test('another Pages project, and none of production’s KV namespaces', () => {
    expect(stg).toMatch(/^name\s*=\s*"pzmstock-staging"/m)
    expect(stg).not.toMatch(/^name\s*=\s*"pzmstock"\s*$/m)
    for (const id of ids(prod)) expect(stg).not.toContain(id)
  })
  test('declares the staging tier and its project, and no production-only setting', () => {
    expect(stg).toMatch(/DEPLOY_TIER\s*=\s*"staging"/)
    expect(stg).toMatch(/FIREBASE_PROJECT_ID\s*=\s*"pzm-stock-staging"/)
    expect(stg).not.toMatch(/PRODUCTION_HOSTS/)
    expect(stg).not.toContain(PRODUCTION_PROJECT)
  })
})
