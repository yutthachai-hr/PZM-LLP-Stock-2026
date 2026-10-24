# R69 Receive Pricing Integration

**Status: REVIEW_PENDING**  
**Date: Sat Oct 24 2026**  
**Branch: `integ/r69-receive-prices`**  
**Worktree: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-517057f3`**  

---

## 1. Git-Verified SHAs and Pedigree

Integration combines UI and E2E delivery (`3b32f1b`), audited price resolver corrections (`ee0be5d`), and the 14-test consistency suite (`e1753fe`), with a concrete TDD bugfix for root resolver conversion gating:

| Component | Original Commit SHA | Cherry-Picked / Integrated SHA | Description |
|---|---|---|---|
| **Base / UI + E2E** | `3b32f1ba914cd2e49c0d5a33df4bd80e6e761c99` (`3b32f1b`) | `3b32f1b` (Base) | UI line pricing, receipt summary, Playwright E2E spec + screenshots |
| **Audit Review** | `f1b8a0abc2033ceb2cedc1418a2822b14bc76adf` (`f1b8a0a`) | Reference | Independent review returning `CHANGES_REQUESTED` |
| **Resolver Contract** | `934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8` (`934cbfa`) | Reference | Contract §3.2 and pure resolver foundation |
| **Resolver RED** | `c21c4e92e5503defcfc03a06046592815ab5d7fc` | `417987596743acaf235fea3a32d2ecd884fd6e31` | Audit corrections RED tests |
| **Resolver GREEN** | `63f44da82640e3998f981e5cfe38d8ed40807604` | `61b9a9de444944441fe519601f4cf34744f9b696` | Audit corrections implementation |
| **Resolver Doc** | `ee0be5de9bd58e2f1de788c8d90740f7ee8f8002` | `1ba54a86c6265880782c3f34acd73e24782f19c5` | Resolver corrections mission doc |
| **Consistency Suite** | `e1753fe0708cb13585910d52d905b65abe262532` | `a61912e796ad74089afbac1c4809ec8b5e1124d6` | 14 consistency tests & mission doc |
| **Integration Fix** | `4ac1c48c5ace5a251b33d8254a7874869352b5ca` | `4ac1c48c5ace5a251b33d8254a7874869352b5ca` | TDD gate factor on nonempty entryUnit + contract alignment |

**Pre-integration Separate Pass vs Combined Pass:**
- UI branch: 34 tests, full 1,748 passed, 1 e2e passed (`3b32f1b`)
- Resolver correction branch: 37 tests, full 1,751 passed (`ee0be5d`)
- Consistency branch: 14 tests (`e1753fe`)
- **Separate passes do NOT equal combined pass.** Full combined pass verified below.

---

## 2. Root Bug & TDD Cycle (RED / GREEN)

### Problem Identified
In `src/lib/receiptPrice.ts`:
```typescript
const factor = hasPreservedRate ? (line.baseQty as number) / line.orderedQty : 1
```
`hasPreservedRate` was computed purely on positive finite `baseQty` and `orderedQty`. When `line.entryUnit` was `undefined` or empty (ordered in base unit `EA`), but `baseQty` was populated (e.g. `baseQty: 12, orderedQty: 2`), `hasPreservedRate` evaluated to `true`, setting `factor = 6`.
In actual stock filing (`src/services/purchaseOrders.ts:608`):
```typescript
if (!l.entryUnit) {
  stockLines.push({ productId: l.productId, productName: l.productName, unit: l.unit, qty, ...lineNote })
  continue
}
```
Filing with no `entryUnit` uses raw quantity without any conversion factor. The resolver was therefore multiplying line prices by 6x when no alternate entry unit was keyed.

### RED Test
Added to `tests/receipt-price.test.ts`:
```typescript
test('line without entryUnit ignores baseQty and preserves factor 1 (unitEA, entryUnit undefined, orderedQty 2, baseQty 12, cost 20 -> unitPrice 20 and lineAmount 40, not 240)', () => {
  const line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'> = {
    productId: 'prod-ea',
    unit: 'EA',
    entryUnit: undefined,
    orderedQty: 2,
    baseQty: 12,
  }
  const res = resolveReceiptPrice({
    line,
    supplierId: 'sup-1',
    product: { id: 'prod-ea', cost: 20 },
    supplierItems: [],
    asOf: 2000,
  })
  expect(res.unitPrice).toBe(20)
  expect(res.basePrice).toBe(20)
  expect(res.unit).toBe('EA')
  expect(lineAmount(res, 2)).toBe(40)
})
```

**RED Failure Output:**
```
FAIL tests/receipt-price.test.ts > R69 AGENT03: Receipt price resolver > Unit Conversions via PO Preserved Rate (baseQty / orderedQty) > line without entryUnit ignores baseQty and preserves factor 1 (unitEA, entryUnit undefined, orderedQty 2, baseQty 12, cost 20 -> unitPrice 20 and lineAmount 40, not 240)
AssertionError: expected 120 to be 20 // Object.is equality

