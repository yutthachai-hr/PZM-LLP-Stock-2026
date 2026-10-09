# Supabase: real-project readiness plan (owner approval 6, 9 Oct 2026)

**Firestore stays authoritative.** This plan creates and checks a real Supabase project in
**isolation**. It does not:
- backfill production;
- switch any read;
- turn on cutover.

The project steps need the owner's credentials. Everything before them is already tested locally
against PostgreSQL 17 (PGlite).

## 0. What exists today [verified 9 Oct]

| Item | State |
|---|---|
| Migrations 0001–0008 | Apply cleanly on PGlite; `npm test` (shadow, outbox, seed suites) |
| RLS (0004) + issuer pin (0006) + R&D brand (0007) | Tested on PGlite with a shim for `auth.jwt()` |
| Backfill / parity / replicator code | `src/shadow/*`, `scripts/shadow.mjs`; tested on fixtures |
| Seed pilot read saving | 2,913–3,019 → **1,071** reads per cold device, measured against an **in-memory stand-in**, not real Firestore |
| Real Supabase project | **Not connected.** The README mentions a project created 7 Oct; it is unverified, and no credentials are in this environment. |

## 1. Project (owner, about 15 minutes)

1. Create **`pzm-shadow-staging`** in Singapore. Separate from any production project.
2. Third-party auth → Firebase → the **staging** Firebase project, never `pzm-stock-x5` for
   staging.
3. Give Claude, for one terminal session only:
   - the Session-pooler connection string, with the password set as `SUPABASE_DB_PASSWORD`;
   - nothing else.
   - Never through chat, never in Git.

## 2. Migrations (Claude, with the credentials, reversible)

- [ ] `npm run shadow -- migrate --pg`. Applies only missing migrations; safe to repeat.
- [ ] `insert into shadow.auth_settings (firebase_project_id) values ('<staging-project>');`.
  Without it no browser reads anything (fails closed).
- [ ] **Down path:** drop schema `shadow` cascade. The project holds nothing else.

## 3. Identity and RLS (all three brands)

| Check | How | Pass when |
|---|---|---|
| Firebase ID token accepted, `sub` = uid | Sign in a staging user; `select shadow.me_uid()` through the Data API | uid returned |
| Token from another Firebase project refused | A token from a throwaway project | 0 rows from every table |
| Active user reads Pizza Mania, Le Lapin and R&D operational data, as the Firestore rules allow | select from each brand's rows | rows from all three brands, none from other tables beyond the rules |
| Inactive user, revoked user | Set `active=false`, then set `revoked_at` | 0 rows |
| Browser writes | Insert, update or delete as `authenticated` | Refused (no grant, no policy) |
| Admin-only tables (audit, outbox, parity) | As staff | 0 rows |

**Revocation gap (known):**
- Firestore `revokedUsers` reaches Supabase `app_users.revoked_at` on the replicator's schedule
  (every 30 minutes).
- A revoked person's Firebase token also stays valid for up to 1 hour.
- So **revocation can lag by up to about 90 minutes** on the shadow.
- Acceptable while no browser reads Supabase. Before any browser read:
  - replicate `revokedUsers` immediately (outbox event);
  - or check revocation in an edge function.

## 4. Data correctness (staging data only)

- [ ] **Backfill** from a staging backup. **Parity PASS** for every table and brand.
- [ ] **Outbox idempotency:** replay the same events twice. Row counts and balances are
  unchanged (the unit test exists; repeat it against the real project).
- [ ] **Snapshot consistency:** a stock command during a backfill. Parity still PASS after the
  replicator catches up.
- [ ] **Deletions:** delete a product and a PO line in staging Firestore. The shadow marks or
  removes them, and parity PASS.
- [ ] **Replay:** reset the checkpoint and replay from zero. Same end state.

## 5. Cold-start read saving against REAL Firestore

- [ ] On the staging Firebase project with a realistic catalogue, open the app cold
  (`VITE_SHADOW_SEED=on` vs off) and count reads with the in-app read meter **and** Cloud
  Monitoring.
- [ ] **Report both.** The 1,071 figure stands only if the real number is close.

## 6. What stays forbidden without a separate decision

- Production backfill.
- Supabase reads by production browsers.
- Any write path through Supabase.
- Cutover.
- Turning on the Worker's replication against production.

## Status for the Go/No-Go

| Item | Status |
|---|---|
| Steps 2–5 | **BLOCKED**: owner credentials for a staging project |
| Everything in §0 | **PASS** locally |
