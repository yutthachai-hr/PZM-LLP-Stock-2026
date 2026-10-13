/**
 * P0 preview isolation (owner, 8 Oct 2026): which deployment this is, decided in one place
 * and used by the build (vite.config.ts), the app (firebase/config.ts) and the Pages
 * Functions (functions/{api,a,po}/_middleware.ts).
 *
 *   production  the `main` branch, served at the production host — the only tier that may
 *               touch the live Firebase project, its service account, KV and AI bindings
 *   staging     a deliberately configured integration environment on a SEPARATE Firebase
 *               project (never the production one) — functions only, opt-in
 *   preview     every other Pages build or host: demo data, no privileged function
 *   local       a developer machine (not a Pages build)
 *
 * Fails closed: a Pages build without a branch name, or a request to a host that is not
 * known to be production, is never treated as production.
 *
 * Pure: no imports. Runs in Node (the build), the browser and the Workers runtime.
 */

export const PRODUCTION_BRANCH = 'main'
/** The live Firebase project. A staging tier must name a different one. */
export const PRODUCTION_PROJECT = 'pzm-stock-x5'
/** Production hosts. A custom domain is added through the PRODUCTION_HOSTS variable (production env only). */
export const PRODUCTION_HOSTS: readonly string[] = ['pzmstock.pages.dev']

export type BuildTier = 'production' | 'preview' | 'local'

/**
 * The build's tier from Cloudflare Pages' build variables. On Pages (CF_PAGES set), only the
 * production branch builds for production; everything else builds in demo mode; a missing
 * branch name is an error rather than a guess.
 */
export function buildTier(env: { CF_PAGES?: string; CF_PAGES_BRANCH?: string }): BuildTier {
  if (!env.CF_PAGES) return 'local'
  const branch = (env.CF_PAGES_BRANCH ?? '').trim()
  if (!branch) throw new Error('Cloudflare Pages build without CF_PAGES_BRANCH: refusing to guess the deployment tier (preview isolation fails closed)')
  return branch === PRODUCTION_BRANCH ? 'production' : 'preview'
}

export type HostTier = 'production' | 'preview' | 'local'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * The tier of a request or page by its host name. Only an exact production host is
 * production; a preview alias (`<branch>.pzmstock.pages.dev`), a deployment's own hash URL,
 * or any unknown host is preview. `extra` adds custom production domains.
 */
export function hostTier(hostname: string, extra: readonly string[] = []): HostTier {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (LOCAL.has(h)) return 'local'
  if (PRODUCTION_HOSTS.includes(h) || extra.map((x) => x.trim().toLowerCase()).filter(Boolean).includes(h)) return 'production'
  return 'preview'
}

export function extraHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !s.endsWith('.pages.dev')) // a pages.dev alias is never a "custom" production host
}

export type FunctionTier = 'production' | 'staging' | 'preview'

export interface FunctionEnv {
  PRODUCTION_HOSTS?: string
  DEPLOY_TIER?: string
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT?: string
}

/**
 * The project a service account belongs to — only for a key that looks like a real one:
 * `type: service_account`, a `project_id`, a `client_email` of that same project
 * (`…@<project>.iam.gserviceaccount.com`) and a private key. Anything else is null.
 */
export function serviceAccountProject(json: string | undefined): string | null {
  if (!json) return null
  let sa: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    sa = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const project = typeof sa.project_id === 'string' ? sa.project_id.trim() : ''
  const email = typeof sa.client_email === 'string' ? sa.client_email.trim().toLowerCase() : ''
  const key = typeof sa.private_key === 'string' ? sa.private_key : ''
  if (sa.type !== 'service_account' || !project || !key.includes('PRIVATE KEY')) return null
  if (!email.endsWith(`@${project.toLowerCase()}.iam.gserviceaccount.com`)) return null
  return project
}

/**
 * Whether these Functions may run as a staging integration environment (owner, 9 Oct 2026:
 * every condition, or none). DEPLOY_TIER is `staging`; FIREBASE_PROJECT_ID is set; the service
 * account is a well-formed key whose project is EXACTLY that id; that id is not the production
 * project; and no production-only setting (PRODUCTION_HOSTS) is present. Missing, malformed,
 * mismatched or production identifiers fail closed (preview: privileged functions refused).
 *
 * Bindings (KV, AI) cannot be identified from inside a Function, so a staging deployment must
 * also be a separate Pages project with its own bindings — documented in
 * docs/evidence/preview-isolation.md; this check is the part code can enforce.
 */
export function stagingAllowed(env: FunctionEnv): boolean {
  if ((env.DEPLOY_TIER ?? '').trim() !== 'staging') return false
  if ((env.PRODUCTION_HOSTS ?? '').trim()) return false
  const project = (env.FIREBASE_PROJECT_ID ?? '').trim()
  if (!project || project === PRODUCTION_PROJECT) return false
  const saProject = serviceAccountProject(env.FIREBASE_SERVICE_ACCOUNT)
  if (!saProject || saProject === PRODUCTION_PROJECT) return false
  return saProject === project
}

/**
 * What a Pages Function may do. Production only on a production host. Staging only when
 * stagingAllowed() holds in full. Everything else — preview aliases, hash URLs,
 * `wrangler pages dev` on localhost — is preview.
 */
export function functionTier(hostname: string, env: FunctionEnv): FunctionTier {
  if (hostTier(hostname, extraHosts(env.PRODUCTION_HOSTS)) === 'production') return 'production'
  return stagingAllowed(env) ? 'staging' : 'preview'
}

/** Function routes a preview may still serve: they read no secret, binding or database. */
export const PREVIEW_SAFE_ROUTES: readonly string[] = ['/api/client-error']
