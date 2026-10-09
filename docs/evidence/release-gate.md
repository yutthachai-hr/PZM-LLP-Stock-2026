# Release gate — results at `69ed912` (7 Oct 2026)

**Status: gate green, RC NOT frozen.** On 7 Oct the owner extended Phase G with G11–G16
(Agent Safety Foundation). The Release Candidate freeze now follows G16, because after a
freeze only bug fixes may go in. Nothing has been merged or deployed.

## Static checks, unit tests and rules

| Gate | Result |
|---|---|
| Typecheck | clean: app, `functions/` and `e2e/` |
| Lint (oxlint) | 0 errors |
| i18n | every Thai UI string translated |
| Unit (`npm test`) | **1,342 passed**, 117 files |
| Rules (`npm run test:rules`, emulator) | **232 passed**, 10 files |
| Build | OK |
| Bundle budget | within budget: main 221 KB, initial JS 1,710 KB in 49 files |
| auditLog tests | `tests/audit-log.test.ts` (10), `tests/audit-log-rules.test.ts` (4), `e2e/audit.spec.ts` (1) |
| Permission tests | `tests/firestore-rules.test.ts`, `e2e/hostile-client.spec.ts` (staff cannot make themselves admin, write balances, rewrite movements, place orders unapproved, change approved lines, void without reason, or use an adjustment reason outside the list) |
| Read benchmark | `docs/evidence/read-budget.md`: ≈ 23.8k/day modelled (app 17.9k + Worker 5.9k), down from ≈ 201k |
| baseQty dry-run | tool ready (`npm run backfill:po-baseqty -- <backup.json>`). It classifies every line as valid, safe, ambiguous, invalid or closed, and gives the would-change count. **Not run on the real backup**: it is on the owner's machine. |

## Concurrency and idempotency

**Unit and rules tests**

| What is checked | File |
|---|---|
| Replayed operation → same receipt, nothing written twice | `tests/functions/stock-commands.test.ts` |
| Delivery filed between read and commit → retried against the order as it now is | `tests/functions/stock-commands.test.ts` |
| Two transfer approvals at once deduct once | transfer tests |
| A resolution or misroute cannot be decided twice | transfer tests |
| Count posted twice posts once | `tests/monthly-count-post.test.ts` |
| Stock filed while counting → books re-read | `tests/monthly-count-post.test.ts` |
| Same file imported twice records nothing new | `tests/import-stock.test.ts` |
| Two people publishing at once get different numbers | `tests/announcements.test.ts` |

**e2e**

| What is checked | File |
|---|---|
| Two devices confirm one delivery → stock goes in once | `receive-po.spec.ts` |
| Lost answer → confirming again files nothing twice | `receive-po.spec.ts` |
| Doubled receipt flagged by the auditor | `receive-po.spec.ts` |
| Double click on convert → one set of orders | `convert-request.spec.ts` |
| Two tabs converting at once → one set of orders | `convert-request.spec.ts` |
| Lost answer on convert → nothing more created | `convert-request.spec.ts` |
| Cancel and receive at the same moment | `order-changes.spec.ts` |

## Flakiness runs — `playwright.flaky.config.ts`

**How the runs were made**
- Retries are pinned to 0.
- Every failure keeps its trace (console, network and DOM), screenshot and video.
- Every attempt is timed in `e2e-results/flaky/<label>.json`.

### Before the fixes

| Run | Pass | Fail | min s | median s | p95 s |
|---|---:|---:|---:|---:|---:|
| live-error ×20 | 17 | **3** | 5.4 | 6.7 | 25.9 |
| full-cycle ×10 | 10 | 0 | 28.7 | 32.3 | 38.8 |
| full e2e ×3 | 31 of 31 established tests, every run | — | — | — | — |

The new business-flow spec failed in all three full runs while it was still being written.

### Real bugs found and fixed (not retried away)

1. **Retry left the "data may be incomplete" banner up** (live-error 3/20). Fixed in `8678288`.
   - **Evidence:** the trace shows retry pressed at t = 83.1 s, while the products and
     stockLevels refusals arrived at 83.8 s and 84.2 s. Those subscriptions had started while
     the account was still revoked.
   - **Fix:** a retry now also covers listeners still in flight when it was pressed. Each
     late refusal is retried once (`DataContext`, `LiveFailure.startedAt`).
2. **A new purchase request showed empty after its first line.** Fixed in `37c37e9`.
   - **Cause:** the C1 error boundary was keyed on the path. When the URL changed from
     `/requests/new` to `/requests/<id>`, the page remounted and re-read the request before
     the line was saved, so "send for review" stayed disabled.
   - **Fix:** the boundary now clears an error on navigation instead of remounting the page.

**Not a bug, but worth recording:** the rules budget tests take a steady 4.4–5.0 s against
vitest's 5 s default. `vitest.rules.config.ts` now sets an explicit 30 s time limit, with the
measurement in a comment. This is a time limit, not a retry.

### After the fixes (`37c37e9`)

| Run | Pass | Fail | min s | median s | p95 s |
|---|---:|---:|---:|---:|---:|
| live-error ×20 | **20** | 0 | 5.3 | 6.7 | 13.3 |
| business-flow ×5 | **5** | 0 | 74.1 | 75.2 | 81.1 |
| full-cycle ×10 | **10** | 0 | 28.5 | 30.2 | 38.0 |
| full e2e ×3 | **32 / 32**, every run (10.3, 10.6, 10.7 min) | 0 | — | — | — |

## Pre-production business flow — `e2e/business-flow.spec.ts`

Runs through the screens under the real rules and the real stock-command server.

| Step | Time |
|---|---:|
| Staff purchase request (intake recorded as manual) | 10.4 s |
| Manager approves, order created | 6.4 s |
| Supplier date change → warning popup and warning sound (`__pzmNotificationLog`) | 2.1 s |
| Partial receipt 12 of 20, with 3 rejected as damaged (they stay owed, never enter stock) | 10.0 s |
| Network drops while confirming the rest; confirming again files it exactly once (2 receipts, stock 30) | 12.9 s |
| Transfer of 5 to a branch; a stale second tab cannot approve it again (warehouse 25, in transit 5) | 21.0 s |
| Branch receives on a double click: filed once (branch 5, in transit 0) | 6.8 s |
| Count 9 against 10 on the books (10% variance) → manager approves → posted (warehouse 24) | 6.3 s |
| Integrity auditor over everything written | **0 findings** |

**Limitation:** the supplier's own link is a Pages Function that the e2e server does not
serve. Its effect, the notification, is written with the server's own builder
(`supplierAnswerDraft` + `toDoc`). The endpoint itself is unit-tested in
`tests/functions/supplier-po.test.ts`.

## Known limitations at this point

- **Real-backup steps are owner-side:** the baseQty dry-run and the Phase G backtest.
- **Rules / Functions / Worker deploys belong to the owner**, in the agreed order (0–10).
- **Lighthouse** has not been measured in this environment.
- **The 14-day integrity gate** can only start after deploy.
