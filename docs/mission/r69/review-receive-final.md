# R69 Final Combined Financial & UI Review (Round 2)

**Verdict:** **APPROVE**  
**Date:** Sun Oct 25 2026  
**Provider:** opencode  
**Model:** 9router/gemini-3.8-flash-high  
**Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-8ed7fb6c`  
**Base SHA:** `6045b502171b1639d1e55c0f09e9a910e14ad064` (`6045b50`)  
**Source SHA Under Review:** `cb7176a8d27e12d39e2c4273c649619ae1c43acf` (`cb7176a`)  
**Report Commit:** `76b817d2ec30a974a52feabf0d0582aeb35883f7` (`76b817d`)  

---

## 1. Executive Summary & Verdict

This is the independent second-round combined review of the R69 Receive Pricing feature, evaluating both financial arithmetic correctness and UI presentation across desktop and mobile. The source under review (`cb7176a`) integrates pure price resolution (`src/lib/receiptPrice.ts`), UI components (`src/pages/Receive.tsx`, `src/pages/receive/PoLines.tsx`, `src/pages/receive/ReceiptReview.tsx`, `src/pages/receive/receipt.ts`), unit conversion consistency tests (`tests/receipt-price-consistency.test.ts`), resolver tests (`tests/receipt-price.test.ts`), UI tests (`tests/receive-prices.test.ts`), and Playwright E2E verification (`e2e/receive-prices.spec.ts`).

All objections from prior reviews (`f1b8a0` and `a88f102`) were audited against concrete execution and code inspections. No mathematical distortions, unhandled edge cases, cross-brand leaks, or unauthorized database writes were found.

**Verdict: APPROVE.**

---

## 2. Two-Axis Review Summary

### Standards Axis
- **smell baseline:** No significant smells found. A small presentation duplication exists between `ReceiptPanel` (`src/pages/receive/ReceiptReview.tsx:77-88`) and `ReviewModal` (`src/pages/receive/ReceiptReview.tsx:195-206`) for rendering the `มูลค่าประมาณการ` row, which is conventional in React components sharing view facts.
- **Purity:** One minor linter warning in `src/pages/receive/PoLines.tsx:106:21` (`asOf ?? Date.now()`) flagged by Oxlint under React 19 purity rules. Non-blocking because `ReceivePage` always supplies explicit `asOf={date}`.
- **Repository Standards:** Strictly respects multi-tenant brand scoping via `brandEpoch()` and `onBrandChange()`. Respects Spark quota restrictions by avoiding realtime listeners for supplier items. All UI strings translated in `src/i18n/en.ts`.

### Spec Axis
- **Requirements Satisfied:**
  - Read-only Receive pricing estimates for actual received quantities.
  - Strict precedence: Active matching `supplierPrice` > `costAsOf` (effectiveAt <= asOf) > `costLatest` > `missing`.
  - Missing price is distinctly `null`, never collapsing to `0.00 THB`.
  - Legitimate zero cost (`0.00 THB`) correctly renders as `฿0.00`.
  - All-missing or all-blank receipts display `—` instead of `฿0.00`.
  - Preserved PO rate (`baseQty / orderedQty`) strictly utilized; dynamic UOM conversion lookup forbidden and avoided.
  - No PO price snapshot created, no VAT/charge calculations fabricated, and zero prices or accounting records written to Firestore.

---

## 3. Verification Gates

| Gate | Command | Result | Notes |
|---|---|---|---|
| **Focused Resolver Tests** | `pnpm vitest run tests/receipt-price.test.ts` | **PASS (38/38)** | Duration: 325ms |
| **Focused Consistency Tests** | `pnpm vitest run tests/receipt-price-consistency.test.ts` | **PASS (14/14)** | Duration: 290ms |
| **Focused Receive Page Tests** | `pnpm vitest run tests/receive-prices.test.ts` | **PASS (16/16)** | Duration: 410ms |
| **Combined Focused Total** | 3 files | **PASS (68/68)** | 1.11s total duration |
| **Full Vitest Suite** | `pnpm vitest run` | **PASS (1,782/1,782)** | 144 test files in 15.48s |
| **TypeScript Typecheck** | `pnpm tsc -b` | **PASS (0 errors)** | Exit code 0 |
| **Oxlint Linter** | `pnpm oxlint ...` (scope files) | **PASS (0 errors, 1 warning)** | Warning: `Date.now()` during render in `PoLines.tsx:106` |
| **i18n Translation Check** | `node --experimental-strip-types scripts/i18n-check.mjs` | **PASS** | Every Thai UI string translated |

---

## 4. Concrete Domain & Financial Audit (file:line)

### 4.1 Factor Conversion vs Real `purchaseOrders.ts` Filing
- **Filing Implementation:** `src/services/purchaseOrders.ts:608-621`
  - Lines 608-610: If `!l.entryUnit`, line is filed in own unit without factor.
  - Line 612: If `l.baseQty !== undefined && l.orderedQty > 0`, factor is `l.baseQty / l.orderedQty`.
- **Resolver Implementation:** `src/lib/receiptPrice.ts:59-95`
  - Line 59-62: `cleanEntryUnit = typeof line.entryUnit === 'string' && line.entryUnit.trim() !== '' ? line.entryUnit.trim() : undefined`.
  - Line 65: `isAlternateUnit = cleanEntryUnit !== undefined && !sameUnit(cleanEntryUnit, line.unit)`.
  - Line 84-87: `factor = cleanEntryUnit !== undefined && hasPreservedRate ? (line.baseQty as number) / line.orderedQty : 1`.
- **Audit Findings:**
  1. *Own-unit with baseQty present:* If `entryUnit` is undefined or blank string, `cleanEntryUnit` is `undefined`, forcing `factor = 1`. This perfectly matches `purchaseOrders.ts:608` where `!l.entryUnit` skips conversion factor. (Verified by test in `tests/receipt-price.test.ts:553`).
  2. *Alternate unit with preserved rate:* For `orderedQty: 5, baseQty: 120` (Carton of 24 EA), `factor = 24`. Stock filed is `qty * 24` base units (`src/services/purchaseOrders.ts:620`). Displayed price is `basePrice * 24` per Carton. Line amount is `qty * (basePrice * 24) === (qty * 24) * basePrice`. Mathematical agreement is exact.
  3. *Alternate unit without preserved rate (legacy order):* In `purchaseOrders.ts:614`, filing queries product and calls `resolveFactor(product, line.entryUnit)`. In `receiptPrice.ts:75-82`, resolver returns `source: 'missing'`, `unitPrice: null`. This intentional divergence adheres to Contract §3.2 (no dynamic UOM lookup at receipt time to prevent mutable master data from retroactively altering order prices).

### 4.2 Own-Unit, Legacy Missing Rates, Quantities & Partial Receipts
- **Inputs & Boundaries:**
  - `qty === null`: Returns `lineAmount = null`. Increments `unenteredLines` in `receiptTotal` (`src/lib/receiptPrice.ts:254-255`).
  - `qty < 0`: Returns `lineAmount = null`. Increments `unenteredLines` in `receiptTotal`.
  - `qty === 0`: Returns `lineAmount = 0.00` if priced. Increments `pricedLines` in `receiptTotal`.
  - `price.source === 'missing'`: Returns `lineAmount = null`. Increments `missingLines` in `receiptTotal` if `qty >= 0`.
  - `price.unitPrice === 0` (legitimate free sample): Returns `lineAmount = 0.00`. Increments `pricedLines`.
- **Partial Receipts:**
  - In `src/pages/receive/receipt.ts:332-344`, `summariseReceiptPrices` operates strictly on `owedLines(order)` and keys quantities from `entries[l.productId]?.qty`. Prior delivered quantities (`line.receivedQty`) do not inflate current receipt valuation. Multi-round receipts price each arrival discretely with satang rounding (maximum cumulative rounding delta <= 0.01 THB per round).

### 4.3 Cost As-Of Date Boundary & Current Cost Labelling
- **Boundary Inclusion:** `src/lib/receiptPrice.ts:145` (`entry.effectiveAt <= asOf`).
  - Exact match (`effectiveAt === asOf`) qualifies for `costAsOf`.
  - Output carries `source: 'costAsOf'` and `effectiveAt: bestAsOf.effectiveAt`.
  - `priceSourceLabel` renders `ต้นทุน ณ {date}` using Thai date formatting (`src/pages/receive/receipt.ts:286-288`).
- **Deterministic Tie-Breaking:** `src/lib/receiptPrice.ts:41-43`
  - When two cost entries share identical `effectiveAt <= asOf`, ties break deterministically by the highest finite `entry.at` creation timestamp, independent of array ordering.
- **Future History vs Product Cost:** `src/lib/receiptPrice.ts:168-186`
  - When no history entries qualify under `asOf`, valid `product.cost` takes precedence over unreached future history.
  - If `product.cost` is absent, falls back to newest future history.
  - Both output `source: 'costLatest'` without `effectiveAt`, rendered by `priceSourceLabel` as `ต้นทุนล่าสุด`.

### 4.4 Total Missing vs True Zero UI Presentation
- **Component Rendering:** `src/pages/receive/ReceiptReview.tsx:77-88` (`ReceiptPanel`) & `195-206` (`ReviewModal`)
  - Evaluates `(facts.pricedLines ?? 0) > 0 ? \`฿\${fmtMoney(facts.estimatedTotal)}\` : '—'`.
  - **All lines unpriced (`pricedLines: 0, missingLines > 0`):** Renders `'—'` (not `฿0.00`) and displays amber footnote `ยังไม่ระบุราคา N รายการ`.
  - **All quantities blank (`pricedLines: 0, missingLines: 0`):** Renders `'—'` (not `฿0.00`).
  - **Legitimate zero-cost entered line (`pricedLines: 1, total: 0`):** Renders `฿0.00`.
  - **Mixed pricing:** Renders formatted total with amber missing items footnote.

