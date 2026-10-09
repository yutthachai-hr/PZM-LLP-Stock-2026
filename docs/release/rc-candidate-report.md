# Release candidate report: `rc/ops-os-rc1-candidate` (8 Oct 2026, night)

**Status: stopped at the owner-approval gate.** Nothing was merged to `main`, deployed, cut over
or frozen, and no repository policy was changed.

Each fact is marked **[verified]** (read, run or tested today) or **[assumption]**.

## 1. Heads

**[verified]** `git fetch` at about 21:00 ICT:

| Ref | Commit | Note |
|---|---|---|
| `origin/main` | `ad43971` | Production is deployment `614fcc13` = `ad43971` |
| `origin/integration/ops-os-rc1` | `0261c48` | Last pushed |
| Local `integration/ops-os-rc1` | `d73fbc6` | 11 commits ahead of its remote, 0 behind; clean tree |
| **`rc/ops-os-rc1-candidate`** | the commit carrying this report | Cut from `d73fbc6`; `origin/main` merged; the batch below |
| `feat/login-mascots` (other worktree) | `8212a27` | Login redesign; separate branch, not in the candidate |

## 2. Git reconciliation

- The **candidate** was cut from the verified local HEAD `d73fbc6`. Nothing local was
  discarded; nothing was reset or force-pushed.
- **`origin/main` merged** (`4b1d6e9`): the official R&D logo and theme (`903c8db`) and the
  card-based import review (`ad43971`).
- **One conflict,** in `scripts/i18n-check.mjs` `DATA_ONLY`. It was resolved as the **union**
  of both sides (this branch's `agent/` and `commands/`, main's `lib/productSuggest.ts`).
- Earlier the same day `6eda5a9` merged main's R&D brand (`476fa35`), with **semantic
  fixes**. The server stock commands, trace, shadow, Worker sync and e2e stager now know
  `rnd`. The rules gained `rnd__auditLog` and `rnd__intelShadow`. Supabase gained 0007.

## 3. New R&D integration risks

Details: `docs/evidence/import-safety-and-rnd-audit.md`.

