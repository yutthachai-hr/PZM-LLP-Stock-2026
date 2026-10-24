# PR33 Independent Review Report (R66 Wave 3)

## 1. Overview & Exact Head
- **Target SHA Reviewed**: `7c0505d93bd98aa3945be30d5ccc373b7e01bec7`
- **Base Commit**: `312f8a7` (`origin/main`)
- **Branch**: `fix/20261017-count-level-conflict`
- **Verification**: `git rev-parse HEAD` -> `7c0505d93bd98aa3945be30d5ccc373b7e01bec7`
- **Diff Evaluated**: `git diff 312f8a7...7c0505d` (13 files changed, 1341 insertions(+), 40 deletions(-))

## 2. Authorship & Independence Statement
- **Author Lineage**:
  - The core implementation and test fixes in this PR branch were authored by MAIN sessions (Codex/Claude), evaluated with an earlier Gemini review (R62), and verified by a Gemini session (R64).
- **Reviewer Independence**:
  - Fresh reviewer agent operating in an isolated worktree (`t3-a002b7df`).
  - No participation in authoring any commits on this branch; not the R64 Agent04 session.
  - Cross-model relative to MAIN-written code (Codex/Claude); same-family relative to the earlier Gemini reviews (R62/R64).
  - Review-only engagement: no modifications to `src/` or `tests/`.

## 3. Files Read & Inspected
- `src/pages/Adjust.tsx`
- `src/services/stock.ts`
- `src/lib/monthlyCount.ts`
- `src/pages/counts/MonthlyCountSheet.tsx`
- `src/services/monthlyCounts.ts`
- `src/i18n/AppError.ts`
- `src/i18n/en.ts`
- `src/lib/levelKey.ts`
- `src/lib/validate.ts`
- `tests/adjust-count-import.test.ts`
- `tests/stock-count-conflict.test.ts`
- `tests/monthly-count.test.ts`
- `tests/monthly-count-brand-epoch.test.ts`
- `tests/adjust-history-integrity.test.ts`
- `tests/stock.test.ts`
- `tests/count-import.test.ts`
- `tests/submit-scope-pin.test.ts`
- `e2e/stock-count-conflict.spec.ts`

## 4. Owner Rule Verification & Attack Cases

**Owner rule being enforced**:
A stock count's 'expected' balance (baseline, field `seen` / `expectedLevel`) is LOCKED at first entry of the count line. If the real balance changes before submit (another device, a receive, a transfer), the server transaction must REFUSE (`StockLevelConflictError`) instead of silently rebasing, and the UI must make the person confirm the new baseline. Never silently rebase. Never lose keyed quantities.

### 4.1 Lock-at-Entry (`Adjust.tsx`)
- **Keying behavior**: In `src/pages/Adjust.tsx:686-691`, the counted input `onChange` handler computes:
  ```typescript
  const value = e.target.value === '' ? null : Number(e.target.value)
  const seen = value === null ? undefined : r.mode === 'count' && r.seen ? r.seen : seenNow(r.productId)
  patch(r.productId, { mode: 'count', value, entryUnit: undefined, entryQty: undefined, seen })
  ```
- **Evidence & Verification**:
  1. *First keystroke*: When `r.seen` is undefined and a number is typed, `seenNow(r.productId)` is captured once (`system` and `level`).
  2. *Subsequent keystrokes*: When `r.mode === 'count' && r.seen` is already truthy, `seen` remains `r.seen`. Background level drift from Firestore real-time listeners updates `qtyAt(locationId, productId)`, but does NOT mutate `r.seen`.
  3. *Clearing input*: When `e.target.value === ''`, `value` becomes `null` and `seen` becomes `undefined`. When re-keyed, a fresh baseline is locked from current state.
  4. *Delta computation*: `deltaOf` (`src/pages/Adjust.tsx:78-81`) uses `r.seen.system`, keeping the delta stable against background changes until confirmed.
  5. *Legacy draft protection*: If an existing draft without `seen` (from pre-PR33 storage) is restored, `isMoved` (`src/pages/Adjust.tsx:87-93`) evaluates `!r.seen` as `true`. In `submit()` (`src/pages/Adjust.tsx:322-324`), `rows.filter(moved)` is non-empty, immediately blocking submission with a toast notification until the user clicks "ใช้ยอดใหม่".

### 4.2 Imported Baseline (`mergeAdjustImportRow`)
- **Merge logic**: In `src/pages/Adjust.tsx:95-115`:
  ```typescript
  if (existing) {
    const seen = existing.mode === 'count' && existing.value !== null ? existing.seen : seenNow
    return { ...existing, mode: 'count', value: imported.qty, entryUnit: undefined, entryQty: undefined, seen }
  }
  ```
