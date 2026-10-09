import { PRODUCTION_PROJECT } from '../../src/lib/deployTier'

/**
 * The staging configuration a staging-only handler (Ask PZM) runs on — or nothing (owner
 * directive, Track 3, 9 Oct 2026). Every rule fails closed:
 *  - DEPLOY_TIER is exactly "staging";
 *  - FIREBASE_PROJECT_ID is set explicitly — never defaulted to anything;
 *  - FIREBASE_SERVICE_ACCOUNT parses and names its own project_id, and a client_email of that
 *    same project;
 *  - the two project ids are identical, and neither is the production project.
 * The handler then verifies callers' tokens against THIS project only, so a production user's
 * token is refused and no request can reach production Firebase.
 */
export interface StagingEnv {
  DEPLOY_TIER?: string
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT?: string
}

export type StagingConfig = { ok: true; projectId: string; serviceAccount: string } | { ok: false; reason: string }

const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

export function stagingConfig(env: StagingEnv): StagingConfig {
  if ((env.DEPLOY_TIER ?? '') !== 'staging') return { ok: false, reason: 'tier_not_staging' }
  const projectId = env.FIREBASE_PROJECT_ID ?? ''
  if (!projectId) return { ok: false, reason: 'project_id_missing' }
  if (projectId !== projectId.trim() || !PROJECT.test(projectId)) return { ok: false, reason: 'project_id_malformed' }
  if (!env.FIREBASE_SERVICE_ACCOUNT) return { ok: false, reason: 'service_account_missing' }
  let sa: { project_id?: unknown; client_email?: unknown; private_key?: unknown }
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
  } catch {
    return { ok: false, reason: 'service_account_malformed' }
  }
  if (typeof sa.project_id !== 'string' || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') return { ok: false, reason: 'service_account_malformed' }
  if (sa.project_id !== projectId) return { ok: false, reason: 'project_mismatch' }
  if (!sa.client_email.endsWith(`@${projectId}.iam.gserviceaccount.com`)) return { ok: false, reason: 'service_account_other_project' }
  if (projectId === PRODUCTION_PROJECT || sa.project_id === PRODUCTION_PROJECT) return { ok: false, reason: 'production_project' }
  return { ok: true, projectId, serviceAccount: env.FIREBASE_SERVICE_ACCOUNT }
}
