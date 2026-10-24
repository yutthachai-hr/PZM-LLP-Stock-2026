# R64 Agent 04 Review: Stock Integrity & Count Level Conflict (P0 C-02)

- **Date:** 2026-10-24
- **Reviewer Model:** `9router/gemini-3.8-flash-high` (Antigravity harness)
- **Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-e56f56c6`
- **Branch:** `t3/r64-stock-integrity-review`
- **Target Branch / PR:** `origin/fix/20261017-count-level-conflict` (PR #33)
- **Base Commit:** `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55` (`main`)
- **Head Commit:** `7c0505d93bd98aa3945be30d5ccc373b7e01bec7`
- **Gate Status:** `REVIEW_PENDING` (Mixed MAIN/Gemini implementation history; same-family verification cannot grant automatic independent approval under R64 policy)

---

## 1. Executive Summary & Intent

### 1.1 Intent
Enforce owner rule (R59 / P0 C-02): lock the stock-count baseline when a count is first entered or imported; never rebase a count silently when live balances change concurrently. A count files against the balance it was keyed against (`seen`), verified inside the Firestore transaction (`expectedLevel`). If concurrent activity occurs (e.g. concurrent counts, received POs, issues, damage adjustments), the server transaction refuses the adjustment with `StockLevelConflictError`, writes nothing, and returns the conflicting actual level. On the client, keyed counts remain on screen, and users must explicitly review and confirm via "ใช้ยอดใหม่" before saving.

### 1.2 Review Verdict
- **Code Quality & Correctness:** SATISFIED (Clean logic, transaction atomicity intact, idempotency verified).
- **Focused Unit & Concurrency QA:** PASSED (11 test suites, 136 tests passed).
- **R64 Governance Gate:** `REVIEW_PENDING` (Implementation and R62/R64 verification performed within Gemini family; requires different-family independent approval per AGENTS.md / R64 guidelines).

---

## 2. File & Line Evidence

### 2.1 `src/services/stock.ts`
- **Line 671–689:** `AdjustMode` (`count` | `delta`), `BaseAdjustLine`, `CountAdjustLine` (mandates `expectedLevel: number`), and `DeltaAdjustLine` type definitions.
- **Line 691–729:** `StockLineConflict`, `MissingExpectedLevelError`, and `StockLevelConflictError` classes providing localized multi-item conflict payloads.
- **Line 798–822 (`planAdjust`):**
  - Iterates planned lines and validates that any count mode (`mode === 'count'` or `reason === 'count'`) has a defined `expectedLevel` (throws `MissingExpectedLevelError` if undefined).
  - Compares `roundQty(cur) !== roundQty(x.expectedLevel)` inside the transaction read phase.
  - Collects all conflicting items into `conflicts` and throws `StockLevelConflictError(conflicts)` before any mutation occurs (`tx.set` / `file`).
- **Line 957–968 (`fileCount`):**
  - Backstop validation for single-item count filing (`postCountAsOf`): throws `StockLevelConflictError` if `params.expectedLevel !== undefined && roundQty(cur) !== roundQty(params.expectedLevel)`.

### 2.2 `src/pages/Adjust.tsx`
- **Line 76–77 (`AdjRow`):** Added optional `seen?: { system: number; level: number }` capturing comparison baseline when first entered.
- **Line 79–82 (`deltaOf`):** Computes difference against `r.seen?.system ?? system` instead of floating with live balance.
- **Line 84–86 (`displayedSystemQty`):** Displays locked `r.seen.system` in count mode; shows live figure only for delta mode or before initial count keying.
- **Line 88–94 (`isMoved`):** Flags row when `r.mode === 'count' && r.value !== null` and (`!r.seen` or `r.seen.system !== currentSystem` or `r.seen.level !== currentLevel`).
- **Line 96–117 (`mergeAdjustImportRow`):**
  - Preserves existing locked baseline on re-import if count is already keyed (`existing.mode === 'count' && existing.value !== null ? existing.seen : seenNow`).
  - Correctly captures fresh `seenNow` if the row was empty (`value === null`) or a new product.
  - Retains `undefined` seen for legacy drafts, requiring user confirmation.
- **Line 249–267 (`movedNotice`):** Renders warning notification with `Button` "ใช้ยอดใหม่" (`patch(r.productId, { seen: seenNow(r.productId) })`).
- **Line 323–325 (`submit`):** Blocking validation: `if (unconfirmed.length > 0) return toast.error(...)`.
- **Line 328–352 (`lines` mapping):** Maps count rows with `mode: 'count'` and `expectedLevel: r.seen!.level`.
- **Line 686–692 (Desktop keying `onChange`):** Locks `seen` when count value is first keyed; resets `seen: undefined` when input is emptied.
- **Line 703 (Delta input `onChange`):** Clears `seen: undefined` when switching row to delta mode.

### 2.3 `src/pages/counts/MonthlyCountSheet.tsx` & `src/services/monthlyCounts.ts`
- **`MonthlyCountSheet.tsx` Line 287:** Captures submit-time optimistic levels via `countExpectedLevels(productIds, lines, (pid) => qtyAt(locationId, pid))`.
- **`MonthlyCountSheet.tsx` Line 297:** Converts posting parts with `toPostingParts(postingPlan(now, sheet.postedIds), expectedLevels, byId)`.
- **`MonthlyCountSheet.tsx` Line 314–318:** Catch block for `StockLevelConflictError | MissingExpectedLevelError` sets `setAsking(null)`, shows error toast, and early-returns WITHOUT calling `setSheet(...)`, preventing erasure of uncommitted counted lines in the UI.
- **`monthlyCounts.ts` Line 171–179:** Per-chunk transaction reads `sheet.postedIds` and filters `todo = part.filter((a) => !done.has(a.productId))`, ensuring strict idempotency on chunk retries.
- **`monthlyCounts.ts` Line 180–201:** Invokes `planAdjust` with `mode: 'count'` and `expectedLevel: a.expectedLevel`.

### 2.4 `src/lib/monthlyCount.ts`
- **Line 136–148 (`countExpectedLevels`):** Pure utility mapping product IDs ∪ sheet lines to current stock level snapshots.
- **Line 158–178 (`toPostingParts`):** Validates and packages chunks into `PostableCountAdjustment[][]` with `expectedLevel`.

### 2.5 `src/i18n/AppError.ts` & `src/i18n/en.ts`
- **`AppError.ts` Line 30–40:** Added `MissingExpectedLevelError` class with Thai error templates.
- **`en.ts` Line 15–23:** Added English translations for `StockLevelConflictError` and `MissingExpectedLevelError`.

---

## 3. Focused Test Commands & Verification Results

All tests executed locally in the isolated worktree:

### 3.1 Focused Stock Count & Conflict Unit Tests
```bash
npx vitest run tests/adjust-count-import.test.ts tests/stock-count-conflict.test.ts tests/monthly-count.test.ts
```
**Result:** 3 test files passed, 34 tests passed, 0 failed (1.22s).
- Tests covered:
  - Two devices counting the same item (second save conflicts after first commits).
  - Single document multi-line adjust: line 2 conflict aborts line 1 atomically (0 partial writes).
  - Receipt filed between capture and save triggers conflict.
  - Issue/transfer out between capture and save triggers conflict.
  - Spoilage adjustment between capture and save triggers conflict.
  - Brand switch while waiting: pinned scope files/rejects in original brand, leaving other brand untouched.
  - Retry/replay: save with refreshed expectedLevel succeeds exactly once.
  - Duplicate Save clicks: first succeeds, second conflicts immediately, 1 movement recorded.
  - Backdated count: expectedLevel verifies current level while asOf calculates historical delta.
  - Mixed units: base-unit count checks base balance only, ignoring legacy `#unit` doc.
  - Legacy `#unit` entry refusal.
  - Delta-mode rows bypass optimistic concurrency checks.
  - Count line missing `expectedLevel` throws `MissingExpectedLevelError` with zero writes.
  - `postCountAsOf` checks `expectedLevel`.
  - `postMonthlyCount` multipart failure: failure at part $k$ preserves parts $< k$ and leaves part $k$ untouched.
  - `postMonthlyCount` retry idempotency: already committed items in `postedIds` are not re-filed on retry.
  - Untracked products on sheet detect level changes.
  - Adjust CSV re-import row baseline preservation across re-import and empty row imports.

