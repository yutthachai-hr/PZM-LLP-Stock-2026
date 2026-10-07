# Supabase shadow (PZM Operations OS)

**Firestore is the source of truth.** This folder is a *shadow*:
- a copy kept for analytics, Phase G read models and migration validation;
- written **only** by the service role (backfill, outbox replicator);
- **never** by a browser, and never as a second write next to a Firestore write.

Nothing in production reads or writes it yet.

| Path | What |
|---|---|
| `migrations/0001_core.sql` | master data, purchasing, ledger, transfers, `stock_balance_from_ledger` view |
| `migrations/0002_notifications_audit_intel.sql` | notifications + per-reader recipients (design), audit log, Phase G read models, `prediction_snapshots` |
| `migrations/0003_outbox_replication.sql` | `outbox_events`, `migration_checkpoints`, `parity_runs`, `replication_status` view |
| `migrations/0004_rls.sql` | row-level security on every table (Firebase identity) |
| `test-shim.sql` | what Supabase already provides (`auth.jwt()`, roles). **Local only, never applied to Supabase** |
| `../src/shadow/*` | mapping, writer, backfill, replicator, parity (shared by the CLI, the tests and later the Worker) |
| `../scripts/shadow.mjs` | the local operator tool (`npm run shadow -- …`) |

## Local rehearsal (no Supabase project needed)

```bash
npm run shadow -- backfill "D:\AI Solution\pzm-stock-pizza-<date>.json"
npm run shadow -- parity   "D:\AI Solution\pzm-stock-pizza-<date>.json"
npm run shadow -- status
npm run shadow -- bench
```

The database is PostgreSQL 17 (PGlite) in `%LOCALAPPDATA%\pzm-shadow-db`. It is kept outside OneDrive because a synced folder corrupts PostgreSQL's files. Delete that folder to start over.

## Filling the real Supabase project from your machine

The project exists (7 Oct 2026). These commands run **on your computer**. The connection string holds the database password, so it lives only in the terminal window you type it in.

1. **Copy the connection string.** In Supabase go to **Connect** (top bar), or **Project Settings → Database → Connection string**, and choose **Session pooler**. It looks like:
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
   Put your real password in place of `[YOUR-PASSWORD]`.

2. **Set it in PowerShell** (this window only — nothing is saved to disk):
   ```powershell
   $env:SUPABASE_DB_URL = "postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
   ```

3. **Create the tables.** This runs only the migrations not yet applied, so it's safe to repeat:
   ```powershell
   npm run shadow -- migrate --pg
   ```

4. **Load the latest backups**, then check parity. Each must end in PASS:
   ```powershell
   npm run shadow -- backfill "D:\AI Solution\pzm-stock-pizza-<date>.json" --pg
   npm run shadow -- backfill "D:\AI Solution\pzm-stock-lelapin-<date>.json" --pg
   npm run shadow -- parity   "D:\AI Solution\pzm-stock-pizza-<date>.json" --pg
   npm run shadow -- parity   "D:\AI Solution\pzm-stock-lelapin-<date>.json" --pg
   npm run shadow -- status --pg
   ```
   A backfill that stops part-way (network) continues where it stopped when run again.

## Keeping it current (the Worker)

The cron Worker `pzmstock-cron` copies new changes every 30 minutes, on its own cron `15,45 * * * *`:
- outbox events written by the stock commands;
- a change scan of what clients write (catalogue, suppliers, orders, requests, transfers, people).

It does nothing until both secrets are set. Its status is written to `meta/shadowStatus`.

```powershell
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT -c worker/wrangler.toml   # if not already set
npx wrangler secret put SUPABASE_DB_URL -c worker/wrangler.toml            # the same string as above
npm run worker:deploy
```

**The outbox is written only by code on the branch with the server stock commands** (`feat/outbox`, built on the cloud session's work). Until that branch is merged and live, the Worker's change scan alone keeps the shadow current.

## Reference: setting up a project from scratch


1. **Create the project** in the Singapore region (closest to Bangkok). Free tier is enough for the shadow.
2. **Apply the schema:** run `npm run shadow -- bundle`, then paste `supabase/dist/shadow.sql` into the SQL editor.
   - Or `supabase db push` with these migrations. Same files, same order.
3. **Authentication → Third-party auth → Firebase:** project `pzm-stock-x5`.
   - Supabase then accepts Firebase ID tokens as `auth.jwt()`, and `sub` is the Firebase uid. Nobody makes a new account.
   - Before any browser reads Supabase, every Firebase user also needs the custom claim `role: "authenticated"`. A one-off admin script with the service account does this. **Not needed while only the Worker reads/writes.**
4. **Service role key** goes into the Cloudflare **Worker's** secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
   - **Never** into Pages / `VITE_*`. Anything prefixed `VITE_` ships to every browser.
5. **Backfill** from the latest backup, then **parity**. Every row must say PASS before anything else.
6. **Outbox:** wired on `feat/outbox` (owner approved 7 Oct 2026). The server stock commands write events in the same commit as the change. It needs no rules change: `outbox` is on none of the rules' lists, so every client is denied.
