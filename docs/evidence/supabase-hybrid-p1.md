# P1 Supabase hybrid: verification, auth/RLS evaluation, read-pilot proposal

Owner brief of 8 Oct 2026. **Firestore stays authoritative.**

- Nothing here connects to a real Supabase project.
- Production access is **not** enabled.
- No client dual-write exists or is proposed.

## 1. Verification of what exists (`integration/ops-os-rc1`)

| Requirement | Where | Evidence |
|---|---|---|
| outbox → Worker → shadow → parity | `functions/_lib/serverTx.ts` `outboxWrites()` (events in the same commit), `worker/src/shadowSync.ts` (cron `15,45`), `src/shadow/replicate.ts`, `src/shadow/parity.ts` | `tests/functions/outbox.test.ts`, `tests/worker/shadow-sync.test.ts`, `tests/functions/trace-e2e.test.ts` (one receipt followed through to Postgres) |
| Feature flags | `OUTBOX_ENABLED === 'true'` (off by default; nothing is written when off); the Worker replicates only with `SUPABASE_DB_URL`; `WORKER_ENABLED=false` stops every job | `tests/functions/stock-env.test.ts` |
| Migrations | `supabase/migrations/0001–0006` (0006 is new, see §2); idempotent CLI record `shadow_migrations` | `tests/shadow/migrations.test.ts` (two fresh applies give the same schema) |
| Credentials | Service role / DB URL **only** in Worker secrets; never `VITE_*`; the CLI never prints the URL | README §setup; `scripts/shadow.mjs` `connectionUrl()` |
| Resumable, idempotent backfill **from backups** (0 Firestore reads) | `src/shadow/backfill.ts`, checkpoint per chunk in the same transaction | "a run that fails part-way resumes … nothing doubles"; "a run id cannot be resumed against a different source" |
| Idempotent replication; stale events skipped | `on conflict (event_id) do nothing`; version guard | "the same event delivered twice is stored and applied once"; "an older version arriving late is skipped" |
| Dead letter | `failed` → retry → `dead` at `maxAttempts`, visible in `replication_status.dead_letter`, never dropped | "a failing event is retried, then dead-lettered and counted" |
| Lag monitoring | `replication_status` view; `meta/shadowStatus` written by the Worker | **Gap:** no alert threshold yet (§4) |
| Per brand | Every row is keyed `(brand, id)`; the Worker runs per brand prefix | Real-backup parity, both brands (`supabase-shadow-foundation.md`) |
| Rollback | The shadow is read by nothing in production. Rollback means `OUTBOX_ENABLED` unset and the Worker's `SUPABASE_DB_URL` removed; Firestore is untouched. | By construction |
| No duplicate subscriptions | No client code imports Supabase (`grep supabase-js src` = 0) | — |
| A mismatch never changes authoritative data | Parity only **reads** Firestore backups and **writes** `parity_runs`; the replicator writes only the shadow | `src/shadow/parity.ts`; "parity reports a tampered row by id instead of passing" |
| Parity: product ids, locations, PO/receipts, balances per product × location × base unit, immutable ledger | `checkParity` (`products`, `locations`, PO lines, receipts, `stock_movements`; ledger-derived **and** cached balances) | Real backup 6 Oct: 0 mismatches in both brands |
| Transfer conservation | **Partial.** Transfers and lines are compared row by row, but there is no explicit "sum out = sum in + in transit" check. | **Gap** (§4) |

**Test run today:** shadow, worker, outbox and trace suites: **35 passed, 1 skipped.** The
skipped one is the real-backup test, which is an owner gate (it needs `PZM_BACKUP`).

## 2. Firebase Auth → Supabase (third-party JWT) and RLS

Sources: the Supabase docs, "Third-party auth → Firebase Auth", read 8 Oct 2026.

### How it works

1. The browser passes its Firebase ID token through supabase-js `accessToken`.
2. Hosted Supabase verifies the token against Google's keys, and rejects any token from a
   Firebase project that is not registered.

### Required, and not yet done

- Every Firebase user needs the custom claim **`role: "authenticated"`**. Without it, Supabase
  runs the query as `anon`, and this schema then reads nothing.
- Blocking functions need Identity Platform, and this project has no Cloud Functions. The
  practical route is therefore:
  - a one-off admin script with the service account, which sets the claim on every user;
  - the same step in the app's user-creation path (server side), or a periodic Worker sweep.
- The app uses **no** custom claims today, so nothing collides.
- After the claim is set, a user's token picks it up on its next refresh (at most 1 h), or on
  `getIdToken(true)`.

### The RLS model

`0004_rls.sql` mirrors the Firestore rules; it does not invent new ones:

- an active, unrevoked person reads operational data;
- a person reads their own user row; an admin reads all;
- notifications are readable only through a recipient row;
- audit, outbox, checkpoints and parity runs: admins only;
- **the browser has no write grant at all.**

### New in this batch: `0006_jwt_issuer_pin.sql`

This is the restrictive issuer and audience policy that the Supabase docs recommend.

- Firebase signs every project's tokens with the same keys, so the policy pins
  `iss = https://securetoken.google.com/<project>` and `aud = <project>` on **every** table.
- The project is a row in `shadow.auth_settings`, written by the service role. With no row,
  no browser reads anything (fails closed).
- This is defence in depth: hosted Supabase already rejects unregistered projects.

### Role and scope tests (PGlite, real PostgreSQL 17)

