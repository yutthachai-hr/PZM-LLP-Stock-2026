# Mission Report: PR19 Standalone Slice Extraction

- **Status**: REVIEW_PENDING
- **Task**: R66 WAVE6 — Extract one standalone slice from PR19 onto current main
- **Branch**: `extract/20261024-pr19-i18n-audit`
- **Base**: `origin/main` (`312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`)
- **Source**: PR19 (`origin/fix/20261014-line-en-th`, HEAD `aee096864282d44e1e72b6d13f627b1cff6a2e28`)
- **Code Commit SHA**: `d0d4ab2a7180dbc375aa22c76f64479b948720e8`

---

## 1. Inventory of PR19 vs Current Main

PR19 contained 16 modified/created files across four areas:
1. **i18n Audit & AST Parser**: `scripts/i18n-audit.mjs`, `tests/i18n-audit.test.ts`, `scripts/i18n-check.mjs`.
2. **Contextual Activity Wording**: `src/components/nav/SideLive.tsx`, `src/components/dashboard/DeskCards.tsx`, `src/components/dashboard/DailySuggestions.tsx`, `src/lib/activityLog.ts`, `src/i18n/en.ts`, `tests/sidebar-activity-i18n.test.ts`, `tests/activity-log.test.ts`, `tests/daily-digest.test.ts`.
3. **Bilingual LINE Artwork**: `public/brand/line/share-en.png`, `public/brand/line/share-en-grey.png`, `public/brand/line/README.md`, `tests/line-button-i18n.test.ts`.
4. **E2E Localization Tests**: `e2e/localization.spec.ts`.

### What Main Already Had
- Basic regex-based checking in `scripts/i18n-check.mjs` that parsed single-line `\bt\(\s*'...'` occurrences, but lacked TypeScript AST parsing, static template literal support, placeholder parity verification, and Thai-leakage validation for English copy.
- A passing Vitest suite of 141 test files (1,714 tests).
- Clean type-checking (`tsc -b`) and build output.

---

## 2. Selected Standalone Slice: i18n Audit

The i18n audit tooling (`scripts/i18n-audit.mjs` + `tests/i18n-audit.test.ts` + integration into `scripts/i18n-check.mjs`) was selected because:
- It was completely missing on `main` (confirmed via `glob`/`ls`).
- It has zero runtime UI footprint and touches none of the files modified by open PRs #52/#53 (`src/pages/purchase/SendWizard.tsx`, `src/pages/Orders.tsx`, `src/share/*`, `src/pages/purchase/*`, `vite.config.ts`, `.github/workflows/ci.yml`).
- It uses the repo's existing `typescript` dependency to parse AST nodes without adding new dependencies or modifying schema/rules.

### Files Extracted & Diff Stat

```
 scripts/i18n-audit.mjs   | 43 +++++++++++++++++++++++++++++++++++++++++++
 scripts/i18n-check.mjs   | 28 +++++++++++++++++++++++-----
 tests/i18n-audit.test.ts | 19 +++++++++++++++++++
 3 files changed, 85 insertions(+), 5 deletions(-)
```

- **`scripts/i18n-audit.mjs`**: Provides `dictionaryProblems(dictionary, thaiDataValues)` and `translationCalls(source, fileName)`. Catches missing/empty translations, placeholder mismatches (e.g. `{name}` vs `{other}`), unexempted Thai text in English translations (with ฿ symbol exemption), escaped quotes, static template literals, and flags dynamic Thai template literals in `t(...)` / `AppError(...)`.
- **`tests/i18n-audit.test.ts`**: Ported test suite verifying `dictionaryProblems` and `translationCalls` behaviors.
- **`scripts/i18n-check.mjs`**: Integrates `dictionaryProblems` and `translationCalls` into the existing `npm run i18n:check` runner with `THAI_DATA_VALUES` exceptions.

---

## 3. What Remains in PR19 and Why (Coupling)

1. **Bilingual LINE Artwork (`public/brand/line/*.png`, `tests/line-button-i18n.test.ts`)**:
   Coupled to open PR #52 (`SendWizard.tsx`, `Orders.tsx`), which refactors the LINE sending workflow. Left out per task instructions.
2. **Contextual Activity Wording (`SideLive.tsx`, `DeskCards.tsx`, `DailySuggestions.tsx`, etc.)**:
   `DailySuggestions.tsx` directly integrates the LINE share button artwork (`/brand/line/share-${lang}.png`). Moving it independently would pull in artwork dependencies or cause partial behavior.
3. **E2E Localization (`e2e/localization.spec.ts`)**:
   Tests the entire integrated UI in a browser with Thai/English toggle across multiple screens; depends on all UI localization slices being active.

---

## 4. TDD Evidence

### RED
Created `tests/i18n-audit.test.ts` before creating `scripts/i18n-audit.mjs`.
```bash
$ npx vitest run tests/i18n-audit.test.ts
 FAIL  tests/i18n-audit.test.ts [ tests/i18n-audit.test.ts ]
Error: Cannot find module '../scripts/i18n-audit.mjs' imported from tests/i18n-audit.test.ts
Test Files  1 failed (1)
Tests  no tests
```

### GREEN
Created `scripts/i18n-audit.mjs` and updated `scripts/i18n-check.mjs`.
```bash
$ npx vitest run tests/i18n-audit.test.ts
Test Files  1 passed (1)
Tests  3 passed (3)
Duration  485ms
```

Full test suite verification:
```bash
$ npm test
Test Files  142 passed (142)
Tests  1717 passed (1717)
```
(+1 test file, +3 tests over main baseline).

---

## 5. Verification Commands & Results

| Command | Result | Details |
|---|---|---|
| `npx vitest run tests/i18n-audit.test.ts` | PASS | 1 file, 3 tests passed |
| `npx tsc -b` | PASS | Clean exit 0, no diagnostic output |
| `npx oxlint` | PASS | Exit 0 (50 pre-existing warnings in repo, 0 in new/edited files) |
| `npm run i18n:check` | PASS | Exit 0, 2,946 keys verified, 0 audit problems |
| `npm run build` | PASS | Exit 0, 1,446 modules transformed, dist output generated |

---

## 6. Local Commit Reference

- **Branch**: `extract/20261024-pr19-i18n-audit`
- **Code Commit**: `d0d4ab2a7180dbc375aa22c76f64479b948720e8` (`feat(i18n): extract AST parsing and dictionary audit from PR19`)
- **Status**: REVIEW_PENDING
