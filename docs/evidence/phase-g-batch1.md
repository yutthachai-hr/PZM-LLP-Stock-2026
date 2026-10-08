# First approved batch (G18, G19, G21, G25) + outbox merge + supplier feedback: evidence

Branch `claude/phase-a-ledger-continue-uzbbb5`. Checkpoint pushed before the batch: `2ae7bbb`.
Owner decisions of 7 Oct 2026. **Nothing was merged to main, deployed, or frozen.**

## What was done, in order

| Step | Commits | Result |
|---|---|---|
| Push the checkpoint | `2ae7bbb` | Pushed after all gates passed |
| Verify upstream sources | `1c7cda5` | `docs/agent-safety/02-upstream-verification.md`: laya.aay.sh is the wrong project; Dancing-coin/l-aya is a fork of NandhaKishorM/laya; HF checkpoints pinned by SHA. Nothing installed. |
| Merge `feat/outbox` | `49ec21f`, `e3df8db` | Merged into this branch. The outbox writes **only with `OUTBOX_ENABLED=true`** (off by default). Worker replication only with `SUPABASE_DB_URL`. |
| Supplier override feedback | `0731af0` | Filed in the existing append-only `auditLog` (`supplierResolution.override`). No new collection, no rules change. |
| G25 freshness + optimistic concurrency | `db8f1dd` | See below |
| verify runs the rules suite | `e4b6fb7` | The emulator works on this machine (Java 21) |
| G18 correlation ids | `aa2e35b` | See below |
| G19 workflow state machines | `5e925a1`, `f701721` | See below |
| G21 verification | (this commit) | See below |

## G25: data freshness and optimistic concurrency

- **Version on every write.** Products and POs carry `version`, which every write moves:
  - the client backends (Firestore, local, test) add an atomic +1 (`INCREMENT` →
    Firestore `increment`);
  - the server's stock commands and the supplier link derive it from the copy they read,
    under that copy's `updateTime`.
- **Stale edits are refused.** An edit made from a loaded copy states `expectedVersion`; a
  stale one is refused inside the transaction. The change and its audit entry are refused
  together. Wired today: the product editor (except right after a unit change, which moves the
  version itself) and the PO amendment.
- **Rules:** every non-admin product or PO update must move `version` by exactly 1. Admin
  maintenance (restores) is exempt; admin edits are covered by the app's check.
- **Contract versions:** the `CONTRACTS` registry covers ActionProposal, SafetyDecision,
  OutboxEvent, PredictionSnapshot, AuditEvent, IntegritySnapshot and LayaDecision, through
  `supported()`.
  - The outbox consumer never applies an unknown `schema_version`: such an event fails, then
    becomes a dead letter and stays visible.
  - Guard results now say `safety-decision/1`.
- **Execution freshness:** `EXECUTION_MAX_AGE_MS` (5 min) and `isFresh()` are ready for Phase H
  execution.

## G18: correlation

- **`src/lib/trace.ts`:** `traceId` (32 hex), `requestId` (16 hex), `operationId` (existing),
  and the `x-pzm-trace` / `x-pzm-request` headers. One structured log line with **an allow-list
  of keys** (ids, stage, outcome, code, ms, count, brand), so a payload cannot ride along.
- **The path:**
  - **App:** a workflow per receipt review; `callCommand` sends the trace and logs its call.
  - **API:** validates or creates the ids, echoes them back, logs one line.
  - **Outbox events:** stamped with all three ids.
  - **Worker:** carries them to Supabase (migration `0005_trace_ids.sql`, with checked columns
    and an index) and logs one traced line per cron job.
  - **Audit entries and notifications:** carry the active workflow; the rules allow it only
    as an id.
  - **Laya requests and decision records, and ActionProposal:** an optional, additive `traceId`.
- **Exit-gate test** (`tests/functions/trace-e2e.test.ts`): one receipt is followed by its
  traceId through the API log line, every outbox event, and the rows in a real Postgres
  shadow (PGlite). The invoice number, product names and the person's name appear in **no** log
  line.
- **Not traced yet:** the Gemini OCR call, and the supplier-link endpoints (they get fresh ids
  but log nothing).

## G19: workflow state machines

- **`src/lib/workflow.ts`:** five machines in one format: PO, receiving, monthly count,
  purchase request, transfer.
  - `transition()` refuses an invalid move **centrally**, using the same words as before (so
    existing tests and translations are unchanged).
  - `available()` and `can()` tell screens which buttons to show.
- **Services that now go through it:** receivePO; approve, amend, close-short, cancel and
  delete-draft on a PO; count, record and post on a monthly count.
- **Screens:** the order panel's action buttons and the count sheet's buttons come from the
  machine.
- **Request and transfer machines** name actions over their existing tables. A **drift test**
  proves every edge is allowed in those tables.
- **Tests:** 102. They cover soundness (terminal states have no exits; every state is
  reachable), the PO matrix cell by cell (states × actions × roles), the count rules, and
  receive-once / retry.
- **Partial:** the goal of "no status-transition conditionals in UI code" is **not complete**.
  Action decisions moved, but display comparisons remain: the order panel has 13 (was 14) and
  the count sheet 6 (was 9). They are labels, steppers, badges and list filters. The Orders
  list, calendar drawer, request and transfer screens were not migrated.
- **Roles:** the machines' roles drive the UI. On the server, roles are still enforced by the
  rules and the command role lists; the services do not re-check them.

## G21: verification

