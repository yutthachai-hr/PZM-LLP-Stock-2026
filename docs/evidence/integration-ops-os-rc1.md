# integration/ops-os-rc1: evidence (8 Oct 2026)

Owner's instructions of 8 Oct. **Not merged to main, not deployed, not pushed** (see "Push
held" below). RC is **not** frozen.

## Step 1: integration branch, then `origin/main` merged in

- **Created** `integration/ops-os-rc1` from the Claude branch at `99ef7ea`. The Claude branch
  was not rewritten or force-pushed.
- **`origin/main` at `2a8d578` merged** in commit **`ba753aa`**. There were 21 conflicted
  files, all from one cause: both lines fixed the 6 Oct read incident independently.

| Area | Resolution | Why |
|---|---|---|
| Device caches / listeners | **main's** `useSynced`, device copies, `changedSince` | Deployed and measured |
| Range cache (orders, requests, transfers) | **main's** gap-only spans + `changedSince` | Same |
| Read meter | **main's** labelled meter; `noteListener`; the compatible `noteRead` | Same |
| Notifications | **main's** recipient-scoped inbox, served through **this branch's** own context (D2'), so a notification no longer re-renders every stock screen | Both kept |
| Listener failures (plan C1) | **Kept**, and **extended to main's `useSynced`**, which reported none | Products, balances and movements would otherwise fail silently |
| Cache epoch | **Kept** and wired into main's device copies (`copyIsCurrent`): an admin's restore, delete or correction forces a full re-read | A deleted or restored row moves no timestamp; main's copy would hold it for up to 7 days |
| Supplier intelligence provider | **This branch's** (the Phase G version, mounted in App); main's second mount in Layout removed | Same idea on both sides; this one is a superset |
| Firestore backend | main's API + this branch's `version` increment (G25), `page()` (audit log), metered `subscribeOne`, and both `onError` forms | — |
| Rules | Both: main's `audienceKeys` and this branch's `traceId` on notifications | — |
| e2e helpers | Both `putMany`s kept; main's renamed `putPaths` (different signatures) | — |
| Superseded code | `cachedLive.ts`, `persistKey.ts`, and the cached-live test removed. This branch's read-budget doc kept as `read-budget-release-hardening.md`, marked superseded | — |

## Step 2: `feat/outbox`

Already contained: it was merged into the Claude branch on 7 Oct (`49ec21f`).
- `origin/feat/outbox` (`15b428e`) is an ancestor of the integration HEAD.
- The local `feat/outbox` also has `a2f1c70` ("never print the connection string"), which is
  **not on GitHub**. It is in the integration branch and will be published when that is pushed.
- The outbox writes only with `OUTBOX_ENABLED=true`, which is off by default.
- Firestore stays the source of truth: no client dual-write, no cutover.

## Step 3: full post-merge gate (at `ba753aa`)

| Gate | Result |
|---|---|
| Types (app, functions, worker, e2e) | PASS |
| Lint | PASS (0 errors; old fast-refresh warnings only) |
| i18n | PASS |
| Unit | **1,678 passed**, 1 skipped (needs a production backup file) |
| Rules (emulator, run locally) | **242 passed** |
| Build | PASS |
| Bundle budget | PASS |
| Rust `cargo test` | PASS (vectors + properties) |
| Integrity vectors fresh | PASS (57) |
| Differential TS ↔ Rust | PASS: seed 425366697, 533 fresh snapshots, 13,988 findings, **0 disagreements** |
| Agent safety bench | PASS: unsafe-allow **0/227**, false reject 0/158, abstain 60/60, injection-invariant 24/24 |
| e2e (emulator, local) | see below |

## Step 4: the first G18–G27 batch

Order G25 → G18-lite → G21 → G19. Details and evidence: `docs/evidence/phase-g-batch1.md`.

## Step 5: G17

Unchanged: **NOT EVALUATED**, Kat/Reflex **NOT_RUN**, no numbers fabricated. The laya-v2
collection tool and anonymiser are ready (`npm run laya:collect`); the data has to come from the
owner. See `phase-g17-laya.md`, "Update 8 Oct".

## Step 6: GitHub release engineering

`docs/engineering/ci-proposal.md`. It covers:
- **Findings:** 0 workflows, `main` unprotected, no rulesets, **public** repository. Pages
  deploys `main` to production, and **every other branch preview connects to the live
  Firebase project**.
- **Proposed:** `verify.yml` and `nightly.yml` (YAML included), required checks, protection on
  `main`, and a one-line preview-safety fix.

Nothing was enabled.

## Step 7: HANDOFF

§0 "current state" now sits at the top of HANDOFF.md: canonical repo, integration branch,
HEADs, what is and is not deployed, Supabase status, Phase G/G17 status, and release blockers.
All history is preserved below it.

## Push held: why

Pushing `integration/ops-os-rc1` makes Cloudflare Pages build a preview **connected to the
production Firebase project**.

- This branch's client writes carry `version` and `traceId`. The rules deployed in production
  do not allow them yet, so product and PO edits through that preview would be **refused**: a
  safe failure, but unreleased code against live data.
- **Recommendation:** approve the one-line preview-safety change first (`ci-proposal.md`),
  then push.
