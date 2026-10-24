# R69 Code Review: Receipt Price Resolver

- **Target Commit SHA:** `934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8` (`934cbfa`)
- **Base Commit SHA:** `6045b502171b1639d1e55c0f09e9a910e14ad064` (`6045b50`)
- **Files Reviewed:**
  - `src/lib/receiptPrice.ts` (202 lines)
  - `tests/receipt-price.test.ts` (564 lines, 28 tests)
- **Independence:** Separate-agent review (fresh Gemini agent reviewing code authored by another Gemini session in same family).
- **Test / Typecheck Verification:**
  - `npx vitest run tests/receipt-price.test.ts`: 28 passed (28)
  - `npx tsc -b`: Clean (0 errors)

---

## 1. Owner Rules Compliance Audit

| Rule | Status | Notes |
|---|---|---|
| **Precedence:** `supplierPrice` > `costAsOf` > `costLatest` > `missing` | **PASS** | Strictly enforced in sequential if-branches. |
| **Active SupplierItem match:** this supplier + product, finite `buyingPrice >= 0` | **PASS** | Checked at `src/lib/receiptPrice.ts:61-69`. |
| **Zero vs Missing:** Zero is valid price, missing is `null` (never shown as 0) | **PARTIAL** | Preserved for inputs, but `baseQty: 0` causes `unitPrice: 0` for non-zero prices. |
| **PO Preserved Rate:** uses only `baseQty / orderedQty` when `entryUnit` set | **PASS** | `product.unitConversions` is never queried or imported. |
| **Rounding:** only on amounts, 2 dp (satang) | **PASS** | `Math.round((x + Number.EPSILON) * 100) / 100` in `lineAmount` and `receiptTotal`. |
| **Total Calculation:** counts only priced + entered lines | **PASS** | `receiptTotal` sums only where `amt !== null`. |
| **No PO agreed price snapshot claim** | **PASS** | Explicitly stated in module comment; no agreed-price field invented. |

---

## 2. Attack Vectors & Outcomes

| Attack Vector | Concrete Input | Expected Behavior | Actual Outcome | Severity |
|---|---|---|---|---|
| **baseQty: 0** | `orderedQty: 10, baseQty: 0, cost: 100` | Fallback to factor 1 or invalid conversion rate | **Wrong result:** `unitPrice: 0` (`src/lib/receiptPrice.ts:52-58`). A 100 THB product displays as 0.00 THB. | **MUST** |
| **baseQty: negative** | `orderedQty: 10, baseQty: -5, cost: 100` | Fallback to factor 1 or reject | **Wrong result:** `unitPrice: -50` (`src/lib/receiptPrice.ts:52-58`). Negative unit price returned. | **MUST** |
| **baseQty: NaN** | `orderedQty: 10, baseQty: NaN, cost: 100` | Safe fallback to factor 1 | `unitPrice: 100` (Handled via `Number.isFinite`). | PASS |
| **orderedQty: 0** | `orderedQty: 0, baseQty: 24, cost: 100` | Safe fallback to factor 1 | `unitPrice: 100` (Handled via `line.orderedQty > 0`). | PASS |
| **entryUnit: '' (empty string)** | `unit: 'EA', entryUnit: '', orderedQty: 10` | Displayed unit falls back to `line.unit` ('EA') | **Wrong result:** `unit: ""` (`src/lib/receiptPrice.ts:44`). In JS `'' ?? 'EA'` evaluates to `''`. | **MUST** |
| **entryUnit: '   ' (whitespace)** | `unit: 'EA', entryUnit: '   ', orderedQty: 10` | Displayed unit falls back to `line.unit` ('EA') | **Wrong result:** `unit: "   "` (`src/lib/receiptPrice.ts:44`). | **SHOULD** |
| **duplicate active SupplierItems** | Two active items for same supplier & product with prices `40` and `50` | Deterministic price resolution | Non-deterministic across arbitrary array order: `.find()` takes first match (`src/lib/receiptPrice.ts:61`). | **SHOULD** |
| **costHistory equal effectiveAt** | Two entries with `effectiveAt: 1000`, costs `40` and `50` | Deterministic tie-breaking | Non-deterministic across arbitrary array order: `>=` takes the last entry in array (`src/lib/receiptPrice.ts:95`). Does not tie-break by `entry.at`. | **SHOULD** |
| **costHistory all in future** | `product.cost = 30`, `costHistory = [{ cost: 80, effectiveAt: 6000 }]`, `asOf = 2000` | Spec clarification | Resolves `source: 'costLatest'`, `unitPrice: 80` (`src/lib/receiptPrice.ts:121-125`). Matches contract §2, but uses future price over current `product.cost`. | **SHOULD** |
| **qty negative** | `price = 50`, `qty = -5` | Reject or count as unentered / invalid | `lineAmount` returns `null`. But `receiptTotal` counts `missingLines: 1` (`src/lib/receiptPrice.ts:183-193`), falsely blaming missing price. | **SHOULD** |
| **large numbers** | `price = 1e8`, `qty = 1e5` | Accurate computation | Computes `10000000000000` accurately within JS safe integer limits. | PASS |
| **-0 (negative zero)** | `product.cost = -0` | Normalized to `0` | `resolveReceiptPrice` leaves `unitPrice: -0` (`src/lib/receiptPrice.ts:131`). `lineAmount` normalizes to `0`. | **SHOULD** |