- Expected: 20
+ Received: 120

 ❯ tests/receipt-price.test.ts:564:29
```

### GREEN Fix
In `src/lib/receiptPrice.ts`:
```typescript
const factor =
  cleanEntryUnit !== undefined && hasPreservedRate
    ? (line.baseQty as number) / line.orderedQty
    : 1
```
Gating factor application strictly on nonempty `cleanEntryUnit AND hasPreservedRate` preserves factor 1 whenever `entryUnit` is absent or blank.

---

## 3. Test Contract Updates & Legacy Behavior

1. **Legacy Alternate Units Contract (`tests/receipt-price-consistency.test.ts`):**
   - For legacy purchase order lines created prior to `baseQty` persistence where `line.baseQty === undefined` with an alternate unit (`Pack` vs base `EA`):
     - **Price Resolver:** Returns `source: 'missing'`, `unitPrice: null`, `basePrice: null`. Per contract §3.2, dynamic lookup from mutable `product.unitConversions` is strictly forbidden, and inventing an arbitrary factor of 1 is forbidden to prevent financial distortion.
     - **Stock Filing (`src/services/purchaseOrders.ts:614`):** Maintains legacy fallback querying `resolveFactor(product, line.entryUnit)` at filing time (stock filed = 12 EA for 2 packs).
   - Test assertion and name in `tests/receipt-price-consistency.test.ts` updated from expecting `unitPrice: 20` to `unitPrice: null`, and `docs/mission/r69/agent03-consistency.md` updated accordingly. Modern orders with preserved rates strictly agree across filing and pricing.

2. **UI Test Alignment (`tests/receive-prices.test.ts`):**
   - In `prod-cost-latest`, audit correction rule 3c established that valid `product.cost` takes precedence over unreached future `costHistory`. `prod-cost-latest` was updated to omit `cost` so that future-only cost history specifically tests the fallback to future entries, while a separate test was added to explicitly verify `costLatest` directly from master product cost.

---

## 4. Combined Verification Gates

All verification commands executed on the combined branch `integ/r69-receive-prices`:

| Gate | Command | Result |
|---|---|---|
| **Focused Resolver Tests** | `npx vitest run tests/receipt-price.test.ts` | **38 / 38 passed** |
| **Focused Consistency Tests** | `npx vitest run tests/receipt-price-consistency.test.ts` | **14 / 14 passed** |
| **Focused Receive Page Tests** | `npx vitest run tests/receive-prices.test.ts` | **7 / 7 passed** |
| **Combined Focused Total** | 3 files | **59 / 59 passed** |
| **Full Vitest Suite** | `npx vitest run` | **1,773 / 1,773 passed** (144 test files) |
| **TypeScript Compilation** | `npx tsc -b` | **0 errors** |
| **Oxlint Linter** | `npx oxlint src/lib/receiptPrice.ts tests/receipt-price.test.ts tests/receipt-price-consistency.test.ts tests/receive-prices.test.ts src/pages/receive/receipt.ts` | **0 warnings, 0 errors** |
| **i18n Translation Check** | `node --experimental-strip-types scripts/i18n-check.mjs` | **Clean** (every Thai UI string translated) |
| **Full Production Build** | `pnpm run build` (`tsc -b && tsc -p functions && tsc -p worker && tsc -p e2e && vite build`) | **Clean** (client & PWA bundles built in 1.08s) |
| **E2E Spec & Visual Evidence** | Retained from `3b32f1b` (`e2e/receive-prices.spec.ts`, `docs/evidence/receive-price/receive-price-390.png`, `1440.png`) | **1 passed** (retained run by UI author) |

---

## 5. Review & Delivery State

- **Current Branch:** `integ/r69-receive-prices`
- **Integration Implementation Commit:** `4ac1c48c5ace5a251b33d8254a7874869352b5ca`
- **Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-517057f3`
- **All remaining gates:** **REVIEW_PENDING** (to be reviewed by another fresh session).
