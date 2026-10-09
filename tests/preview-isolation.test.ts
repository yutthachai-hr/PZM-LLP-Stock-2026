// P0 preview isolation (owner, 8 Oct 2026): only `main` on the production host reaches the
// live project. Builds, hosts, every function route on disk, and the client's config.
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildTier, extraHosts, functionTier, hostTier, PRODUCTION_PROJECT } from '../src/lib/deployTier'
import { previewGuard } from '../functions/_lib/previewGuard'

const ROOT = join(__dirname, '..')

describe('build tier (vite.config.ts)', () => {
  test('main builds production; every other branch builds preview (demo mode); local is local', () => {
    expect(buildTier({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' })).toBe('production')
    for (const b of ['demo', 'claude/phase-a-ledger-continue-uzbbb5', 'integration/ops-os-rc1', 'feat/outbox', 'Main', 'main2', 'refs/heads/main'])
      expect(buildTier({ CF_PAGES: '1', CF_PAGES_BRANCH: b }), b).toBe('preview')
    expect(buildTier({})).toBe('local')
  })
  test('a Pages build that does not say its branch fails closed', () => {
    expect(() => buildTier({ CF_PAGES: '1' })).toThrow(/fails closed/)
    expect(() => buildTier({ CF_PAGES: '1', CF_PAGES_BRANCH: '  ' })).toThrow(/fails closed/)
  })
})

describe('host tier', () => {
  test('only the exact production host is production', () => {
    expect(hostTier('pzmstock.pages.dev')).toBe('production')
    expect(hostTier('PZMSTOCK.pages.dev.')).toBe('production')
    for (const h of ['demo.pzmstock.pages.dev', 'dbee8792.pzmstock.pages.dev', 'claude-phase-a-ledger-cont.pzmstock.pages.dev', 'pzmstock.pages.dev.evil.com', 'evilpzmstock.pages.dev', 'example.com'])
      expect(hostTier(h), h).toBe('preview')
    expect(hostTier('localhost')).toBe('local')
  })
  test('a custom production domain can be added — but never a pages.dev alias', () => {
    expect(hostTier('stock.pizzamania.co.th', extraHosts('stock.pizzamania.co.th'))).toBe('production')
    expect(extraHosts('x.pzmstock.pages.dev, stock.pizzamania.co.th')).toEqual(['stock.pizzamania.co.th'])
    expect(hostTier('x.pzmstock.pages.dev', extraHosts('x.pzmstock.pages.dev'))).toBe('preview')
  })
})

describe('function tier', () => {
  const sa = (project: string) => JSON.stringify({ project_id: project })
  test('production only on the production host', () => {
    expect(functionTier('pzmstock.pages.dev', {})).toBe('production')
    expect(functionTier('abc.pzmstock.pages.dev', { FIREBASE_SERVICE_ACCOUNT: sa(PRODUCTION_PROJECT) })).toBe('preview')
    expect(functionTier('localhost', {})).toBe('preview')
  })
  test('staging only when declared AND every named project is not production', () => {
    expect(functionTier('stg.pzmstock.pages.dev', { DEPLOY_TIER: 'staging', FIREBASE_PROJECT_ID: 'pzm-staging', FIREBASE_SERVICE_ACCOUNT: sa('pzm-staging') })).toBe('staging')
    expect(functionTier('stg.pzmstock.pages.dev', { DEPLOY_TIER: 'staging', FIREBASE_PROJECT_ID: 'pzm-staging', FIREBASE_SERVICE_ACCOUNT: sa(PRODUCTION_PROJECT) })).toBe('preview')
    expect(functionTier('stg.pzmstock.pages.dev', { DEPLOY_TIER: 'staging', FIREBASE_PROJECT_ID: PRODUCTION_PROJECT })).toBe('preview')
    expect(functionTier('stg.pzmstock.pages.dev', { DEPLOY_TIER: 'staging' })).toBe('preview')
    expect(functionTier('stg.pzmstock.pages.dev', { DEPLOY_TIER: 'staging', FIREBASE_SERVICE_ACCOUNT: 'not json' })).toBe('preview')
  })
})

// ---------------------------------------------------------------- every function route ----

/** Every route file under functions/ (files and folders starting with _ are not routes). */
function routes(dir = join(ROOT, 'functions')): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (f.startsWith('_')) return []
    const p = join(dir, f)
    return statSync(p).isDirectory() ? routes(p) : f.endsWith('.ts') ? [p] : []
  })
}
/** The URL a route file serves, with sample values for [params]. */
const urlOf = (file: string) =>
  '/' + relative(join(ROOT, 'functions'), file).split(sep).join('/').replace(/\.ts$/, '').replace(/\[([a-z]+)\]/gi, (_m, n) => `sample-${n}`)