---

## 3. Findings

### Must Fix

1. **`src/lib/receiptPrice.ts:52-56`: `baseQty <= 0` produces zero or negative unit price**
   - **Problem:** `hasPreservedRate` checks `line.orderedQty > 0`, but only checks `typeof line.baseQty === 'number' && Number.isFinite(line.baseQty)` without requiring `line.baseQty > 0`.
   - When `baseQty === 0`, `factor = 0 / orderedQty = 0`, collapsing a 100 THB item to `0.00 THB`. This breaks the owner rule "zero is a price, missing is null (never shown as 0)" by displaying 0 for a non-zero price.
   - When `baseQty < 0`, `factor < 0`, producing a negative `unitPrice`.
   - **Fix:** Update line 52 to enforce positive baseQty:
     ```typescript
     typeof line.baseQty === 'number' &&
     Number.isFinite(line.baseQty) &&
     line.baseQty > 0 &&
     ```

2. **`src/lib/receiptPrice.ts:44`: Empty string `entryUnit` results in empty displayed unit**
   - **Problem:** `const displayedUnit = line.entryUnit ?? line.unit`. When `line.entryUnit === ''`, nullish coalescing does not fall back to `line.unit`, returning `""` as the unit label to UI callers.
   - **Fix:**
     ```typescript
     const displayedUnit =
       typeof line.entryUnit === 'string' && line.entryUnit.trim() !== ''
         ? line.entryUnit.trim()
         : line.unit
     ```

### Should Fix

3. **`src/lib/receiptPrice.ts:183-193`: Negative `qty` in `receiptTotal` falsely counted as `missingLines`**
   - **Problem:** `row.qty = -5` with a valid price causes `lineAmount` to return `null`. In `receiptTotal`, because `typeof qty === 'number'`, it branches to `else` and increments `missingLines++`. A row with a valid price and invalid qty should not increment `missingLines` (contract §5 defines `missingLines` as rows where price could not be resolved).
   - **Fix:** Check `row.qty < 0` alongside unentered/invalid checks:
     ```typescript
     if (row.qty === null || typeof row.qty !== 'number' || !Number.isFinite(row.qty) || row.qty < 0) {
       unenteredLines++
     }
     ```

4. **`src/lib/receiptPrice.ts:61-69`: Duplicate active `SupplierItem` tie-breaking is order-dependent**
   - **Problem:** `supplierItems.find(...)` returns the first matching item in array order. If duplicate active entries exist with differing prices, order determines the price.
   - **Fix:** Document array order expectation or pick deterministically (e.g. latest `updatedAt` / highest `id`).

5. **`src/lib/receiptPrice.ts:95`: Equal `effectiveAt` tie-breaking does not consider `entry.at`**
   - **Problem:** `entry.effectiveAt >= bestAsOf.effectiveAt` overwrites previous entries on equality. If unsorted, results vary with array order.
   - **Fix:** Tie-break using `entry.at`: `entry.effectiveAt > bestAsOf.effectiveAt || (entry.effectiveAt === bestAsOf.effectiveAt && (entry.at ?? 0) >= (bestAsOf.at ?? 0))`.

6. **`src/lib/receiptPrice.ts:131`: Normalize `-0` in `resolveReceiptPrice`**
   - **Problem:** When `cost === -0`, `unitPrice` and `basePrice` retain `-0`. While `lineAmount` normalizes this, `ReceiptPrice` should normalize `-0` to `0`.

---

## 4. Verdict

**CHANGES_REQUESTED**

The module is well-isolated, clean (~200 lines), and faithfully implements the core precedence rules with 28 passing unit tests. However, concrete attacks reveal two MUST-fix defects:
1. `baseQty <= 0` collapses legitimate product prices to `0.00 THB` or negative unit prices.
2. `entryUnit: ""` produces an empty string displayed unit.
Both must be addressed to ensure robust pricing display in the Receive flow.