### 3.2 Brand Scope & Epoch Tests
```bash
npx vitest run tests/monthly-count-brand-epoch.test.ts tests/submit-scope-pin.test.ts
```
**Result:** 2 test files passed, 18 tests passed, 0 failed (352ms).

### 3.3 Regression Stock & Import Tests
```bash
npx vitest run tests/adjust-history-integrity.test.ts tests/stock.test.ts tests/count-as-of.test.ts tests/adjust-lines.test.ts tests/count-import.test.ts tests/import-stock.test.ts
```
**Result:** 6 test files passed, 84 tests passed, 0 failed (576ms).

### 3.4 Typecheck, Lint & i18n Audits
```bash
npx tsc -b
npm run lint
npm run i18n:check
```
**Results:**
- `tsc -b`: 0 errors.
- `oxlint`: 0 errors.
- `i18n:check`: Passed ("every Thai UI string is translated").

---

## 4. Actual vs. Prior Concurrency QA Analysis

| Concurrency Scenario | Prior R62 Review State | Actual R64 Verification |
|---|---|---|
| **Two-device concurrent count** | Verified in unit & E2E (Device B warned `ยอดในระบบเปลี่ยนหลังนับ`). | Re-verified: `isMoved` catches delta, server transaction `planAdjust` enforces C-02 gate. |
| **CSV Re-import baseline overwrite** | Fixed in R62 (`mergeAdjustImportRow` preserves existing `seen`). | Re-verified in `tests/adjust-count-import.test.ts`: existing keyed counts retain baseline; empty rows capture fresh. |
| **Monthly count sheet conflict UI retention** | Rejected sheet reload proposal after real E2E blanked 16 counted rows. Kept early return. | Re-verified: `MonthlyCountSheet.tsx` catches `StockLevelConflictError`, displays toast, and keeps local state intact. |
| **Monthly count multipart retry** | Added idempotent retry test in R62. | Re-verified: `postMonthlyCount` filters `todo` against `sheet.postedIds` inside the transaction. |
| **Stale screen race (Firestore listener lag)** | Verified in `e2e/stock-count-conflict.spec.ts` with connection route abort. | Confirmed: Server transaction read checks `expectedLevel` against actual Firestore document. |
| **Brand switching during submit** | Addressed by pinning scope via `captureFilingScope()`. | Verified: Transaction executes in pinned brand backend without cross-brand contamination. |