- **Evidence & Verification**:
  1. *Re-import over keyed row*: If `existing.mode === 'count' && existing.value !== null`, `existing.seen` is retained. Re-importing a CSV does not overwrite the locked baseline with `seenNow`. If the row had drifted, `isMoved` remains `true` and the warning persists (`tests/adjust-count-import.test.ts:19-44`).
  2. *Re-import over legacy unconfirmed row*: If `existing.seen` was `undefined`, it remains `undefined` upon re-import; confirmation is still required (`tests/adjust-count-import.test.ts:46-67`).
  3. *Import into empty table row*: If `existing.value === null` (row added but not yet keyed), `existing.value !== null` is false, so it captures `seenNow` cleanly (`tests/adjust-count-import.test.ts:92-97`).
  4. *Importing new product*: Creates row with `seenNow` (`tests/adjust-count-import.test.ts:99-107`).
  5. *Switching delta row to count*: Captures `seenNow` as the starting baseline (`tests/adjust-count-import.test.ts:69-90`).

### 4.3 Concurrency & Transactional Refusal (`src/services/stock.ts`)
- **Atomic Concurrency Check**: In `src/services/stock.ts:798-822`:
  ```typescript
  const conflicts: StockLineConflict[] = []
  for (let i = 0; i < lines.length; i++) {
    const x = lines[i]
    const isCount = x.mode === 'count' || (!x.mode && x.reason === 'count')
    if (isCount && x.expectedLevel === undefined) {
      throw new MissingExpectedLevelError(x.line.productId, x.line.productName)
    }
    if (x.expectedLevel !== undefined) {
      const cur = levels[i]?.qty ?? 0
      if (roundQty(cur) !== roundQty(x.expectedLevel)) {
        conflicts.push({ productId: x.line.productId, ... expected: x.expectedLevel, actual: cur })
      }
    }
  }
  if (conflicts.length > 0) {
    throw new StockLevelConflictError(conflicts)
  }
  ```
- **Evidence & Verification**:
  1. *Two devices counting same item*: When Device A commits an adjustment, the balance updates. When Device B attempts to submit with the stale expected level, `roundQty(cur) !== roundQty(expectedLevel)` triggers, throwing `StockLevelConflictError` before any writes (`tests/stock-count-conflict.test.ts:57-116`).
  2. *Multi-line all-or-nothing atomicity*: If line 1 matches expected level but line 2 conflicts, the check throws before `tx.set` or movement logging. Line 1 is never written (`tests/stock-count-conflict.test.ts:118-143`).
  3. *External movements between capture and save*: Tested against interleaved `receiveStock`, `transferStock`, and `adjustStock`. In all cases, transaction detects conflict and writes nothing (`tests/stock-count-conflict.test.ts:145-230`).
  4. *Delta-mode bypass*: For explicit relative adjustments (`x.mode === 'delta'`), `isCount` is false and `expectedLevel` is omitted, bypassing conflict checks without throwing `MissingExpectedLevelError` (`tests/stock-count-conflict.test.ts:388-401`).
  5. *Scoped isolation*: Scoped via `captureFilingScope()` and `levelRef(locationId, line)`. Brand isolation pins the transaction database and epoch even if global brand switches during execution (`tests/stock-count-conflict.test.ts:232-277`). Location, product, and unit tokens are segregated in Firestore document IDs.

### 4.4 Conflict Confirmation Flow (`Adjust.tsx`)
- **UI Confirmation Gate**: In `src/pages/Adjust.tsx:249-267` and `322-324`:
  - When `moved(r)` is true, `movedNotice` renders a warning banner with the "ใช้ยอดใหม่" (`Use new figure`) button.
  - Clicking "ใช้ยอดใหม่" executes `patch(r.productId, { seen: seenNow(r.productId) })`.
  - While any row has `moved(r) === true`, `submit()` blocks with:
    `toast.error(t('ยอดในระบบเปลี่ยนหลังจากนับ {count} รายการ ({names}) — ตรวจแล้วกด "ใช้ยอดใหม่" ก่อนบันทึก'))`.
  - The submit action cannot proceed until every changed baseline is explicitly acknowledged by the operator. Keyed quantities (`r.value`) are preserved throughout.

### 4.5 Monthly Count (`MonthlyCountSheet.tsx` & `monthlyCounts.ts`)
- **Preserving keyed counts on conflict**:
  - In `src/pages/counts/MonthlyCountSheet.tsx:314-318`:
    ```typescript
    if (e instanceof StockLevelConflictError || e instanceof MissingExpectedLevelError) {
      setAsking(null)
      toast.error(errText(e, t))
      return
    }
    ```
    On conflict, the dialog closes and the error toast is presented. Crucially, `setSheet(await getMonthlyCount(id))` is skipped, leaving the operator's entered counts in `lines` intact on screen. (An earlier regression that refreshed the sheet and blanked counts was eliminated in commit `7c0505d`).
