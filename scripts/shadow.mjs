#!/usr/bin/env node
// Supabase shadow foundation — local operator tool (7 Oct 2026).
//
//   npm run shadow -- migrate                     apply supabase/migrations to the local shadow DB (%LOCALAPPDATA%\pzm-shadow-db)
//   npm run shadow -- bundle                      write supabase/dist/shadow.sql (all migrations, for the Supabase SQL editor)
//   npm run shadow -- backfill <backup.json> [--run <id>]   load a backup (resumable; same --run continues)
//   npm run shadow -- parity <backup.json>        compare the backup with the shadow DB; exit 1 on any mismatch
//   npm run shadow -- status                      replication + checkpoint status
//   npm run shadow -- bench                       timings of the main read queries
//
// Add --pg to run against the real Supabase project instead of the local copy. The connection
// string comes from SUPABASE_DB_URL (Supabase › Connect › Session pooler), and the password
// best on its own in SUPABASE_DB_PASSWORD — any characters, encoded here. Set both in your own
// terminal; they are never written to a file, and errors never print them.
//
// Reads backup FILES only. Never reads or writes Firestore; never touches production.
// The local DB is PostgreSQL 17 (PGlite) in .shadow-db; against Supabase the same modules
// run with a service-role connection from the Worker (supabase/README.md).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
// Outside OneDrive by default: a synced folder locks and rewrites PostgreSQL's files under it
// (a .shadow-db inside the repo was corrupted on 7 Oct 2026).
const defaultDir = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'pzm-shadow-db') : resolve(root, '.shadow-db')
const dataDir = flag('db') ? resolve(flag('db')) : defaultDir

const migrations = () =>
  readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(root, 'supabase', 'migrations', f), 'utf8') }))

const usePg = args.includes('--pg')

/**
 * The connection string, with the password put in safely. A password with # % @ / : ? in it
 * breaks a URL, and the driver's error then printed the whole string — password included
 * (7 Oct 2026). So the password may be given on its own (SUPABASE_DB_PASSWORD) and is
 * URL-encoded here; and nothing below ever prints the URL.
 */
function connectionUrl() {
  const raw = process.env.SUPABASE_DB_URL
  if (!raw) throw new Error('set SUPABASE_DB_URL in this terminal first (see the top of scripts/shadow.mjs)')
  const password = process.env.SUPABASE_DB_PASSWORD
  // postgresql://user:[YOUR-PASSWORD]@host:port/db — split by hand: the raw string may not parse.
  const m = raw.match(/^(postgres(?:ql)?:\/\/)([^:@/]+)(?::(.*))?@([^@/]+)(\/.*)?$/)
  if (!m) throw new Error('SUPABASE_DB_URL does not look like postgresql://user:password@host:port/postgres')
  const [, scheme, user, inlinePass, host, path = '/postgres'] = m
  const pass = password ?? inlinePass
  if (!pass || pass === '[YOUR-PASSWORD]') throw new Error('no password: put it in SUPABASE_DB_PASSWORD (any characters are fine there)')
  return `${scheme}${user}:${encodeURIComponent(pass)}@${host}${path}`
}

/** An error's text with any connection string or password cut out. */
function redact(text) {
  let t = String(text)
  for (const secret of [process.env.SUPABASE_DB_URL, process.env.SUPABASE_DB_PASSWORD]) if (secret) t = t.split(secret).join('***')
  return t.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, 'postgresql://***')
}
process.on('uncaughtException', (e) => {
  console.error(redact(e?.message ?? e))
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error(redact(e?.message ?? e))
  process.exit(1)
})

/** A real PostgreSQL (Supabase), shaped like the bits of PGlite this tool uses. */
async function openPg() {
  const { default: postgres } = await import('postgres')
  const sql = postgres(connectionUrl(), { ssl: 'require', max: 1, onnotice: () => {}, prepare: false })
  const shape = (s) => ({
    query: async (q, p = []) => ({ rows: await s.unsafe(q, p) }),
    exec: async (q) => s.unsafe(q),
  })
  const db = {
    ...shape(sql),
    transaction: (fn) => sql.begin((tx) => fn(shape(tx))),
    close: () => sql.end(),
    raw: sql,
  }
  await db.exec(`create table if not exists public.shadow_migrations (name text primary key, applied_at timestamptz not null default now())`)
  const done = new Set((await db.query(`select name from public.shadow_migrations`)).rows.map((r) => r.name))
  for (const m of migrations()) {
    if (done.has(m.name)) continue
    await db.transaction(async (tx) => {
      await tx.exec(m.sql)
      await tx.query(`insert into public.shadow_migrations (name) values ($1)`, [m.name])
    })
    console.log(`applied ${m.name} (Supabase)`)
  }
  return db
}

async function openDb() {
  if (usePg) return openPg()
  mkdirSync(dataDir, { recursive: true })
  const db = new PGlite(dataDir)
  await db.exec(readFileSync(join(root, 'supabase', 'test-shim.sql'), 'utf8'))
  await db.exec(`create table if not exists public.shadow_migrations (name text primary key, applied_at timestamptz not null default now())`)
  const done = new Set((await db.query(`select name from public.shadow_migrations`)).rows.map((r) => r.name))
  for (const m of migrations()) {
    if (done.has(m.name)) continue
    await db.transaction(async (tx) => {
      await tx.exec(m.sql)
      await tx.query(`insert into public.shadow_migrations (name) values ($1)`, [m.name])
    })
    console.log(`applied ${m.name}`)
  }
  return db
}

