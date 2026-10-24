# R64 AGENT05 — BARCODE & SCANNER INDEPENDENT REVIEW REPORT

**Date:** 24 October 2026  
**Agent:** Agent 05 (Barcode & Scanner Review Sub-agent)  
**Model:** `9router/gemini-3.8-flash-high`  
**Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-f805af42`  
**Branch:** `t3/review-barcode-scan-safety` (tracking merged PR #29)  
**Base Commit:** `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55` (`origin/main`)  
**Merged Target SHA:** `b850d3a417e5152f8191a9b0dd739b5fa550566a` (`origin/fix/20261017-barcode-scan-safety`)  
**Predecessor Status:** R62 final software Gemini R2 APPROVE; parent unit 1792/1792; scanner emulator E2E 10/10; exact CI 10/10.

---

## 1. Executive Summary & Verification Findings

Comprehensive independent inspection of PR #29 (`fix/20261017-barcode-scan-safety` at exact SHA `b850d3a417e5152f8191a9b0dd739b5fa550566a`) verified that all barcode safety fences, input handling, lifecycle cleanup, and wedge/camera protections conform to specification and pass all software verification gates.

| Verification Scope | Status | Finding / Implementation Details |
|---|---|---|
| **Zero-Preservation** | **PASS** | `src/lib/barcode.ts`: leading zeros are preserved as exact token strings (never coerced to numeric type or stripped). Matching against non-zero token returns `not_found`. |
| **Case-Preservation** | **PASS** | `src/lib/barcode.ts`: Code 128 is treated as strictly case-significant. `ABC-128` vs `abc-128` match distinct products; mixed-case `Abc-128` yields `not_found`. No case-fold fallback. |
| **Duplicate & Inactive Match** | **PASS** | `src/lib/barcode.ts`, `src/lib/barcodeSelection.ts`: multiple active items with identical barcode fail-closed (`duplicate`); inactive items fail-closed (`inactive`); neither auto-adds. |
| **Failed Scan Reset** | **PASS** | `src/components/LineBuilder.tsx`, `src/pages/Adjust.tsx`, `src/pages/transfers/TransferReceivePage.tsx`: search input is reset to empty string immediately upon dispatch, preventing concatenated corruptions on repeated scans. |
| **Enter/Tab Natural Navigation** | **PASS** | `shouldScanOnTab` in `src/lib/barcodeSelection.ts`: Tab scans known barcodes or terminator codes; leaves partial name/SKU suggestions to natural keyboard focus navigation. `Shift+Tab` explicitly exits backward without triggering scan. |
| **IME isComposing / keyCode 229** | **PASS** | `isImeComposing` guard applied across **4 distinct inputs**: 1. `BarcodeScanner.tsx`, 2. `LineBuilder.tsx`, 3. `Adjust.tsx`, 4. `TransferReceivePage.tsx`. Prevents premature dispatch during IME candidate selection. |
| **Brand & Camera Lifecycle Cleanup** | **PASS** | `src/lib/cameraScan.ts`: `CameraScanController` uses monotonic generation counter `gen`. Stops all stream tracks, reader controls, and timers on unmount, close, or brand switch. `brandEpoch()` guards invalidate in-flight scans/dialogs across brand shifts. |
| **Confirmation Cadence (400ms)** | **PASS (Software)** | `src/components/Confirm.tsx`: `SCAN_BURST_MS = 400` swallows rapid wedge Tab bursts within 400ms. Modal body receives initial focus (`tabIndex={-1}`) so stray Enters cannot inadvertently activate confirmation buttons. Hardware calibration noted as physical hold. |
| **PR #33 Adjust Integration** | **PASS** | Confirmed clean semantic orthogonality between PR #29 (scan gate & row addition) and PR #33 (count baseline reconciliation & level conflict). No conflicting lines or logic drift. |

---

## 2. Verification Commands & Test Counts

All checks executed within isolated worktree `t3-f805af42` without running dev servers or emulators (no port collisions on 8080/9099/5206).

| Tool / Gate | Command Executed | Result / Output |
|---|---|---|
| **Typecheck** | `npx tsc --noEmit` | **PASS** (0 errors) |
| **Linter** | `npx oxlint` | **PASS** (0 errors; only standard pre-existing fast-refresh warnings) |
| **i18n Translation** | `npm run i18n:check` | **PASS** (100% Thai UI strings translated in `en.ts`) |
| **Production Build** | `npm run build` | **PASS** (Vite + SW + PWA manifest generated clean in 1.16s) |
| **Bundle Budget** | `npm run check:bundle` | **PASS** (main 239 KB, initial JS 1812 KB in 55 files; within budget) |
| **Pure Unit Tests (Focused)** | `npx vitest run tests/barcode*.test.ts tests/scan*.test.ts tests/adjust-idempotent.test.ts tests/synced-collection.test.ts` | **PASS: 12 test files / 92 passed / 0 failed** (1.45s) |

### Tested Suite Breakdown:
1. `tests/barcode.test.ts` (4 passed)
2. `tests/barcode-safety.test.ts` (14 passed)
3. `tests/barcode-r4.test.ts` (14 passed)
4. `tests/barcode-tab-selection.test.ts` (3 passed)
5. `tests/barcode-untrusted-bit.test.ts` (2 passed)
6. `tests/barcode-import.test.ts` (5 passed)
7. `tests/scan-catalog-gate.test.ts` (20 passed)
8. `tests/scan-gate-eligibility.test.ts` (6 passed)
9. `tests/scan-token-priority.test.ts` (9 passed)
10. `tests/scan-token.test.ts` (7 passed)
11. `tests/adjust-idempotent.test.ts` (2 passed)
12. `tests/synced-collection.test.ts` (6 passed)

---

## 3. PR #33 Adjust Integration Semantics Review

Inspected `src/pages/Adjust.tsx` across both branches (`312f8a7..7c0505d` for PR #33 vs `312f8a7..b850d3a` for PR #29) without altering any other checkout:

1. **PR #29 Scope in `Adjust.tsx`:**
   - Adds `useScanGate`, `useConfirm`, `isImeComposing`, `shouldScanOnTab`, `appendAdjRow`.
   - Replaces manual scan addition with authoritative `gate(code, { literal: true })`.
   - Adds robust scanner keydown handling (Enter/Tab/Shift+Tab/IME) on the search input.
   - Clears input on dispatch (`setSearch('')`).

2. **PR #33 Scope in `Adjust.tsx`:**
   - Adds `StockLevelConflictError` and `MissingExpectedLevelError` handling.
   - Adds `seen: { system: number; level: number }` to `AdjRow`.
   - Adds `displayedSystemQty`, `isMoved`, `mergeAdjustImportRow`, `movedNotice`.
   - Submits `expectedLevel: r.seen!.level` in `adjustStockLines`.

3. **Integration Compatibility Assessment:**
   - **No semantic overlap or clash:** PR #29 governs row *entry* (how items enter the page via camera or keyboard-wedge search box). PR #33 governs row *reconciliation & submission* (tracking keyed system level vs current stock level).
   - In PR #29, `appendAdjRow` creates uncounted rows (`mode: 'count'`, `value: null`). When the operator keys a counted value into that row, PR #33's `onChange` captures `seen: seenNow(r.productId)`.
   - Merging both branches into main will proceed without semantic conflict.

---

## 4. Physical USB / Bluetooth Hardware QA Checklist

> **CRITICAL DISCLAIMER:** Physical USB and Bluetooth scanner hardware was **NOT** attached to this review environment. **Physical hardware QA is NOT claimed.**  
> The following precise operational checklist MUST be executed by on-site QA with physical scanners before production release approval:

### Test Station Requirements:
- 1x USB Handheld Wedge Barcode Scanner (e.g. Honeywell/Zebra)
- 1x Bluetooth Ring/Pocket Barcode Scanner
- 1x Tablet with rear camera (iPad Safari / Android Chrome)
- Physical barcode test sheet with printed Code 128, EAN-13, and Thai keyboard layout edge cases.

### Checklist Items:

1. **Enter vs Tab Terminator Configuration:**
   - [ ] Program USB scanner with **CR/Enter** suffix. Scan code on `/issue`, `/adjust`, and `/transfers/:id`. Verify item prompts confirmation modal; verify suggestion dropdown is NOT picked.
   - [ ] Program USB scanner with **Tab** suffix. Scan code on `/issue`, `/adjust`, and `/transfers/:id`. Verify item prompts confirmation modal.
   - [ ] Press physical keyboard **Tab** when typing item name with suggestions open. Verify natural focus navigation occurs without adding item.
   - [ ] Press physical keyboard **Shift+Tab**. Verify focus moves backward without clearing text or adding item.

2. **Leading Zero Preservation:**
   - [ ] Scan printed barcode with leading zeros (e.g., `0012345678901`).
   - [ ] Verify displayed token in confirmation modal retains all leading zeroes (`0012345678901`), not stripped to `12345678901`.
   - [ ] Type `12345678901` and press Enter. Verify result is rejected as "not found", never auto-matched to the zero-prefixed item.

3. **Case Sensitivity (Code 128):**
   - [ ] Scan `ABC-128` barcode -> Verify matches product configured with uppercase barcode.
   - [ ] Scan `abc-128` barcode -> Verify matches product configured with lowercase barcode.
   - [ ] Scan mixed-case `Abc-128` -> Verify fails closed ("ไม่พบบาร์โค้ด..."), no casefold fallback.

4. **Duplicate & Inactive Rejection:**
   - [ ] Scan barcode assigned to two active products in brand catalogue -> Verify immediate rejection toast ("ซ้ำกับสินค้า 2 รายการ"), no automatic selection.
   - [ ] Scan barcode assigned to retired/inactive product -> Verify rejection toast ("สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว: ...").

5. **Failed Scan Reset & Input Hygiene:**
   - [ ] Scan unknown/unregistered barcode -> Verify error toast appears.
   - [ ] Verify input box is immediately cleared (0 characters).
   - [ ] Immediately scan a second, valid barcode -> Verify valid barcode scans cleanly without concatenated residue.

6. **IME Composition & KeyCode 229:**
   - [ ] Switch tablet/OS keyboard to Thai/Japanese IME.
   - [ ] Type search text and press Enter to select an IME candidate.
   - [ ] Verify text remains in input box; scan gate is NOT triggered while composing (`isComposing: true` or `keyCode: 229`).

7. **Camera Hardware Indicator & Lifecycle:**
   - [ ] Tap camera scan button on tablet.
   - [ ] Verify device prompt opens and camera hardware indicator LED illuminates.
   - [ ] Tap "Cancel" -> Verify modal closes and camera indicator LED turns OFF immediately (no lingering tracks).
   - [ ] Switch Brand while camera modal is open -> Verify modal immediately unmounts, camera turns OFF, and no state leaks to the new brand.

8. **Confirmation Cadence & Fast Repeat (400ms Calibration):**
   - [ ] Open confirmation modal for a scanned item.
   - [ ] Rapidly pull physical scanner trigger twice (<400ms burst) on another barcode.
   - [ ] Verify:
     - The modal message retains focus (`tabIndex={-1}`); stray Enter does not confirm the dialog.
     - Stray Tab burst within 400ms is suppressed; does not tab-walk focus to action buttons.
     - Secondary scan is refused with: "กำลังรอยืนยันรายการก่อนหน้า — กรุณาสแกนใหม่หลังยืนยัน".
   - [ ] Measure physical scanner inter-character delay and suffix timing across shop floor scanner models to calibrate `SCAN_BURST_MS = 400`.

---

## 5. Final Status & Rollback Plan

- **Final Status:** **READY_FOR_OWNER_RELEASE (Software Gates Only)**
- **Hardware Hold:** **HOLD FOR PHYSICAL HARDWARE QA** (Owner/QA must sign off the physical hardware checklist in Section 4).
- **Rollback Strategy:** Revert commit via git revert (`git revert b850d3a417e5152f8191a9b0dd739b5fa550566a` or PR revert). **NO git reset or force-push.**