describe('every Pages Function is behind the guard', () => {
  const all = routes()
  test('the routes found on disk are the known privileged surface', () => {
    // Production `main`'s functions (early-release line): no /api/stock or /api/client-error here yet.
    expect(all.map(urlOf).sort()).toEqual(['/a/sample-token', '/api/ocr-bill', '/api/po-image', '/api/supplier-po/decide', '/api/supplier-po/link', '/api/supplier/sample-token', '/po/sample-token'])
  })
  test('each route directory has a _middleware.ts that is the guard', async () => {
    const tops = new Set(all.map((f) => relative(join(ROOT, 'functions'), f).split(sep)[0]))
    for (const t of tops) {
      const mw = await import(`../functions/${t}/_middleware.ts`)
      expect(mw.onRequest, t).toBe(previewGuard)
    }
  })
  const run = async (host: string, path: string, env: Record<string, string> = {}) => {
    const next = vi.fn(async () => new Response('handler ran'))
    const res = await previewGuard({ request: new Request(`https://${host}${path}`, { method: 'POST' }), env, next })
    return { status: res.status, ran: next.mock.calls.length > 0, body: await res.text() }
  }
  test.each(all.map(urlOf).filter((u) => u !== '/api/client-error'))('preview never runs %s; production does', async (path) => {
    for (const host of ['claude-phase-a-ledger-cont.pzmstock.pages.dev', 'dbee8792.pzmstock.pages.dev', 'demo.pzmstock.pages.dev', 'localhost', 'unknown.example']) {
      const r = await run(host, path, { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: PRODUCTION_PROJECT }) })
      expect(r.status, `${host}${path}`).toBe(503)
      expect(r.ran).toBe(false)
      expect(r.body).toContain('preview_isolated')
    }
    expect((await run('pzmstock.pages.dev', path)).ran).toBe(true)
  })
  test('the error report (logs only, no secret) stays open in preview', async () => {
    expect((await run('demo.pzmstock.pages.dev', '/api/client-error')).ran).toBe(true)
  })
})

// ---------------------------------------------------------------- the app's config ----

describe('the client never opens the live project outside production', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  const savedProd = JSON.stringify({ apiKey: 'k', authDomain: 'pzm-stock-x5.firebaseapp.com', projectId: 'pzm-stock-x5', appId: 'a' })
  const load = async (tier: string, host: string, demo = false) => {
    vi.stubEnv('VITE_DEPLOY_TIER', tier)
    vi.stubEnv('VITE_DEMO_MODE', demo ? '1' : '')
    vi.stubGlobal('location', { hostname: host })
    vi.stubGlobal('localStorage', { getItem: () => savedProd, setItem: () => {}, removeItem: () => {} })
    return (await import('../src/firebase/config')).getFirebaseConfig()
  }
  test('a preview build (demo mode) ignores BUILT_IN and a production config saved in the browser', async () => {
    expect(await load('preview', 'claude-x.pzmstock.pages.dev', true)).toBeNull()
  })
  test('a production build on a non-production host gets no project', async () => {
    expect(await load('production', 'dbee8792.pzmstock.pages.dev')).toBeNull()
    expect(await load('production', 'evil.example')).toBeNull()
  })
  test('the production build on the production host is unchanged', async () => {
    expect((await load('production', 'pzmstock.pages.dev'))?.projectId).toBe('pzm-stock-x5')
  })
})
