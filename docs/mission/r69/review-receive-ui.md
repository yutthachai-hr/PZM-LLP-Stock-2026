# R69 Code Review: Receive Prices UI & Integration

- **Target Commit SHA:** `3b32f1ba914cd2e49c0d5a33df4bd80e6e761c99` (`3b32f1b`)
- **Base Commit SHA:** `934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8` (`934cbfa`)
- **Files Reviewed (6 UI/helper/test + e2e):**
  - `src/pages/Receive.tsx`
  - `src/pages/receive/PoLines.tsx`
  - `src/pages/receive/ReceiptReview.tsx`
  - `src/pages/receive/receipt.ts`
  - `src/i18n/en.ts`
  - `tests/receive-prices.test.ts`
  - `e2e/receive-prices.spec.ts`
- **T3 Provider / Model:** `opencode` / `9router/gemini-3.8-flash-high`
- **Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-773a5794`
- **Independence:** Same-family separate-agent review (fresh agent reviewing R69 agent02 delivery in detached worktree).
- **Verification Commands Executed:**
  - `npx vitest run tests/receive-prices.test.ts tests/receipt-price.test.ts`: PASS (34 passed, 2 test files)
  - `npx tsc -b`: PASS (0 errors)
  - `npx tsc -p e2e/tsconfig.json`: PASS (0 errors)
  - `npm run i18n:check`: PASS (0 missing)
  - `npx oxlint`: PASS (0 warnings/errors in changed files)
  - Screenshots inspected: `docs/evidence/receive-price/receive-price-1440.png` and `docs/evidence/receive-price/receive-price-390.png`

---

## 1. Audit Against Core Requirements & Checklist

| Check / Requirement | Status | Verification Details |
|---|---|---|
| **Compact prices per received qty** | **PASS** | `PoLines.tsx:111-166`: Desktop uses compact 6-column grid; mobile nests unit price + calculated amount under product name. |
| **Supplier / cost source labels** | **PASS** | `receipt.ts:278-294`: Correctly renders `ราคาผู้ขาย`, `ต้นทุนล่าสุด`, `ต้นทุน ณ {date}` (with Thai/AD date formatting), or `ยังไม่ระบุราคา`. |
| **Estimates not PO agreed prices** | **PASS** | Uses `มูลค่าประมาณการ`; no fabricated agreed-price fields on PO lines. |
| **No accounting/stock ledger writes** | **PASS** | `Receive.tsx:324-342`: `receivePurchaseOrder` receives only `{ productId, receivedQty, checked, note }`. No price fields written to backend. |
| **Preserve qty / variance / reason** | **PASS** | `variance()`, `needsReason()`, `poProblem()` unchanged. Refusal flags and variance chips function identically. |
| **Async supplier fetch & brandEpoch** | **PASS** | `Receive.tsx:163-182`: `useEffect` tracks `brandEpoch()` and `alive` cancellation; `onBrandChange` clears `supplierItems`. |
| **Same brand same document number** | **PASS** | `Receive.tsx:258-265`: Duplicate doc checking (`findDuplicateDocument`) preserved; UI prices diff does not alter duplicate logic. |
| **Valid zero price handling** | **PASS** | `PoLines.tsx:115, 149`: `price.unitPrice !== null` cleanly preserves `฿0.00` and displays `0.00 THB` without collapsing to missing. |
| **Negative qty invalid** | **PASS** | `PoLines.tsx:139`: HTML `min={0}`; `receiptPrice.ts:150`: `lineAmount` rejects `qty < 0`; `purchaseOrders.ts:582`: backend rejects negative qty. |
| **Source cost dates & translations** | **PASS** | `receipt.ts:284-287`: Uses `formatThaiDate(price.effectiveAt)`; `src/i18n/en.ts` contains all required translation keys. |
| **Review summary agrees with lines** | **PASS** | Both `priceSummary` and `PoLines` compute prices using identical `asOf = date`. Date changes re-evaluate both consistently. |
| **No new cost-role exposure** | **PASS** | Products were already in memory via `useData()` on `/receive`. No new backend role bypass or unauthenticated endpoint. |
| **All quantities blank** | **DEFECT (SHOULD)** | `ReceiptReview.tsx:76-87`: Shows `มูลค่าประมาณการ ฿0.00` on the side summary card before any line quantity is entered. |
| **All entered prices missing** | **DEFECT (MUST)** | `ReceiptReview.tsx:76-87, 194-205`: When all entered lines are unpriced, shows `มูลค่าประมาณการ ฿0.00` alongside amber alert, misleadingly asserting 0 THB / free goods. |

---

## 2. Findings

### Must Fix

1. **`src/pages/receive/ReceiptReview.tsx:76-87, 194-205` & `src/pages/Receive.tsx:298-304`: All entered prices missing displays `฿0.00`, misleadingly asserting free goods**
   - **Concrete Input:**
     - PO with 1 line (or N lines): `productId: 'sauce'` (no `SupplierItem`, no product `cost` or `costHistory`).
     - Staff enters received quantity: `qty = 4`.
     - Staff opens review (`ReviewModal`).
   - **Actual Outcome:**
     - `res = receiptTotal(rows)` returns `res.total = 0`, `res.pricedLines = 0`, `res.missingLines = 1`.
     - `priceSummary.estimatedTotal` is `0`.
     - `ReceiptReview.tsx` checks `{facts.estimatedTotal !== undefined && (` and renders:
       ```tsx
       <span className="num">฿{fmtMoney(facts.estimatedTotal)}</span>
       <span className="block text-xs font-normal text-amber">ยังไม่ระบุราคา 1 รายการ</span>
       ```
     - User sees bold primary text: `มูลค่าประมาณการ ฿0.00`.
   - **Problem:**
     - The bold number `฿0.00` asserts that the receipt has zero monetary value (free goods / 0 THB).
     - Per the core domain rule: `0` is a valid price (for genuine free goods), while missing price is `null` (never shown as 0).
     - On individual lines (`PoLines.tsx`), the author correctly suppressed amounts and displayed `ยังไม่ระบุราคา`. But in the summary card and review modal, an empty sum collapses to `฿0.00`.
   - **Fix:**
     - In `Receive.tsx` or `ReceiptReview.tsx`, distinguish `pricedLines === 0` from genuine zero-priced goods:
     - Pass `pricedLines: priceSummary?.pricedLines` in `ReceiptFacts`.
     - In `ReceiptReview.tsx`:
       ```tsx
       <span className="num">
         {facts.pricedLines === 0 ? '—' : `฿${fmtMoney(facts.estimatedTotal)}`}
       </span>
       ```
       or omit `estimatedTotal` when `pricedLines === 0` and display `—` when `missingLines > 0`.

### Should Fix

2. **`src/pages/receive/ReceiptReview.tsx:76-87`: Blank quantities show `มูลค่าประมาณการ ฿0.00` before entry**
   - **Concrete Input:** PO opened with 3 lines; `d.entries` is `{}` (all quantities blank).
   - **Actual Outcome:** `ReceiptPanel` displays `มูลค่าประมาณการ ฿0.00` before staff keys any quantity.
   - **Fix:** If `pricedLines === 0 && missingLines === 0`, display `—` or hide the estimated value row until at least one line is entered.

---

## 3. Verdict

**CHANGES_REQUESTED**

The implementation is high quality, compact, well-structured, has clean TypeScript types, passes all 34 focused unit tests and lint checks, and desktop/mobile layout aligns with the visual design. However, displaying `มูลค่าประมาณการ ฿0.00` when all entered lines are unpriced misleadingly asserts free goods (zero-value delivery) in violation of the core domain pricing rules.
