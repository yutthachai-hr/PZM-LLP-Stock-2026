# P1 Supabase cold-start seed pilot: evidence (8 Oct 2026)

**Status: built, tested and measured against a stand-in shadow. OFF by default; not enabled
for anyone.** It needs the owner's real Supabase project (gate §5) before a single
production device could use it. Firestore stays authoritative; no client writes Supabase.

## What it does

A device with no copy of `products` or `stockLevels` (a new device), or with a day-old one
(the daily full re-read), normally reads the whole collection from Firestore. With the
pilot:

1. It asks the shadow for its **proof** (`shadow.seed_status`, migration 0008), which holds
   four things:
   - the **completeness watermark** the Worker recorded (every document stamped before it is
     applied);
   - the unresolved event count;
   - when it was proven;
   - when parity last passed.
2. If the proof is good, it reads the rows through the existing RLS (paged, 1,000 at a
   time) and checks that the count matches.
3. It then starts the **existing** Firestore change listener **from the watermark** (less
   the usual skew), not from the newest row held.
   - So Firestore delivers every change the shadow might not have yet, and those changes
     replace seeded rows.
   - The copy is saved only after Firestore's first delta is folded in.

**It falls back to today's full Firestore read when:**
- the pilot is off, the brand is not listed, or the browser switch says `off`;
- the copy was dropped because an admin change bumped the **cache epoch**;
- there is no proof, or it is older than 40 minutes;
- any event is unresolved;
- no parity check has passed in 24 hours, or **since the epoch**;
- the row count is wrong;
- an error occurs, or the shadow takes longer than 4 seconds.

| Piece | File |
|---|---|
| Client (flag, transport, gates, mapping) | `src/data/shadowSeed.ts` |
| Wiring into the existing full read | `src/data/syncedCollection.ts` (one branch, before `getAll`) |
| Worker: records the watermark after each run | `worker/src/shadowSync.ts` `recordWatermarks` |
| Proof table and function | `supabase/migrations/0008_seed_watermarks.sql` |
| R&D brand in the shadow | `supabase/migrations/0007_rnd_brand.sql` |
| Meter: seed rows kept apart from Firestore reads | `src/data/readMeter.ts` `noteSeed` |

## Tests: `tests/shadow/seed.test.ts`, 12 tests, all pass

Real PostgreSQL 17 (PGlite), migrations 0001–0008, real RLS.

| Required | Covered by |
|---|---|
| Snapshot freshness | Proof older than 40 minutes → `stale-proof` |
| Authorization and RLS | Revoked, unknown and **foreign-project** callers get no proof (`no-status`) |
| Deleted documents | A soft-deleted product is not seeded, and the count agrees |
| Cache epoch invalidation | Epoch after the last parity run → `epoch-after-parity`; a copy dropped for an epoch change is never replaced by a seed |
| Concurrent updates | Firestore deltas after the proof replace seeded rows |
| Watermark / delta consistency | The delta starts at the proof, never at the newest held row |
| Connection failure / offline | `transport-error`; a hung shadow → `timeout` after 4 s → Firestore |
| Replication lag | Unresolved (dead) event → `unresolved-events`; stale proof → `stale-proof` |
| Revoked users | `no-status` (and Firestore refuses them too) |
| Multi-brand isolation | A Pizza seed holds no Le Lapin row, although RLS allows both |
| Rollback | Off by default; on only with every setting; a browser switch `pzm.shadowSeed=off` turns it off with no deploy; a rebuild without the flag removes it |
| Transport | Read-only (POST to the RPC, GET for rows); the person's Firebase token; the `shadow` schema; pages of 1,000 |

Not covered by an automated test:
- A real offline-then-reconnect cycle in the browser. The transport failure path is covered.
- A real Supabase project.

## Measured: `e2e/seed-pilot.spec.ts` → `docs/evidence/data/seed-pilot.json`

**Setup:**
- The same production-sized brand as the read benchmark (`bigFixture`: 460 products, 1,380
  balances, 2,700 movements, 120 orders).
- The same cold open: a new device signs in and lands on the dashboard.
- The shadow is a stand-in serving the emulator's own data, with a proof **30 minutes old**.
  So Firestore must supply every change since.

| Run | Firestore reads, pilot off | Firestore reads, pilot on | Saved | `products.full` + `stockLevels.full` | Shadow responses |
|---|---|---|---|---|---|
| 1 | 3,019 | 1,071 | 1,948 | 462 + 1,380 → **0** | 230,205 bytes, 5 requests |
| 2 | 2,913 | 1,071 | 1,842 | same | same |
| 3 | 2,913 | 1,071 | 1,842 | same | same |

**Consistency:**
- The deltas after the watermark were identical with the pilot off and on (19 balance and
  9 product documents).
- Both seeds report `used`, with the full row counts (462 and 1,380).

## What it would save in production: projection, not measurement

- **Per cold or daily re-read of one device:** about **860 reads** at today's real Pizza
  Mania size (336 products + 524 balances), and about 1,840 at the fixture's size. Measured
  above at fixture size.
- **Per day:** about 1 full re-read per device (`FULL_EVERY_MS`, 1 day). With about 10
  devices: **about 8–9K Firestore reads a day saved** on Pizza Mania. The earlier estimate of
  10–13K also counted the PO range, which this pilot does not seed.
- **Supabase egress:** about 230 KB per cold device at fixture size, about 140 KB at real
  size. About 1.4 MB a day, so about 45 MB a month, against the free plan's 5 GB.
- **Not measured: real Supabase latency.** The 4-second timeout bounds the worst case, and
  falling back costs exactly today's reads.
- **Cost of the Worker side:** `recordWatermarks` is a few small SQL upserts per run. It
  needs the cron Worker actually deployed (owner gate B).

## Before any production device could use it (owner gates)

1. A real Supabase project. Then backfill from the latest backup, then parity PASS for
   **all three** brands (`npm run shadow`).
2. Third-party auth (Firebase), the `role: authenticated` claim on every user, and the
   `shadow.auth_settings` row (migration 0006).
3. The cron Worker **deployed** (gate B). Without it no watermark is ever written, and the
   pilot always falls back.
4. Expose the `shadow` schema to the Data API.
5. A build with all four of these:
   - `VITE_SHADOW_SEED=1`
   - `VITE_SUPABASE_URL`
   - the **publishable** key
   - `VITE_SHADOW_SEED_BRANDS=pizza`

   Start with one brand and one or two devices. Compare their read meters with the
   others for a week.
6. **Never** the service-role key in any `VITE_*`.