### 4.5 Product, Supplier & Brand Scoping
- **Product ID Guard:** `src/lib/receiptPrice.ts:127-130`
  - Verifies `product.id === line.productId`. Unmatched product records are discarded.
- **Supplier Filtering:** `src/lib/receiptPrice.ts:98-106`
  - Filters active `SupplierItem` matching `item.supplierId === supplierId && item.productId === line.productId && item.buyingPrice >= 0`.
  - Conflicting prices among active items skip supplier pricing and fall back to product cost or missing.
- **Brand Isolation:** `src/pages/Receive.tsx:168-182`
  - `listSupplierItems()` queries brand-prefixed collection.
  - Inflight fetches verify `brandEpoch() === epoch` and `alive === true` before updating state.
  - `onBrandChange` immediately clears `supplierItems` on brand switch.

### 4.6 Stale Async Results on Brand/Order Switch
- In `src/pages/Receive.tsx:163-180`:
  - Changing `order` executes effect cleanup setting `alive = false`.
  - If `order` is cleared, `supplierItems` resets to `[]` synchronously.
  - Race conditions between slow responses from previous orders are discarded.

### 4.7 PO Agreed-Price Snapshot & Data Writes
- **Contract Adherence:**
  - `PurchaseOrderLine` does not store an agreed-price snapshot. Prices are strictly labeled with source provenance (`ราคาผู้ขาย`, `ต้นทุน ณ {date}`, `ต้นทุนล่าสุด`, `ยังไม่ระบุราคา`).
  - Summary card and review modal explicitly label the total as `มูลค่าประมาณการ` (Estimated Total).
  - Filing action `receivePurchaseOrder` (`src/services/purchaseOrders.ts:539-568`) receives only inventory line receipts and notes. No monetary amounts, VAT, or prices are written to Firestore.

