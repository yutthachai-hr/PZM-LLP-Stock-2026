import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/** The Firebase project the test database trusts (0006: shadow.auth_settings). */
export const TEST_FIREBASE_PROJECT = 'demo-pzm-test'

/**
 * A fresh PostgreSQL with the Supabase basics (test-shim.sql) and every migration applied in
 * order, set up — as the service role would — to trust TEST_FIREBASE_PROJECT's tokens.
 * `trustProject: null` leaves auth_settings empty (the fail-closed case).
 */
export async function freshDb(opts: { trustProject?: string | null } = {}): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join('supabase', 'test-shim.sql'), 'utf8'))
  for (const f of migrationFiles()) await db.exec(readFileSync(join('supabase', 'migrations', f), 'utf8'))
  const project = opts.trustProject === undefined ? TEST_FIREBASE_PROJECT : opts.trustProject
  if (project) await db.query(`insert into shadow.auth_settings (firebase_project_id) values ($1)`, [project])
  return db
}

export function migrationFiles(): string[] {
  return readdirSync(join('supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
}

/**
 * Run `fn` as a signed-in person: Supabase's `authenticated` role with the claims of a
 * Firebase ID token (`iss` / `aud` name the project; another project's token can be forged
 * with `project`).
 */
export async function asUser<T>(db: PGlite, uid: string | null, fn: () => Promise<T>, project = TEST_FIREBASE_PROJECT): Promise<T> {
  await db.exec(`set role authenticated`)
  const claims = { sub: uid, role: 'authenticated', iss: `https://securetoken.google.com/${project}`, aud: project }
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [uid ? JSON.stringify(claims) : ''])
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