| Case | Expected | Result |
|---|---|---|
| Staff, manager, admin (active) | Read operational data | PASS |
| Staff assigned to one site | Reads every site, **as Firestore does today** | PASS (`cross-location`) |
| Any active person | Reads both brands, **as Firestore does today** (`brandData`) | PASS (`cross-brand`, new) |
| Inactive, unknown, anonymous | Read nothing | PASS |
| Revoked, while still marked active | Reads nothing | PASS |
| Own user row only; admin reads all; audit and outbox admin-only | — | PASS |
| Notifications | Recipients only | PASS |
| Any signed-in role, admin included | Cannot write | PASS |
| **Validly signed token from another Firebase project, with a known uid** | Reads nothing | **PASS (new)**. Fails without 0006 (checked) |
| Right issuer with the wrong audience | Reads nothing | **PASS (new)** |
| No trusted project configured | No browser reads | **PASS (new)**. Fails without 0006 (checked) |

**Owner decision, flagged rather than changed:** cross-brand and cross-site reads are
deliberately as wide as Firestore today. Narrowing them (for example, staff only see their
`siteIds`) is a policy change for **both** stores. It must not be introduced only in the
shadow, or the two would disagree about who sees what.

## 3. The read pilot: sized from measurements, not hopes

Main's after-fix benchmark (`read-budget-after.json`, real backup, emulator) is what
production runs today (`2a8d578`):

| Scenario | Billed reads now | What they are |
|---|---|---|
| Cold open, manager / staff (new device, or the daily full refresh) | **1,426 / 1,215** | `stockLevels.full` 524, `products.full` 336, `purchaseOrders.range` 132, notification sweep 134, suppliers 86 |
| Reopen on the same device | 12 | — |
| Dashboard | **0** | — |
| Supplier performance | **0** | — |
| Movement history | **0** | — |
| Purchase orders, route switching ×3 | **0** | — |
| Receiving | 50 | `purchaseOrders.by.status` |
| Products (first time) | 80 | images |
| Reconnect after a long absence / second tab | 24 / 39 | deltas |

**The surfaces the brief suggests piloting (supplier performance, historical reports,
movement history, dashboard aggregates) cost 0 Firestore reads on a warm device.** They read
from device copies and range caches that the app keeps anyway. Moving them to Supabase would:

- **save about 0** on the daily bill;
- add a second source of truth on screen;
- add a supabase-js client.

**I do not recommend a pilot on those pages for read savings.** A pilot there is justified
only for **capability**: queries Firestore cannot do cheaply, such as 12-month reports,
cross-period aggregates and full-text search (G23). It should then be measured as **new
reads avoided**, not existing reads saved.

### Where the remaining reads actually are

About **1,000–1,400 per device per day**, from the cold or daily full refresh of `stockLevels`
and `products` (device copies are re-read in full daily or weekly to guard against clock skew),
plus the open-PO range.

**Pilot proposal (needs owner approval, not built): "shadow seed + Firestore delta".**

- **Steps.** Behind `VITE_SHADOW_SEED=1`, plus a per-brand remote kill switch:
  1. A device with an empty or expired copy reads `stock_balances`, `products` and the PO
     range from Supabase, at a recorded **watermark** (the Worker's last applied
     `updatedAt` per collection).
  2. It then runs the **existing** Firestore delta query: `updatedAt > watermark − skew`.
- **Firestore stays authoritative for everything after the watermark.** Every write still
  goes through Firestore and its rules.
- **It must never be used when:**
  - `replication_status` lag is above 10 minutes, or
  - the last parity run is not PASS or is more than 24 h old, or
  - the dead-letter count is above 0.

  In each case the device falls back to today's full Firestore read.
- **Expected effect** [model, not measured]:
  - about 1,000–1,300 reads saved per cold or daily refresh per device;
  - at 10 devices, that is about **10–13K reads per day** off about 18K (the estimate on main).
- **Measurement before any claim.** Rerun `e2e/read-budget.spec.ts` with the flag on against a
  local shadow (PGlite or Supabase local). The claim is valid only when `stockLevels.full`,
  `products.full` and `purchaseOrders.range` disappear from the cold-open labels, and the
  billed delta matches.
- **Risks:**
  - Deleted documents do not appear in an `updatedAt` delta. `stockLevels` and `products` are
    soft-deleted (`active`/`deletedAt`), so this is covered, but it must be tested.
  - A wrong shadow row would be shown until something changes it. The parity gate and the lag
    gate above are what make this acceptable.
  - The owner must accept a second read path for balances on cold devices.

This is the only Supabase read change I found that moves the Firestore bill measurably.

## 4. Gaps to close before any production Supabase access (owner gates)

1. A **real Supabase project** (Singapore), then backfill from the latest backup, then
   parity PASS on both brands. **Owner.**
2. The `role: authenticated` claim script and the user-creation hook (§2).
3. **A lag alert.** The Worker should write `lagSeconds` and `deadLetters` into
   `meta/shadowStatus`, and the app's admin health panel should show red above a threshold.
   Small; proposed for the next batch.
4. **A transfer-conservation parity check:** dispatched = received + in transit + variance,
   per transfer and per product.
5. **The Worker's cron handler.** The live Worker declares only `fetch`
   (`firestore-read-investigation.md` §1). Shadow sync runs on cron, so it would not run
   either. Verify this before relying on replication.
