# SUPABASE PRODUCTION READINESS (9 Oct 2026)

**Verdict: NOT READY for production, by design at this stage.**

| | |
|---|---|
| Authoritative store | Firestore remains authoritative |
| Cutover | None |
| Production backfill | None |
| Browser reads | None |
| Plan | `docs/release/supabase-readiness.md` |

**Existing project "PZM-LLP-Stock-2026":**
- The owner showed it. It is **unverified by Claude**: no credentials were provided in this
  session, and its configuration is unknown.
- It must **not** be assumed to be correctly configured, connected, or production-safe.
- No second production project will be created. Staging uses a **separate, independent**
  Supabase project.

| Item | Status | Evidence / what is needed |
|---|---|---|
| Migrations 0001–0008 | **PASS** locally (PGlite) / **NOT_RUN** on a real project | Staging credentials |
| `public.shadow_migrations` RLS | **NOT_RUN** on real | The bookkeeping table must not be readable by `authenticated`. To check on staging. |
| JWT issuer / audience pin (0006) | **PASS** locally | Restrictive policy; no settings row means no browser reads |
| Firebase **staging** identity | **BLOCKED** | Staging Firebase project + Third-party auth |
| R&D schema (0007) | **PASS** locally | — |
| RLS, zero unauthorised access | **PASS** locally / **NOT_RUN** real | Matrix in readiness plan §3 |
| Service-role secret isolation | **PASS** (design) | Worker secrets only; never Pages or `VITE_*` (CI `secrets` job checks `VITE_*SECRET`) |
| Backfill from staging backups | **NOT_RUN** | Staging data |
| Outbox / parity | **PASS** locally / **NOT_RUN** real | — |
| Deletion / replay | **NOT_RUN** real | — |
| Revocation latency | **Known gap:** up to ~90 min (30 min replication + 1 h token) | Must be closed before any browser read |
| Real cold-start read savings | **NOT_RUN** | 1,071 figure is against a stand-in |

**Projected monthly cost [estimate]:**
- Supabase free tier for the shadow: ≈ 0.
- Pro, if needed for backups or PITR: about US$25 a month.

**Rollback:** drop the `shadow` schema of the staging project. Production is untouched.

**Owner actions:**
1. Confirm what "PZM-LLP-Stock-2026" is, and who created it when.
2. Create the separate staging project and provide its credentials for one session.
3. Decide on the revocation design before any browser read.