---

## 5. Findings & Observations

1. **No New Functional Defects:**
   The implementation in `origin/fix/20261017-count-level-conflict` (commit `7c0505d`) satisfies all owner requirements for stock count baseline locking (R59) and transactional optimistic concurrency (C-02).
2. **Intentional Omission of Delta Conflict Checking:**
   Delta adjustments (e.g. spoilage, breakages, stock corrections entered as $+/-$) do not require or enforce `expectedLevel`. This is by design: delta adjustments represent relative quantity changes, not state assertions against a physical balance.
3. **Legacy Draft Safety:**
   Drafts loaded from local storage created prior to PR #33 have `seen === undefined`. `isMoved()` treats undefined `seen` as moved, forcing the user to review the current balance and click "ใช้ยอดใหม่" before saving.

---

## 6. Readiness & Non-Destructive Rollback Plan

### 6.1 Readiness
- Pure unit tests: 136/136 PASS.
- Static typing: PASS.
- i18n: Complete (EN + TH keys aligned).
- Source branch is clean and fast-forwards directly to `origin/fix/20261017-count-level-conflict`.

### 6.2 Non-Destructive Rollback
The changes do not alter Firestore document schemas or security rules:
- Stock levels remain `{ qty: number, updatedAt: number }`.
- Movements remain `{ id, docNo, type, productId, qty, ... }`.
- Monthly counts use existing `postedIds` array field.
- If rollback is needed, revert the commit without database migration:
  ```bash
  git revert -m 1 7c0505d93bd98aa3945be30d5ccc373b7e01bec7
  # or reset branch to base:
  git reset --hard 312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55
  ```
- No data loss or schema cleanup is required.

---

## 7. R64 Multi-Model Governance Gate

- **Implementation Origin:** Icezardss (Gemini subagent).
- **R62 Review:** Gemini subagent.
- **R64 Verification:** `9router/gemini-3.8-flash-high` (same model family).
- **Gate Declaration:** Under R64 workflow policy, verification by the same model family does not constitute independent different-family signoff. Status remains **`REVIEW_PENDING`** until an independent non-Gemini reviewer (e.g. Claude) or human owner verifies.
