# PR #17 current-head revalidation

Head `d37e414466c2301854d808ea051cf5714b25780b`. Base `af0136b0f6886989bc32d651a384ac05b39cdad6` is an ancestor, verified by `git merge-base --is-ancestor`. No reset, rebase, force push or product edit was made.

The d37e414 filing-scope fix follows f3f833e's main merge. The old preflight snapshot of f3f833e is not approval of the newer code. A fresh independent review is running on d37e414.

## Files changed against current main

- `src/data/recentWrites.ts`
- `src/services/stock.ts`
- `src/services/transfers.ts`
- `src/services/monthlyCounts.ts`
- `tests/recent-writes.test.ts`
- `tests/monthly-count-brand-epoch.test.ts`
- `e2e/suppliers-master-detail.spec.ts`

## Parent-run verification on d37e414

| Check | Result |
|---|---|
| `npm ci` | Exit 0 |
| `npm test -- --maxWorkers=2` | Exit 0; 1345 tests in 110 files |
| `npm run build` | Exit 0; includes all configured TypeScript projects |
| `npm run lint` | Exit 0; existing warnings retained |
| `npm run i18n:check` | Exit 0 |
| `npm run test:rules` | Exit 0; 228 tests, local emulator |
| `npm run test:e2e` | Exit 0; 68 passed, 2 pre-existing real-data fixture benchmark skips |
| GitHub CI on d37e414 | All nine required checks successful; Cloudflare Pages successful |

No new test was skipped or retried. The two existing skipped benchmarks are `brand-switch-reads.spec.ts`'s real-data brand-switch read measurement and `read-budget.spec.ts`'s real-data workflow read measurement. They are not claimed as verified. Fixtures, emulator writes and hostile-client denials are synthetic and local, not production operations. Console permission-denied output in those tests is recorded in the raw log.

Raw command output lives in `C:/Users/Yutthachai/pzm-mission-runtime-20261014/pr17-d37-*.log`; normalized copies are under `docs/mission/evidence/pr17-d37/`. GitHub receipt is `pr17-current.json` in the runtime folder. The working tree remains clean at d37e414.

## Readiness

Independent OpenCode review has no verdict yet. The exact task ID is in `active-tasks.json`. Preview QA and rollback readiness must also be established before any merge. CI green alone is insufficient. No PR17 merge, rules deployment, production write or production smoke is claimed.