- **Property tests (fast-check, 8 properties, seeded):**
  - the ledger is order-invariant, and voided rows do not count;
  - the integrity reference never reports drift when levels are caught up, reports exactly
    one changed level, and is deterministic;
  - the guard is invariant to arbitrary untrusted text (500 random strings) and monotone in
    quantity;
  - the canonical hash ignores key order;
  - in optimistic concurrency, only edits made from the current version land;
  - workflow machines stay inside their states, and terminal states are absorbing.
- **Rust property tests** (`crates/pzm-integrity/tests/props.rs`) use a seeded generator and
  add no dependency (the crate remains serde-only). They cover 500 consistent snapshots, 500
  single-drift cases, 300 permutations, 300 odd-but-valid inputs (no panic), and malformed
  JSON returning an error rather than panicking.
- **Differential** (`npm run integrity:diff`, now in `verify`): fresh random snapshots each
  run, through both engines via the new `--batch` CLI.
  - Seeds 1, 2 and 3 × 1,033 snapshots, about 82,000 findings in total: **0 disagreements**.
  - Mutation check: Rust rounding changed to `f64::round` gives **1 disagreement**, so the test
    can fail.
- **Mutation testing** (`npm run mutation`, Stryker, pre-release only): configured, but **no trustworthy score**. Stryker 10 does not apply mutants under this repo's Vitest 5; see `integration-ops-os-rc1.md`. The hand-run mutation checks above are the mutation evidence for now.

## Gates

| Gate | Result |
|---|---|
| Types (4 projects), lint, i18n | PASS |
| Unit | PASS (about 1,590 tests; 1 skipped needs a production backup) |
| Rules emulator | **PASS, 243 tests, run locally** (it was cloud-only before) |
| Rules expression budget (widest orders) | PASS with the version rule |
| Safety dataset / vectors fresh, safety bench | PASS (unsafe-allow 0) |
| Rust cargo test + properties | PASS |
| Differential TS ↔ Rust | PASS (0 disagreements) |
| e2e / flaky runs | **Not run here.** Cloud container. |

## Regressions found during the batch (all fixed)

1. **Client/server parity broke** when the client started versioning POs and the server did
   not. The parity test caught it; the server now versions too.
2. **The backtest leakage test timed out** (about 1 s alone, over 5 s next to the new PGlite
   tests). It was given an explicit timeout; the check is unchanged.
3. **Process:** two commits went in while a gate was red (`858d2af` had a partial patch;
   `5e925a1` had a missing i18n key). Both were fixed in the next commit. Commits are now
   gated on verify's real exit code.

## Runtime impact

| Item | Reads | Writes | Other |
|---|---|---|---|
| G25 | **0 added** (transactions already read the doc) | +1 small field per product/PO write | Rules: a few expressions on product/PO updates; the budget tests pass |
| G18 | **0 added** | Outbox events +3 small fields; audit/notifications +1 optional field | 2 request headers; 1 log line per command and per cron job; Supabase +3 columns and 1 partial index |
| G19 | 0 | 0 | Pure |
| G21 | 0 | 0 | CI time: properties about 2.5 s, differential about 10 s; mutation is pre-release only |
| Outbox (merged) | 0 | **None until `OUTBOX_ENABLED=true`**, then +1 per changed entity per command | — |

## Deployment hazard (owner decision before any deploy)

The new rules refuse a non-admin product or PO update that does not move `version`.

- **The app must be deployed before the rules.** A PWA tab still running old code will get
  permission errors on those writes until it reloads.
- **Options:**
  - deploy the app, wait for the update prompt to reach users, then deploy the rules; or
  - ship a one-release transition rule that also accepts an unchanged version.

  The transition rule would weaken stale-write protection for that release.

## Recommended next batch

1. **G20 policy layer.** It now hangs naturally off the G19 machines: CanApprovePO,
   CanReceivePO, CanTransfer, CanOverrideOverReceipt, CanPostVariance, CanAgentCreateDraft and
   CanAgentExecute, each returning ALLOW / DENY / REQUIRES_APPROVAL from one place. The rules
   stay authoritative.
2. **G22 chaos / circuit breakers** for OCR, Gemini and Laya, with the 12 failure scenarios.
   G18 gives the evidence trail.
3. **G26 restore drill.** The outbox is merged now; restore a backup into an isolated project,
   then run the Rust verifier.
4. **Finish G19's UI part:** the Orders list, the calendar drawer, and the request and transfer
   screens.
5. **Later:** G24 registry (when a second real model exists), G23 Postgres search (when
   Supabase is live), G27 (design only).

## RC readiness against the owner's list

| Requirement | Status |
|---|---|
| G11–G17 complete and evidenced | G11–G16 **done**; G17 harness **done**, Laya **not yet evaluated** |
| G18 / G19 / G21 / G25 complete and evidenced | Done; G19 UI migration **partial** |
| Outbox integration gate | Merged; unit/shadow tests pass; **real Supabase project not connected** |
| Cloud emulator gates | Rules **pass locally**; **e2e and flaky runs still to run in the cloud** |
| Firestore read-budget gate | 0 added reads by design; **the read benchmark (e2e) was not re-run** |
| baseQty production-backup dry-run | **Owner** (needs the backup) |
| No unresolved P0/P1 | No P0/P1 known; the deployment hazard above is an owner decision |
| Clean unit / rules / typecheck / lint / i18n / build | Pass |
| Release workflow from a clean checkout | **Not yet done** |

**RC not frozen**, as instructed.
