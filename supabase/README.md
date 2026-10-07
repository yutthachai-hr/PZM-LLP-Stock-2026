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

## When a Supabase project is created (owner steps — not done)

1. **Create the project** in the Singapore region (closest to Bangkok). Free tier is enough for the shadow.
2. **Apply the schema:** run `npm run shadow -- bundle`, then paste `supabase/dist/shadow.sql` into the SQL editor.
   - Or `supabase db push` with these migrations. Same files, same order.
3. **Authentication → Third-party auth → Firebase:** project `pzm-stock-x5`.
   - Supabase then accepts Firebase ID tokens as `auth.jwt()`, and `sub` is the Firebase uid. Nobody makes a new account.
   - Before any browser reads Supabase, every Firebase user also needs the custom claim `role: "authenticated"`. A one-off admin script with the service account does this. **Not needed while only the Worker reads/writes.**
4. **Service role key** goes into the Cloudflare **Worker's** secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
   - **Never** into Pages / `VITE_*`. Anything prefixed `VITE_` ships to every browser.
5. **Backfill** from the latest backup, then **parity**. Every row must say PASS before anything else.
6. **Outbox:** the producer change is designed but **not wired** (see `docs/evidence/supabase-shadow-foundation.md` §4).
   - It adds an `outbox` collection to Firestore, so it needs a rules change and the owner's go-ahead, like every new collection.
