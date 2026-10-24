# R69: Receive Unpriced / Blank Total Display Correction

**Status: REVIEW_PENDING**

Bounded UI correction following independent review `a88f102` (`CHANGES_REQUESTED`) on branch `fix/r69-receive-unpriced-total` from base commit `3b32f1b`.

---

## 1. Context & Review Finding Addressed

- **Review finding:** When all entered lines were unpriced (e.g. sauce qty 4 with no cost/supplier item, yielding `total = 0`, `pricedLines = 0`, `missingLines = 1`) or when all quantities were blank, the summary card (`ReceiptPanel` / "ใบรับนี้") and modal review (`ReviewModal`) displayed `มูลค่าประมาณการ ฿0.00`.
- **Domain violation:** In the receiving domain, `฿0.00` is reserved for legitimate zero-price items (e.g. true free goods / promotional zero-cost samples). Displaying `฿0.00` for unpriced goods or blank entries misleadingly implies free goods instead of unknown valuation.
- **Correction:** When `pricedLines === 0` (whether all unpriced or all quantities blank), display em-dash `'—'` for `มูลค่าประมาณการ`. When `pricedLines > 0` and total is 0 (genuine zero-price entered line), display `฿0.00`. Retain amber missing-count footnote (`ยังไม่ระบุราคา N รายการ`).

---

## 2. TDD Cycle

### RED (Test Commit: `bcee211`)
- Added focused regression tests to `tests/receive-prices.test.ts` for:
  - `summariseReceiptPrices`:
    - All entered lines unpriced (`estimatedTotal: 0`, `pricedLines: 0`, `missingLines: 1`)
    - All quantities blank (`estimatedTotal: 0`, `pricedLines: 0`, `missingLines: 0`, `unenteredLines: 3`)
    - Legitimately priced-at-zero line (`estimatedTotal: 0`, `pricedLines: 1`, `missingLines: 0`)
  - `ReceiptPanel` component rendering:
    - All-unpriced renders `'—'` under `มูลค่าประมาณการ` (not `'฿0.00'`) with `'ยังไม่ระบุราคา 1 รายการ'`
    - All-blank renders `'—'` under `มูลค่าประมาณการ` (not `'฿0.00'`)
    - Priced-at-zero renders `'฿0.00'`
  - `ReviewModal` component rendering:
    - All-unpriced renders `'—'` under `มูลค่าประมาณการ` (not `'฿0.00'`) with `'ยังไม่ระบุราคา 1 รายการ'`
    - All-blank renders `'—'` under `มูลค่าประมาณการ` (not `'฿0.00'`)
    - Priced-at-zero renders `'฿0.00'`
- **Failure output:** 4 tests failed with `AssertionError: expected '...฿0.00...' to contain '—'` (exact expected failure).

### GREEN (Fix Commit: `dd973b0`)
- **`src/pages/receive/ReceiptReview.tsx`**:
  - Added `pricedLines?: number` to `interface ReceiptFacts`.
  - In `ReceiptPanel` and `ReviewModal`, updated estimated total rendering:
    ```tsx
    <span className="num">{(facts.pricedLines ?? 0) > 0 ? `฿${fmtMoney(facts.estimatedTotal)}` : '—'}</span> {/* ฿ is a currency symbol — i18n-key */}
    ```
- **`src/pages/Receive.tsx`**:
  - Propagated `pricedLines: priceSummary?.pricedLines` into `facts: ReceiptFacts`.
- **`src/lib/receiptPrice.ts`**:
  - Untouched as mandated (integrated elsewhere).

---

## 3. Verification & Checks

| Check | Command | Result |
|---|---|---|
| Focused Unit Tests | `npx vitest run tests/receive-prices.test.ts tests/receipt-price.test.ts` | PASS (43 passed in 2 test files) |
| TypeScript Compiler | `npx tsc -b` | PASS (0 errors) |
| Linter | `npx oxlint src/pages/Receive.tsx src/pages/receive/ReceiptReview.tsx tests/receive-prices.test.ts` | PASS (0 errors, 0 warnings) |
| Translations Check | `npm run i18n:check` | PASS (0 missing keys, 0 untranslated Thai UI strings) |
| Full Vitest Suite | `npm test` | PASS (143 test files passed, 1757 passed) |

---

## 4. Delivery Metadata

- **Provider / Model:** `opencode` / `9router/gemini-3.8-flash-high`
- **Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-1bb0abbd`
- **Branch:** `fix/r69-receive-unpriced-total`
- **Base Commit:** `3b32f1b`
- **Commits:**
  - `bcee211`: `test(receive): add regression tests for unpriced and blank receipt total display`
  - `dd973b0`: `fix(receive): display dash for unpriced and blank receipt total estimates`