| Risk | State |
|---|---|
| **All 228 R&D catalogue rows have no unit or unit type** [verified] | **Mitigated in code:** every stock path refuses a product with no unit (tests). **Open for the owner:** set the units. Live data unverified [assumption]. |
| Supplier links (476fa35) made in live data, not in the repo | **Unverified** [assumption]. Brackets are never used as the supplier. |
| R&D could not read its cache epoch (this branch's rule) | **Fixed** (`e179dc5`); rules test |
| R&D receiving refused by the server commands' brand check (this branch) | **Fixed** (`6eda5a9`); test |
| Cross-brand leakage | **None found:** app and server route identically for every collection × 3 brands, stable across switching (tests) |
| 5 "(OTHER)" placeholders with no unit | Superseded for requests by Smart Other (R&D); still not stockable |

## 4. Import matching safety

**PASS** [verified]. A guessed (fuzzy) product is no longer pre-ticked, and is imported only
after the person confirms it. Ambiguous names stay unmapped. Unknown units, products with no
unit and zero quantities are **blocked**. (Before, an unknown unit could be filed as the base
unit.)

This covers every consumer: request, order, count, adjust and line builder. Receiving was
already sure-match-only, and a test now pins it. 15 tests.

## 5. Exact test counts

**[verified]** Run from a **clean checkout** of `44554aa`: a separate worktree outside
OneDrive, `npm ci`, then the gates.

| Gate | Result |
|---|---|
| Types: app, functions, worker, e2e | PASS |
| Lint, i18n | PASS |
| Unit (Vitest) | **PASS: 1,777 passed, 1 skipped** (the skip needs `PZM_BACKUP`) |
| Rules emulator | **PASS: 249** (incl. rolling-release strict vs transition) |
| Rust `cargo test` | PASS |
| TS ↔ Rust differential (fresh random seed) | PASS, 0 disagreements |
| Agent safety: dataset, vectors, bench (unsafe-allow 0) | PASS |
| Transition rules fresh | PASS |
| Build, bundle budget | PASS |
| **e2e, 3 consecutive full runs, no retries** | **PASS: 39 passed, 0 failed, 0 flaky, ×3** (1 skipped each: the read-budget spec needs `PZM_BACKUP`) |

## 6. CI readiness

| Item | State |
|---|---|
| `.github/workflows/ci.yml` | **Active since 9 Oct (owner decision 3)**, actions pinned to SHAs. Nine jobs: typecheck, lint-i18n, unit, agent-safety, rust (+ differential), rules (+ transition freshness), build-budget, e2e (incl. read benchmark), secrets (gitleaks + a `VITE_*SECRET` check, run locally: clean). |
| `branch-protection.json` | Ready, **not applied**. Requires exactly those 9 checks and 1 approval; no force pushes or deletion. |
| Validation | `tests/ci-proposal.test.ts`: every script exists; every verify gate has a job; required checks = jobs |
| Not done | A real GitHub Actions run, which needs the files in `.github/` (owner) |

## 7. Firestore production usage

**BLOCKED (owner).**

- The 6 Oct spike (about 690K) is an **open incident**: about 70–80% is unattributed
  (`docs/evidence/firestore-read-investigation.md`).
- **[verified]** The live indexes match the repo (6 = 6, R&D included).
- **Live rules: unverified.** The CLI cannot show deployed rules.
- **Needed:** the hourly `read_ops_count` (QUERY / LOOKUP) export for 5–8 Oct
  (`docs/ops/owner-gates.md` §C).

## 8. Cron Worker

**BLOCKED (owner)** [verified]:
- `pzmstock-cron` is the placeholder made by `wrangler secret put` on 7 Oct: `fetch` only,
  no deploy since.
- A live tail across a cron slot captured **0 events**. No cron has ever run server-side.
- Deploying it would cost about **+3–6K reads a day** (measured); `morning` reads the whole
  brand.
- Not redeployed.

## 9. Supabase readiness

**BLOCKED (owner)** [verified in PGlite only]:
- Migrations 0001–0008 apply.
- RLS includes the 0006 issuer pin and 0007 R&D.
- The seed pilot is tested (12 tests) and measured (2,913–3,019 → 1,071 reads per cold
  device, against a stand-in).
- **No real project.** So the following are **NOT RUN**:
  - real backfill and parity;
  - outbox replication against Supabase;
  - auth claims;
  - Data API exposure.

## 10. Outstanding P0 / P1

| # | Item | Severity | Owner? |
|---|---|---|---|
| 1 | 6 Oct read spike unattributed | P0 (operations) | Yes: export |
| 2 | **24 of 24** pre-isolation previews still reachable, all production-connected | P0 (security) | Yes: delete (§A) |
| 3 | R&D products have no units | P1 (data) | Yes: set units |
| 4 | Cron Worker never deployed | P1 | Yes: decide |
| 5 | Shared preview KV / AI bindings, preview Gemini key | P1 | Yes |
| — | Code: no open P0 / P1 on the candidate | — | — |

## 11. RC readiness matrix

| Area | Result |
|---|---|
| Unit / Rules / Rust / differential | **PASS** |
| e2e ×3 consecutive clean (clean checkout) | **PASS** |
| Security regressions (issuer pin, rules, hostile client, preview guard, stock guard) | **PASS** |
| Cross-brand isolation | **PASS** |
| Inventory correctness (properties, parity, unit guard) | **PASS** |
| Supplier / document workflows (e2e business flow, Smart Other, imports) | **PASS** |
| Read-budget regression (read benchmark spec, seed pilot) | **PASS** (fixture). Real-backup budget: **NOT RUN** |
| DB schema compatibility (Supabase 0001–0008, PGlite) | **PASS** locally; real project **BLOCKED** |
| Safe deployment order (G25 transition rules, emulator-proven) | **PASS** (design and test). Live rollout **NOT RUN** |
| Rollback readiness | **PASS** (documented; previous production `0d00ae76`; flags off by default) |
| Preview isolation (live preview `e2bd3503`) | **PASS**. Old previews: **BLOCKED (owner)** |
| BaseQty production-backup dry run | **BLOCKED** (backup file) |
| Restore rehearsal | **NOT RUN** (isolated project needed) |
| Real-data Phase G evaluation | **NOT RUN** (backup needed) |
| GitHub Actions | **NOT RUN** (proposal only) |

## 12. Recommended release sequence (each step is an owner decision)

1. **Delete the 24+ old previews** (§A), and give previews their own bindings and keys.
2. **Push** `rc/ops-os-rc1-candidate`. Its preview is isolated, so this is safe.
3. **Activate CI** by copying `ci.yml` to `.github/workflows/`. Watch it pass, **then** apply
   branch protection.
4. **Set units on R&D products** that will hold stock.
5. **Export the 5–8 Oct hourly reads** and close or reopen the 6 Oct incident.
6. Open a PR from the candidate to `main`, review, merge.
7. **Deploy in this order:**
   1. Deploy **`firestore.transition.rules` + indexes** (`firebase deploy --only
      firestore:rules,firestore:indexes` with the transition file set in `firebase.json`).
      Both old and new tabs keep working.
   2. Deploy the **app** (Pages builds `main`).
   3. **Prove** old PWA tabs have updated: zero stock commands without the new `build` in the
      function logs (`docs/release/deployment-runbook.md` §6). A fixed wait is not proof.
   4. Deploy the **strict `firestore.rules`**.

   **How old tabs behave:**
   - On transition rules, an old tab's product and order edits succeed (version unchanged).
   - On strict rules, an old tab gets "insufficient permissions" on those edits until it
     reloads (proven on the emulator).
   - An old tab never writes a wrong stock figure. Stock writes go through commands, which
     version on the server.
8. **Later, separately:**
   - the cron Worker (after the read budget allows it);
   - a Supabase project and the read pilot;
   - restore rehearsal;
   - baseQty dry run with the backup.

**Rollback at any step:** redeploy the previous production deployment (`0d00ae76`) from the
Pages dashboard. Transition rules are safe for both builds. All new features are flagged off
by default: seed pilot, Smart Other switch, outbox.
