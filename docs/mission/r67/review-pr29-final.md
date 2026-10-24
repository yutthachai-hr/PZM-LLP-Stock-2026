# PR #29 & QA Suite Final-Diff Review Report (Wave A)

## 1. Commit SHAs & Git Trees

- **Evaluated QA Commit SHA**: `367468613ad3a41ce081286971e5352006519611` (`test(qa): add PR29 automated barcode scanner QA suite and physical test sheet`)
- **PR #29 Head Commit SHA**: `b850d3a417e5152f8191a9b0dd739b5fa550566a` (Branch: `fix/20261017-barcode-scan-safety`)
- **Merge Base (`origin/main`) SHA**: `6045b502171b1639d1e55c0f09e9a910e14ad064` (Post-PR #53 merge)
- **`git merge-tree --write-tree origin/main 3674686`**: Clean tree `96365be2fab82999cc3054d4c228b8db36e01716` (0 merge conflicts)

---

## 2. Independence Statement

- **Reviewer Agent & Model**: Fresh Gemini Reviewer (`9router/gemini-3.8-flash-high`) operating in an independent clean sub-session.
- **Cross-Model Independence (`src/`)**: All application code in PR #29 (`312f8a7...b850d3a`) was authored by Codex/MAIN. This review provides independent cross-model verification.
- **Separate-Agent Independence (`e2e/` & `docs/`)**: The QA test suite and mission docs in commit `3674686` were authored by a separate Gemini session. This reviewer had no involvement in writing the tests or documentation.
- **Operational Scope**: Strict review-only execution. No modifications to `src/` or `e2e/` (working tree remains clean; only documentation report committed). No remote pushes, no PR comments, no nested agents.

---

## 3. Test & Verification Execution Summary

Executed the required verification gates once on dedicated local ports (Firestore: 8080, Auth: 9099, Vite: 5176):

1. **Playwright E2E Integration Suite**:
   ```bash
   npx --no-install firebase emulators:exec --only firestore,auth --project demo-pzm-e2e "npx playwright test e2e/barcode-scan-safety.spec.ts e2e/barcode-scanner-qa.spec.ts"
   ```
   - **Result**: **18 passed** across 2 files (~1.3 minutes)
   - `e2e/barcode-scan-safety.spec.ts`: 10 passed (0 failed)
   - `e2e/barcode-scanner-qa.spec.ts`: 8 passed (0 failed)

2. **Vitest Unit & Integration Suites**:
   ```bash
   npx vitest run tests/barcode tests/scan
   ```
   - **Result**: **10 test files passed (10)**, **82 tests passed (82)** (1.08s)

3. **Type Checking**:
   ```bash
   npx tsc -p e2e/tsconfig.json --noEmit
   ```
   - **Result**: 0 type errors (clean exit code 0)

4. **Static Code Analysis**:
   ```bash
   npx oxlint
   ```
   - **Result**: 0 errors (clean exit code 0)

---

## 4. Per-Case Mutation Analysis (QA Suite Sensitivity Audit)

Key safety question: **Would each of the 8 automated cases in `e2e/barcode-scanner-qa.spec.ts` fail if the specific protection it claims were broken or regressed?**

| Case # | Safety Invariant / Protection | Concrete Mutation | Would Fail? | Positive Precondition & Evidence |
|:---:|---|---|:---:|---|
| **Case 1** | Exact barcode resolution + legacy unverified human confirmation + line addition. | Make `resolveBarcode` return `not_found` or make confirmation modal fail to add line (`onAdd` dropped). | **YES** | Precondition: `catalogHolds` positively checks seeded product button is visible. Postcondition: asserts dialog is visible with exact product name/code (`toBeVisible`), and `input[type="number"]` has count 1 and value '1'. Cannot pass vacuously. |
| **Case 2** | Leading zeros preservation (`0012345678901` vs `12345678901` remain distinct string tokens). | Mutate `resolveBarcode` to strip leading zeros (`replace(/^0+/, '')`) or parse as numeric `Number(code)`. | **YES** | Precondition: seeds both items; `catalogHolds` verifies both visible in suggestions. Postcondition: First scan asserts dialog matches Item 1 and `not.toContainText(Item 2)`; second scan asserts dialog matches Item 2 and `not.toContainText(Item 1)`. Final count requires exactly 2 distinct rows. Proven via mutation in `tests/barcode-safety.test.ts`. |
| **Case 3** | Enter terminator clears search box immediately and triggers resolution modal. | In `LineBuilder.tsx`, remove `setSearch('')` upon Enter, or suppress `gate(raw)` invocation. | **YES** | Precondition: catalog loaded. Postcondition: asserts `expect(searchBox).toHaveValue('')` immediately after Enter, and dialog visibility. If input is not cleared, `toHaveValue('')` fails. |
| **Case 4** | Tab suffix triggers scan for exact codes (4a); Shift+Tab navigates backwards without scanning (4b); partial query + Tab retains text for keyboard navigation (4c). | (4a) Drop Tab handler in `LineBuilder.tsx`.<br>(4b) Remove `!e.shiftKey` check.<br>(4c) Mutate `shouldScanOnTab` to always return `true` on partial text. | **YES** | (4a) Asserts dialog opens and row added.<br>(4b) Shift+Tab asserts dialog count 0; ran in same session where 4a proves Tab works.<br>(4c) Positively asserts suggestion button is visible (`toBeVisible`), presses Tab, asserts search box retains query text `toHaveValue('QA TAB')` and dialog count is 0. Proven via mutation in `tests/barcode-tab-selection.test.ts`. |
| **Case 5** | Unknown barcode fails closed: displays not-found error toast, keeps line list empty, and clears input. | Allow fuzzy/fallback match to first product, or do not clear input, or omit error toast. | **YES** | Precondition: verifies catalog loaded via `catalogHolds(page, 'flour', ...)`. Postcondition: positively asserts visibility of error toast text (`/ไม่พบบาร์โค้ด 9998887776665 ในระบบ/`), asserts empty table placeholder is visible, and asserts `searchBox` value is cleared `''`. |
| **Case 6** | Duplicate active barcode (6a) and retired/inactive barcode (6b) fail closed with explicit diagnostic toasts. | Fall back to `matches[0]` on duplicate; ignore `active === false` check. | **YES** | Precondition: `catalogHolds` proves both duplicates seeded and present. Postcondition: Positively asserts specific error toasts (`/บาร์โค้ด ... ซ้ำกับสินค้า 2 รายการ/` and `/สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว/`). Both require 0 lines added and search box cleared. |
| **Case 7** | Double-trigger & rapid burst (<400ms): no concatenated input tokens, no duplicate rows, and second scan blocked by `isConfirmingRef`. | Remove `isConfirmingRef` gate, drop `SCAN_BURST_MS = 400`, or keep raw text in search input across scans. | **YES** | Precondition: verifies measured gap < 400ms (`expect(gap).toBeLessThan(400)`). Part 7A asserts search box is not concatenated (`not.toHaveValue('88510007770078851000777007')`), dialog opens once, and quantity is exactly 1 (not 2). Part 7B asserts second code does not overwrite dialog or add extra line (total lines = 2, Item B absent). |
| **Case 8** | Scanner lifecycle & brand isolation: modal cancel clears typed state; brand switch cleanly drops active listener and resolves only the new brand's item. | Omit `setTyped('')` on reopen; omit `brandEpoch()` check or `onBrandChange` teardown. | **YES** | Precondition: seeds identical barcode in both Pizza Mania and Le Lapin. Subcase 8a asserts reopened modal input has value `''`. Subcase 8b switches brand, proves Le Lapin active, and positively asserts dialog and table contain `QA LAPIN ONLY ITEM` and `not.toContainText('QA PIZZA ONLY ITEM')`. |

---

## 5. Timing Claims & Hardware Boundaries Verification

1. **Wedge Inter-Key Timings**:
   - Claim in `pr29-automated-qa.md`: Target inter-key delay `8–10 ms`; observed average delay `26–37 ms` (Playwright CDP loop); total typing duration `372–561 ms`.
   - **Verification**: Verified via Playwright logs during the live run:
     - Sample 1: 13 chars, total `454 ms`, avg gap `32 ms`.
     - Sample 2: 13 chars, total `497 ms`, avg gap `36 ms`.
     - Sample 3: 11 chars, total `384 ms`, avg gap `31 ms`.
     - Sample 4: 13 chars, total `362 ms`, avg gap `26 ms`.
   - The docs accurately reflect the simulated event loop overhead without exaggerating browser CDP speeds.

2. **Rapid Burst Inter-Scan Gap**:
   - Claim: Inter-scan gaps measured at `61 ms` – `79 ms` (< `400 ms` `SCAN_BURST_MS`).
   - **Verification**: Live execution logged:
     - Case 7A (same code): `Gap: 71 ms`
     - Case 7B (diff codes): `Gap: 61 ms`
   - Both were well below the 400 ms threshold and accurately proved the burst gate.

3. **Honesty on Physical Hardware**:
   - `docs/mission/r67/pr29-automated-qa.md` clearly demarcates automated simulation from physical hardware in Section 4 (*Limits of Simulation*).
   - It explicitly notes that hardware scanners stream reports at 1000 Hz into the OS keyboard buffer, may emit firmware-specific terminators (CR, LF, CRLF, Tab), and are subject to physical contact bounce and paper glare.
   - Physical hardware status is honestly stated as `PHYSICAL_HARDWARE_PENDING`. No automated run claims physical certification.

---

## 6. Review Findings

### Must Findings
- **None**. All P0 barcode safety fences, input handling, lifecycle hooks, and fail-closed invariants are sound, verified, and regression-tested.

### Should Findings
1. **Physical Barcode Sheet Print Scale (`docs/mission/r67/pr29-test-barcodes.md:9`)**:
   - When printing `pr29-test-barcodes.md`, store staff must select "Actual Size / 100%" in the printer dialog to avoid barcode aspect ratio distortion. The document correctly specifies this in the instructions.
2. **Fast Refresh Warning (`src/components/Confirm.tsx:134`)**:
   - Oxlint reports a standard Vite/React Fast Refresh warning because `Confirm.tsx` exports both `ConfirmProvider` and `useConfirm`. This is a non-blocking convention used consistently across context providers in this codebase.

---

## 7. Review Verdict & Release Recommendation

- **Final Verdict**: **`APPROVE`**
- **Production Release Status**: **`READY_FOR_RELEASE`** (pending only on-site physical handheld scanner verification using `docs/mission/r67/pr29-test-barcodes.md`).

---

- **Provider / Model**: `9router/gemini-3.8-flash-high`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-89719c1a`
- **Report Commit SHA**: `90ee3adbe5db65e00c99f702eb7e4b16bc6f8a65`