---

## 5. Invariant Test vs Backend Integration Distinction

- **Clarification:** `tests/receipt-price-consistency.test.ts` defines a local helper function `filingStockQty` (`lines 19-35`) which mirrors the mathematical conversion algorithm of `src/services/purchaseOrders.ts:608-621`.
- **Classification:** This suite is a **pure invariant mathematical consistency test**, verifying that `receiptPrice.ts` and the filing algorithm produce identical quantities and financial valuations across conversions and rounding boundaries.
- **Boundary:** It is **not** an end-to-end Firestore backend integration test. Real backend integration is guarded by `purchaseOrders.ts` tests and Playwright E2E (`e2e/receive-prices.spec.ts`).

---

## 6. Domain Bounds & Floating-Point Precision Risk

- **Domain Analysis:** All calculations use standard IEEE-754 double-precision floating point with satang rounding (`Math.round((x + Number.EPSILON) * 100) / 100`).
- **Domain Limits:**
  - Double precision maintains exact integer arithmetic up to `Number.MAX_SAFE_INTEGER` (`9,007,199,254,740,991`).
  - For satang rounding (`* 100`), values exceeding `~90,071,992,547,409.91 THB` (~90 trillion THB) would experience sub-satang precision truncation.
  - Restaurant inventory batches operate within thousands to millions of THB, comfortably within exact precision limits.
- **Overflow Protection:**
  - Multiplications overflowing to `Infinity` or resulting in `NaN` are caught by `Number.isFinite(raw)` and return `null` (`src/lib/receiptPrice.ts:228-230`), preventing application crashes.

---

## 7. Observations & Minor Notes

1. **Oxlint Purity Warning (`PoLines.tsx:106`):**
   `asOf ?? Date.now()` inside the render body flags `react(purity)` in Oxlint. While harmless because `ReceivePage` provides `asOf={date}`, passing `Date.now()` from a hook or default prop would silence the linter.
2. **Cloud/Device Execution Proof:**
   In accordance with the review brief constraints, testing was completed locally via Vitest, TypeScript, Oxlint, and Playwright headless browser. No physical mobile tablet or live production Cloudflare deployment was accessed in this run.

---

## 8. Final Conclusion

The R69 Receive Pricing implementation is sound, robust, mathematically verified, and properly safeguarded against data corruption and cross-tenant leakage.

**Final Verdict: APPROVE**