- **Multipart posting idempotency via `postedIds`**:
  - In `src/services/monthlyCounts.ts:171-207`, adjustments are split into parts (`postingPlan`). Each part checks `done = new Set(sheet.postedIds ?? [])` and filters `todo = part.filter((a) => !done.has(a.productId))`.
  - If part $k$ fails or conflicts, prior committed parts $< k$ remain safely posted in Firestore with their IDs recorded in `sheet.postedIds`.
  - Retrying after updating the conflicting row skips all previously posted items (`todo.length === 0`), completely preventing duplicate adjustments or double ledger movements (`tests/stock-count-conflict.test.ts:496-617`).
- **Untracked count row baseline capture**:
  - `countExpectedLevels` (`src/lib/monthlyCount.ts:137-148`) captures baselines over `productIds ∪ Object.keys(lines)`. Any untracked line added during stocktake receives an expected level (0 if unstocked), preventing `MissingExpectedLevelError` while detecting any intervening receipts (`tests/stock-count-conflict.test.ts:619-655`).

## 5. Attack Cases & Boundary Invariants Tested

1. **Rapid decimal keying & backspacing in Adjust table**:
   - Typing intermediate inputs (e.g., `1`, `1.`, `1.5`): Baseline is locked on `1`, preserved across `1.` and `1.5`.
   - Clearing to empty string: Sets `value = null`, `seen = undefined`. Re-keying locks a new baseline as of that moment.
2. **Float Precision & Rounding**:
   - Quantities are normalized via `roundQty` (3 decimals, `Math.round(n * 1000) / 1000`) across `Adjust.tsx`, `stock.ts`, and `monthlyCount.ts`. Floating point drift (such as `0.1 + 0.2`) cannot trigger false positive conflicts.
3. **Double-Click Submission Race**:
   - Both `AdjustPage` (`submit`) and `MonthlyCountSheet` (`confirm`) gate execution with `if (busy) return` and synchronous `setBusy(true)`.
   - If two concurrent API requests bypass UI gating, the first transaction commits and advances the stock level; the second transaction reads the updated level and aborts with `StockLevelConflictError` (`tests/stock-count-conflict.test.ts:315-340`).
4. **Backdated Count Interleaving**:
   - `AdjustPage` checks both historical date balance (`asOf`) and current level (`level`). Interleaved movements occurring today or prior to the backdated date are caught before commit (`Adjust.tsx:347-367` and `stock.ts:806-819`).

## 6. Test Commands & Verification Counts

### 6.1 Targeted Test Suites
- Command:
  ```bash
  npx vitest run tests/adjust-count-import.test.ts tests/stock-count-conflict.test.ts tests/monthly-count.test.ts tests/monthly-count-brand-epoch.test.ts tests/adjust-history-integrity.test.ts tests/stock.test.ts tests/count-import.test.ts
  ```
- Result: **7 test files passed, 95 tests passed, 0 failed** (Duration: 1.39s).
  - `tests/adjust-history-integrity.test.ts`: 4 passed
  - `tests/monthly-count.test.ts`: 11 passed
  - `tests/count-import.test.ts`: 15 passed
  - `tests/monthly-count-brand-epoch.test.ts`: 15 passed
  - `tests/stock-count-conflict.test.ts`: 18 passed
  - `tests/stock.test.ts`: 26 passed
  - `tests/adjust-count-import.test.ts`: 6 passed

### 6.2 Full Repository Test Suite
- Command:
  ```bash
  npx vitest run tests/
  ```
- Result: **143 test files passed, 1739 tests passed, 0 failed**.

### 6.3 TypeScript Typecheck
- Command:
  ```bash
  npx tsc -b
  ```
- Result: **0 errors** (clean build).

### 6.4 Localization Verification
- Command:
  ```bash
  node scripts/i18n-check.mjs
  ```
- Result: **Every Thai UI string is translated**.

## 7. Findings
- **Must Fix**: None.
- **Should Fix**: None.

## 8. Rollback Guidance (Revert-Only)
- **Do NOT run `git reset --hard`**.
- PR33 contains no database schema migrations, Firestore security rule updates, or destructive data mutations. All changes are backward-compatible application logic and optimistic concurrency tokens.
- To safely rollback, perform a clean git revert:
  ```bash
  # If merged into main as a merge commit:
  git revert -m 1 <merge-commit-sha>
  # If squash-merged or rolling back PR branch commits:
  git revert --no-edit 7c0505d93bd98aa3945be30d5ccc373b7e01bec7
  ```
- Verify post-revert with `npx tsc -b` and `npx vitest run tests/`.

## 9. Final Verdict
**APPROVE**
