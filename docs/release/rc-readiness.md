# Release-candidate readiness: `integration/ops-os-rc1` (8 Oct 2026)

**HEAD:** see `git log -1`. The branch includes production `main` up to `476fa35` (R&D
brand). **Not merged to main, not deployed, RC not frozen.**

The local branch is **ahead of `origin` by 8 commits**, which are not pushed. Pushing is safe
for Cloudflare: this branch's preview builds isolated (`0261c48`). The push itself is left to
the owner.

## Matrix

### Code-complete work (this branch)

| Item | Result | Evidence |
|---|---|---|
| Full verification `verify --full` | **PASS** 15/15: types ×4, lint, unit **1,729** (1 skipped), i18n, datasets, vectors, safety bench, **Rust cargo test**, **TS ↔ Rust differential**, **rules emulator 242**, build, bundle budget | `npm run verify -- --full` |
| Firestore rules tests | **PASS** 242 (includes main's `rnd__*` and this branch's `rnd__auditLog` / `rnd__intelShadow`) | in verify |
| Rust differential | **PASS** 0 disagreements; Rust NaN-`per` bug **fixed** (found by the Goose diff) + vector 017 | `docs/research/goose-benchmark.md` §1 |
| Full e2e, 3 consecutive runs | **PASS** after Smart Other (`e179dc5`): 39 passed, 0 failed, 0 flaky, ×3, no retries (the 1 skip is the real-backup benchmark). Earlier attempts lost runs to OneDrive locking files: a Playwright trace (fixed `514faa3`) and Vite's dependency cache (now outside the repo) | 8 Oct, evening |
| Preview isolation (code) | **PASS** 20 unit tests; direct HTTP; browser network capture | `docs/evidence/preview-isolation.md` |
| Preview isolation (live, `e2bd3503`) | **PASS**, re-checked 8 Oct afternoon: privileged routes `503 preview_isolated` | same |
| Smart "Other" item (R&D) | **PASS** 12 matching + 6 server (concurrency) + 4 rules + 1 e2e request→PO→receive; 0 Firestore reads while typing | `docs/evidence/smart-other-item.md` |
| Stacked dialogs (P2) | **PASS** desktop 1440 + phone 375: Escape and Tab act on the top dialog, focus restored, axe clean | `e2e/dialogs.spec.ts` |
| Notification popup race | **PASS** (fixed; it was failing 3/3 full runs) | `514faa3` |
| R&D brand on server commands, shadow and Worker sync | **PASS** (tests: rnd receipt files only in `rnd__*`; shadow accepts rnd) | `6eda5a9` |
| Supabase parity (PGlite, synthetic + both brands' shapes) | **PASS** shadow suites (RLS, issuer pin, seed pilot 12 tests) | `tests/shadow/*` |
| Supabase seed pilot | **PASS** tests; **measured** 2,913–3,019 → 1,071 Firestore reads per cold device; **OFF** | `docs/evidence/supabase-seed-pilot.md` |

### Skipped tests: both need a real backup

| Test | Status | Why |
|---|---|---|
| `tests/shadow/real-backup.test.ts` | **NOT RUN** | needs `PZM_BACKUP` (owner's production backup file) |
| `e2e/read-budget.spec.ts` | **NOT RUN** | same |

### Owner-side cloud configuration: **BLOCKED (owner)**

| Gate | Status | What decides it |
|---|---|---|
| A. Delete 24 + older production-connected previews; separate Preview secrets and bindings | **BLOCKED** | `docs/ops/owner-gates.md` §A (ids in `docs/ops/preview-deletion-ids.txt`) |
| B. Cron Worker is a placeholder (never deployed); no cron has ever run | **BLOCKED** | §B. Deploying costs about +3–6K reads a day (measured) |
| C. Hourly read metrics for 5–8 Oct; the 6 Oct spike is an **open incident** | **BLOCKED** | §C export spec |
| Real-backup gates (baseQty dry run, shadow parity on real data) | **BLOCKED** | backup file |
| Supabase project, auth claim, Data API | **BLOCKED** | `docs/evidence/supabase-seed-pilot.md` gates 1–6 |
| **Deploy order hazard:** this branch's rules require `version` moves (G25) | **BLOCKED** | app first, then rules (`docs/evidence/phase-g-batch1.md`) |

### Research, not required for RC

| Item | Result |
|---|---|
| Goose (aardappel/goose) | **RESEARCH ONLY**: correct (0 disagreements) but no PZM bottleneck; the conversion overhead makes it slowest end to end; upstream 6 weeks old (`docs/research/goose-adoption-decision.md`) |
| Laya (G17) | Harness only; arms B–G NOT RUN |
| Mutation score (Stryker) | **NOT RUN** (tooling incompatible with Vitest 5). Manual mutation evidence: the Rust per-NaN vector, the issuer pin, the dialog test, the parity tamper test — each fails without its fix |

## P0 / P1 blockers

- **Code:** none open on this branch.
- **Operations:** the **6 Oct read incident is open** (gate C). It is a P0 for operations, not
  a code blocker: no change on this branch increases reads, the seed pilot is off, and the
  Worker is not deployed.
- Gates A and B are owner actions with known consequences (`docs/ops/owner-gates.md`).
