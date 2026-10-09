# RC RELEASE: GO / NO-GO (9 Oct 2026)

**Candidate:** `rc/ops-os-rc1-candidate`, Draft PR #1 → `main`.

**Verdict: NO-GO to merge today.** The code is ready; the release is not. Three things decide it:
1. **Restore drill:** BLOCKED.
2. **Firestore incident:** OPEN. Its source class is now "admin or service-account reads that
   bypass the rules", and that is a security question before it is a cost one.
3. **Final-SHA gates:** NOT RUN on the head that will be merged.

Passing tests are not authorisation to deploy.

Statuses: **PASS / FAIL / BLOCKED / NOT RUN**.

## 1. Identity

| Item | Value |
|---|---|
| Production now | `614fcc13` = `ad43971`. Rollback `0d00ae76` = `903c8db`. |
| Candidate head | The commit carrying this report. The last fully CI-green head is `430e1c9`. |
| Runtimes | Node 24.18, React 19, Vite 8, Tailwind 4, firebase-tools 15.24, wrangler 4.148, Rust stable (GNU on Windows), Java 21 for the emulator |

## 2. Gates

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | GitHub CI, 9 required checks | **PASS** on `430e1c9`; to re-run on the final head | Actions run 37814596198: typecheck, lint-i18n, unit, agent-safety, rust, rules, build-budget, e2e, secrets |
| 2 | Branch protection on `main` | **PASS** (verified by API 9 Oct) | PR required, the 9 checks strict, admins enforced, 0 approvals (single owner account), no force push or deletion, conversations resolved |
| 3 | Unit / rules / Rust / differential | **PASS** | `npm run verify`: 1,7xx unit, 249 rules; vectors and safety bench fresh |
| 4 | e2e ×3 consecutive, no retries, **on the final SHA** | **NOT RUN** (×3 PASS on `44554aa`; CI ×1 PASS on `430e1c9`) | `docs/release/rc-candidate-report.md` §5 |
| 5 | Preview isolation | **PASS** | Code guard (`preview_isolated`) + Cloudflare Access on `*.pzmstock.pages.dev` (9 Oct): every old and new preview 302 → login; production 200 |
| 6 | Production credentials not exposed in previews | **PASS** (owner separated preview keys 9 Oct; no preview answers without Access) | `docs/evidence/preview-cleanup.md` |
| 7 | Backups, all three brands, integrity PASS | **BLOCKED** (owner runs Settings › Backup) | — |
| 8 | Restore drill into an isolated project | **BLOCKED** (no isolated Firebase project) | — |
| 9 | Transition rules (G25), backward-compatible | **PASS** on the emulator; live deploy **NOT RUN** (checklist §B, before the merge) | `tests/rules-transition.test.ts` |
| 10 | Old-client detection | **PASS** (code): `x-pzm-build` on every stock command, logged without reads | `tests/trace-build.test.ts` |
| 11 | Rollback plan | **PASS** (documented); rehearsal **NOT RUN** | runbook §9, checklist §E |
| 12 | R&D units | **BLOCKED** (owner data). The code guard means R&D cannot hold stock without a unit, so it is **safe to release restricted**. | `tests/stock-commands.test.ts`; template now limited to KG / EA / Pack / Carton |
| 13 | Firestore incident (5–8 Oct) | **OPEN, narrowed** | `docs/evidence/firestore-read-investigation.md` §8 |
| 14 | Cron Worker | **NOT RUN** (stays OFF, by decision) | — |
| 15 | Supabase | **BLOCKED** (credentials); not part of this release | `docs/release/supabase-readiness.md` |

## 3. Firestore cost impact of this release

| Area | Effect |
|---|---|
| New reads added by the RC | **None at rest.** New features are off by default: seed pilot, Smart Other switch, outbox, Ask PZM (staging-only code). The build header costs no reads. |
| Read-budget fixes | Already on `main` (`2a8d578`): modelled 203K → about 24K per day for normal use |
| Measured 4–9 Oct | Ordinary hours 1.7–4K/h. 8 Oct 82K; 9 Oct so far very low. |
| The incident window | About 630K reads, **rule-bypassing**: not the app's users |
| Pricing | Above the 50K/day free quota, about US$0.03–0.06 per 100K reads (region dependent). The incident cost was in the order of **US$0.2–0.4**: small money, but a large signal. |

## 4. Security risks

| Risk | Severity | State |
|---|---|---|
| Unknown admin or service-account reader of production (incident §8) | **High until named** | Owner to check service-account key "last used" and, if enabled, Data Access audit logs. Rotate any key not accounted for. |
| Public demo preview now behind Access | Low | Owner decides whether the demo needs a Bypass |
| Single-account repository: no second reviewer | Medium | Protection enforces CI and PR; human review is self-review |
| Old previews | Closed | Access + guard |

## 5. Resource use

No new runtime on the release path. The bundle is within budget (CI `build-budget`).

## 6. Rollback

Runbook §9:
- the app via Pages rollback to `614fcc13`;
- rules via `rules.prod.bak`, after the app;
- data via the backup restore, drilled first in isolation.

## 7. What turns this into GO (owner)

1. Name or close the rule-bypassing reader (incident §8), and rotate keys if needed.
2. Take the three backups; provide an isolated project and run the restore drill.
3. Approve the final SHA. CI 9/9 and e2e ×3 run on it.
4. Approve the transition-rules deploy (checklist §B) and validate it **before** the merge.
5. Then the explicit merge approval.
