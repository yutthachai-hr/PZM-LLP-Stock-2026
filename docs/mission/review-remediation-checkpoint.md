# Review remediation checkpoint, 15 Oct 2026

## PR19, localization

Exact `aee096864282d44e1e72b6d13f627b1cff6a2e28`, independent OpenCode High task `pzm-pr19-aee0968-review-r1`: APPROVE, no findings. Reviewer checked LINE artwork, language-specific selection, contextual activity verbs, stable navigation keys and immutable stored data. Live LINE app/clipboard handoff and authorized deployed Preview were not exercised. CI rechecked 10/10 SUCCESS. No merge.

## PR21, toast retry

R1 on `d42bee1` reported Important: duplicate errors were suppressed without renewing the reading interval. Its final APPROVE conflicted with that finding. Parent treated it as NOT READY and reproduced the defect before fixing it.

Changed `src/lib/toastQueue.ts`, `src/components/ToastCard.tsx`, `tests/toast-queue.test.ts` and `e2e/toast-ux.demo.ts`. Duplicate errors increment a revision while preserving id and queue position. Card resets its full reading interval, cancels a pending exit and retains keyboard focus. Other duplicate variants remain suppressed.

Actual TDD evidence in `C:/Users/Yutthachai/pzm-recovery-20261015/r2/toast-repeat-*`:
- Original code: new unit test FAILED, two new browser tests FAILED (expected one card, got zero).
- Fixed code: unit suite 1336 PASS, browser15 PASS, emulator E2E68 PASS +2 existing skips, lint/i18n/build PASS.
- Bundle gate: FAIL. Exact initial bytes 3,532,880 against 3,532,800 (80 bytes over). Limits unchanged. PR16 must land first, then the integrated head needs fresh gates.

Final `07e8ab4c20a0321d4d4fc759ba90317260606d34`, new independent R2 `pzm-pr21-07e8ab4-review-r2`: CODE GO, RELEASE NO-GO. Minor observations deferred: identical errors are not re-announced by screen readers; existing Fast Refresh hook-export warning. R2 inspected code/parent logs, did not rerun emulator/browser tests.

Parent loaded receiving-code-review SKILL.md, verified R1 against actual code, wrote behavioral failing tests first, fixed minimally, ran full verification and requested fresh review with the original brief, R1 findings, responses and unresolved blockers. Systematic-debugging, test-driven-development, verification-before-completion and requesting-code-review files had also been loaded this session. No unrelated business/Rules/data changes.

## PR23, historical-search error feedback

R1 `pzm-pr23-e275251-review-r1`: code APPROVE with two minor silent-catch findings in Movements/Orders deep links. Parent elected to fix before release. Implementation task `pzm-pr23-deeplink-error-fix-r1` produced local `3300edf2a19b98a4554d9698797344cc0b686bcf`; parent inspected, independently verified and pushed it.

Actual parent verification: targeted lookup/deep-link30 PASS; full unit1356 PASS; browser10 PASS; emulator68 PASS +2 existing skips; lint/i18n/build PASS; budget initial3448/3450KB PASS. Logs `r2/search-deeplink-*`. Latest CI at 09:00Z: nine SUCCESS, E2E in progress.

Fresh R2 `pzm-pr23-3300edf-review-r2`: CODE GO. Helpers wired into components; stale results/errors gated by alive and current brand; no new loop found. Minor tautological `(brand && brand !== requestBrand)` is harmless and deferred to avoid another unrelated source change. Deployed Preview remains blocked; no merge.

Evidence correction: implementation child claimed 14 RED ->14 GREEN as regression TDD. Both parent and R2 found that old baseline lacked the newly imported helper exports, so the RED was missing-export/module-load failure, not behavioral reproduction of the old component bug. The 14 tests are useful new helper unit coverage. Do NOT cite that RED as proof of a UI regression test. Preserve the original child report with this correction, not a silently rewritten history.

## PR24, smart import

R1 `pzm-pr24-a01b56f-review-r1`: CHANGES_REQUESTED. Numeric prohibitions such as `ยังไม่ต้องส่งผู้ขาย วันที่ 15` bypassed the constraint list and became pending candidate rows. Mandatory review still prevents automatic approval/sending; reviewer wording about automatic billable lines was overstated, but preserving prohibitions is a release blocker.

Other observations: source text incorrectly says invalid quantity 'in file' for typed input; no predecode image source-size cap. Implementation task `pzm-pr24-review-remediation-r1` owns the existing branch and related parser/file-validation/UI-copy tests. No push permitted until parent verification. Successful live image/PDF OCR remains an explicit test gap.

## Remaining work

- PR22 old reviewer: T3 cancelled during restart, OpenCode later resumed but no verdict/last activity07:28. Read-only runtime task `pzm-pr22-orphan-reconcile-r1` is determining whether a replacement review can safely run. It is NOT another product review.
- PR25/17/16/20/19 have exact-head code approvals but Preview/release gates remain. No Cloudflare Access bypass.
- Main-agent automatic failover remains a separately reviewed, unactivated candidate. No restart or guard/config/credential change performed.
