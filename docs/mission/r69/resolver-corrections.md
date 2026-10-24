# R69 Price Resolver Corrections

**Status: REVIEW_PENDING**  
**Date: Sat Oct 24 2026**  
**Branch: fix/r69-price-resolver**  

---

## 1. Commit Trail & Environment Verification

- **Base commit (actual git parent):** `934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8` (`934cbfa`)
  *(Note: Review text cited `934cbfa81f185ef35c5c0e1ae573c72b21712a20`, which is a non-existent git object; verified and branched from actual git object `934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8`)*
- **RED commit (failing tests):** `c21c4e92e5503defcfc03a06046592815ab5d7fc`
- **GREEN commit (implementation):** `63f44da82640e3998f981e5cfe38d8ed40807604`

---

## 2. Test Cases and Verification Counts

| Suite | Command | Result |
|---|---|---|
| Receipt Price Resolver | `npx vitest run tests/receipt-price.test.ts` | **37 / 37 passed** (9 new/corrected tests, 28 preserved) |
| Full Test Suite | `npx vitest run` | **1,751 / 1,751 passed** (142 test files) |
| TypeScript Project Build | `npx tsc -b` | **0 errors** |
| Oxlint Linter | `npx oxlint src/lib/receiptPrice.ts tests/receipt-price.test.ts` | **0 warnings, 0 errors** |

---

## 3. Changed Contract Clarifications

1. **Alternate Unit Without Preserved Rate (Legacy Pack):**
   - For an alternate unit (`!sameUnit(cleanEntryUnit, line.unit)`), if no finite positive preserved rate exists (`baseQty > 0 && orderedQty > 0`), returns `source: 'missing'`, `unitPrice: null`, `basePrice: null`. Dynamic lookup is not performed and arbitrary fallback is not invented.
2. **Invalid Conversion Rates (`baseQty <= 0`, negative, NaN):**
   - Alternate unit lines with `baseQty: 0` or negative or NaN return `source: 'missing'`. Non-zero product prices never collapse to `0.00 THB`, and negative unit prices are never created.
   - Valid zero cost (`0.00 THB`) remains `0` only when conversion is known (own-unit or positive preserved rate).
3. **Empty or Whitespace Unit Normalization:**
   - `entryUnit` is trimmed; empty or whitespace strings fall back to `line.unit`.
4. **Own-Unit and `sameUnit` Equality:**
   - Uses `sameUnit` imported from `src/lib/units.ts`. Case/space variants (e.g. `ea` vs `EA`) use factor 1 when no preserved ratio exists.
5. **Product ID Scoping:**
   - Only uses `product.cost` and `product.costHistory` when `product.id === line.productId`. Mismatched product records are ignored.
6. **Conflicting Active Supplier Items Invariance:**
   - If multiple active `SupplierItem` records exist for the same supplier and product with different buying prices, the ambiguous supplier source is skipped, falling back to valid product cost or missing.
   - Order-invariant: order of items in the array cannot alter price selection. Identical-price duplicates remain valid.
7. **Deterministic Equal `effectiveAt` Correction:**
   - When multiple `costHistory` entries share the same `effectiveAt <= asOf`, ties break deterministically by the highest finite `entry.at` timestamp.
8. **Current `product.cost` vs Future History:**
   - Preserves label `costLatest` for future-only history estimates.
   - When both valid `product.cost` and newest future history exist, prefers `product.cost` over future unreached history.
9. **Invalid Negative Quantity in Receipt Total:**
   - In `receiptTotal`, negative quantities count as `unenteredLines`, not `missingLines`.
10. **Monetary Normalization:**
    - Normalized IEEE-754 `-0` to `0` in `ReceiptPrice`, `lineAmount`, and `receiptTotal`.
11. **Overflow and NaN Protection:**
    - Multiplication overflow (`Infinity`), `NaN`, or negative amounts return `null` in `lineAmount`, never silently zero.

---

## 4. Remaining Limitations

- **Legacy PO Lines in Alternate Units:** Orders placed prior to preserved rate tracking that used an alternate unit without `baseQty` will display as `missing` until either received in base units or re-saved with explicit conversion.
- **Sub-satang Precision:** Rounding occurs at line and receipt level; non-terminating conversion fractions follow standard satang rounding per delivery event.
