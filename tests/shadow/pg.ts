import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/** A fresh PostgreSQL with the Supabase basics (test-shim.sql) and every migration applied in order. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join('supabase', 'test-shim.sql'), 'utf8'))
  for (const f of migrationFiles()) await db.exec(readFileSync(join('supabase', 'migrations', f), 'utf8'))
  return db
}

export function migrationFiles(): string[] {
  return readdirSync(join('supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
}

/** Run `fn` as a signed-in person: Supabase's `authenticated` role with these JWT claims. */
export async function asUser<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated`)
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''])
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