async function modules() {
  const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const load = (p) => vite.ssrLoadModule(p)
  return {
    vite,
    backfill: await load('/src/shadow/backfill.ts'),
    parity: await load('/src/shadow/parity.ts'),
    pglite: await load('/src/shadow/pglite.ts'),
    postgres: await load('/src/shadow/postgres.ts'),
  }
}

const readBackup = (file) => {
  if (!file) throw new Error('give the backup file')
  return JSON.parse(readFileSync(resolve(file), 'utf8'))
}

if (cmd === 'bundle') {
  mkdirSync(join(root, 'supabase', 'dist'), { recursive: true })
  const out = migrations().map((m) => `-- ===== ${m.name} =====\n${m.sql}`).join('\n\n')
  writeFileSync(join(root, 'supabase', 'dist', 'shadow.sql'), out)
  console.log(`wrote supabase/dist/shadow.sql (${migrations().length} migrations)`)
} else if (cmd === 'migrate') {
  const db = await openDb()
  await db.close()
} else if (cmd === 'backfill' || cmd === 'parity') {
  const backup = readBackup(args[1])
  const db = await openDb()
  const m = await modules()
  try {
    const client = usePg ? m.postgres.postgresClient(db.raw) : m.pglite.pgliteClient(db)
    if (cmd === 'backfill') {
      const runId = flag('run') ?? `backup-${backup.brand}-${backup.createdAt}`
      const t0 = Date.now()
      const res = await m.backfill.backfill(client, backup, { runId })
      console.log(`run ${res.runId} in ${Date.now() - t0} ms`)
      for (const e of res.entities) console.log(`  ${e.entity.padEnd(16)} ${String(e.done).padStart(6)} / ${e.total}${e.skipped ? ' (already done)' : ''}`)
      // Fresh statistics after a bulk load, so the planner uses the indexes (as on Supabase).
      await db.exec(usePg ? 'analyze shadow.stock_movements, shadow.stock_balances, shadow.purchase_orders, shadow.products' : 'analyze')
    } else {
      const report = await m.parity.checkParity(client, backup)
      await db.query(`insert into shadow.parity_runs (source, passed, summary) values ($1, $2, $3::jsonb)`, [report.source, report.pass, JSON.stringify(report)])
      console.log(m.parity.formatParity(report))
      process.exitCode = report.pass ? 0 : 1
    }
  } finally {
    await m.vite.close()
    await db.close()
  }
} else if (cmd === 'status') {
  const db = await openDb()
  console.log((await db.query(`select * from shadow.replication_status`)).rows[0])
  console.table((await db.query(`select run_id, entity, done, total, status, last_error from shadow.migration_checkpoints order by run_id, entity`)).rows)
  await db.close()
} else if (cmd === 'bench') {
  const db = await openDb()
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0] ?? {}
  const sup = (await one(`select supplier_id from shadow.purchase_orders group by 1 order by count(*) desc limit 1`)).supplier_id
  const prod = (await one(`select product_id from shadow.stock_movements group by 1 order by count(*) desc limit 1`)).product_id
  const queries = {
    'open POs': [`select id, doc_no, supplier_id, expected_at from shadow.purchase_orders where brand = 'pizza' and status = 'ordered' order by expected_at`, []],
    'supplier history (50)': [`select id, doc_no, status, ordered_at from shadow.purchase_orders where brand = 'pizza' and supplier_id = $1 order by ordered_at desc limit 50`, [sup]],
    'product stock (all sites)': [`select location_id, unit_key, qty from shadow.stock_balances where brand = 'pizza' and product_id = $1`, [prod]],
    'movement page (newest 50)': [`select id, doc_no, type, product_id, qty from shadow.stock_movements where brand = 'pizza' order by occurred_ms desc limit 50`, []],
    'stock card (product, 50)': [`select id, doc_no, type, qty from shadow.stock_movements where brand = 'pizza' and product_id = $1 order by occurred_ms desc limit 50`, [prod]],
    'balance from ledger (whole brand)': [`select count(*) from shadow.stock_balance_from_ledger where brand = 'pizza'`, []],
    'supplier metrics (latest)': [`select * from shadow.supplier_metrics where brand = 'pizza' and as_of = (select max(as_of) from shadow.supplier_metrics where brand = 'pizza')`, []],
    'inventory risks (high)': [`select * from shadow.inventory_risks where brand = 'pizza' and level = 'high' order by as_of desc limit 100`, []],
    'notification inbox (30)': [`select n.id, n.kind, n.created_at, r.read_at from shadow.notification_recipients r join shadow.notifications n on n.brand = r.brand and n.id = r.notification_id where r.user_id = 'u' and r.brand = 'pizza' order by n.created_at desc limit 30`, []],
  }
  const out = []
  for (const [name, [sql, p]] of Object.entries(queries)) {
    for (let i = 0; i < 3; i++) await db.query(sql, p)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) await db.query(sql, p)
    const ms = (performance.now() - t0) / 20
    const plan = (await db.query(`explain ${sql}`, p)).rows.map((r) => r['QUERY PLAN']).join(' | ')
    const index = (plan.match(/Index (?:Only )?Scan(?: Backward)? using (\w+)/) ?? [])[1] ?? (plan.includes('Seq Scan') ? 'seq scan' : '-')
    out.push({ query: name, 'avg ms': ms.toFixed(2), uses: index })
  }
  console.table(out)
  await db.close()
} else {
  console.log('usage: npm run shadow -- <migrate|bundle|backfill|parity|status|bench> …')
  process.exitCode = 2
}
