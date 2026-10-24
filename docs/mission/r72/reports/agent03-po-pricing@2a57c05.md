# R72 AGENT03: PO Receipt Pricing Verification Report

**Status: VERIFICATION_READY**  
**Date: Sun Oct 25 2026**  
**Branch: r72/agent03-price-r2**  
**Baseline Commit: 992f6defe8ebeeac62cec9993473b2d1aa836714**  
**Recovery Base Commit: 2be05415c8dddbc2de876abdb83cc392901714d1**  
**Provider / Model / Options:** Provider: `opencode` | Model: `9router/gemini-3.8-flash-high` | Options: `{"variant": "high"}` (execution harness: Antigravity/T3 Code)  
**Preserved Private History:** `C:/Users/Yutthachai/r64-backup/r72-failures-20261024T1817Z/agent03/`

---

## 1. Executive Summary & Source Provenance

This report independently verifies the PO receipt pricing engine against all R72 requirements without reimplementing or duplicating the R69 resolver.

### Actual Source Tree (a88795b / 992f6de)
- **Price Resolver:** `src/lib/receiptPrice.ts`
- **Receive UI Page:** `src/pages/Receive.tsx`
- **Receive Domain Helpers:** `src/pages/receive/receipt.ts`
- **PO Line Presentation:** `src/pages/receive/PoLines.tsx`
- **Receipt Review Modal & Panel:** `src/pages/receive/ReceiptReview.tsx`
- **Receiving Backend Service:** `src/services/purchaseOrders.ts`

### Review History & Verified Git SHAs
- Financial Approval: `3eb19cf048fdf9d10d652ab945e001600cdc7b81` (`docs/mission/r69/review-receive-final.md`)
- Test Delta Verification: `60a30ed5c6c21fdc6e3342497f92001f5daeb528` (`docs/mission/r69/review-receive-test-delta.md`)
- Pinned Baseline Test Suite: 1783 unit tests, 69 focused tests (`tests/receipt-price.test.ts`, `tests/receive-prices.test.ts`, `tests/receipt-price-consistency.test.ts`), 4 baseline E2E browser tests across `e2e/receive-prices.spec.ts` (1 test) and `e2e/receive-po.spec.ts` (3 tests).

---

## 2. Verification of Specific R72 Requirements

### 2.1 Unit Price, Provenance, Line Amount, Receipt Total, and Final Review
- **Unit Price Resolution:** Resolved per displayed unit (`line.entryUnit ?? line.unit`).
- **Provenance Labels:**
  - `supplierPrice` -> `ราคาผู้ขาย`
  - `costAsOf` -> `ต้นทุน ณ {date}` (formatted Thai date with `formatThaiDate`)
  - `costLatest` -> `ต้นทุนล่าสุด`
  - `missing` -> `ยังไม่ระบุราคา`
- **Line Amount:**
  - `lineAmount(price, qty)` computes `Math.round((qty * unitPrice + Number.EPSILON) * 100) / 100`.
  - Precision is strictly to 2 decimal places (satang).
  - Returns `null` when `qty` is unentered (`null`) or `price.unitPrice` is `null`.
- **Receipt Total & Status Counts:**
  - `receiptTotal()` sums only priced entered lines (`pricedLines`).
  - Blank or unentered lines are counted under `unenteredLines`.
  - Unpriced lines are counted under `missingLines`.
  - When all entered lines are unpriced or all lines are blank, UI displays em-dash (`—`) and never displays `฿0.00`.
  - Missing line footnote displayed: `ยังไม่ระบุราคา {n} รายการ`.
- **Final Review Modal (`ReceiptReview.tsx`):**
  - Displays `facts.estimatedTotal` formatted with `฿{fmtMoney(total)}` or `—`.
  - Shows warning badge `ยังไม่ระบุราคา {n} รายการ` if any entered line lacks a price.

### 2.2 Supplier Buying Price vs costHistory asOf vs Current Cost
- **Precedence Hierarchy:**
  1. `supplierPrice`: Active `SupplierItem` for matching `supplierId` and `productId` with finite `buyingPrice >= 0`.
  2. `costAsOf`: Latest entry from `product.costHistory` where `effectiveAt <= asOf`.
  3. `costLatest`: Fallback when no `costHistory` entry is on or before `asOf`. Uses master `product.cost` if present; otherwise newest future entry from `costHistory`.
  4. `missing`: If neither supplier price nor product cost exists.
- **Strict asOf Boundary:**
  - Future `costHistory` entries (`effectiveAt > asOf`) are strictly excluded from `costAsOf`.

### 2.3 No Agreed Historical PO Snapshot Invention
- **Architecture Contract:** `PurchaseOrderLine` domain type contains no agreed price snapshot field.
- **Verification:**
  - Resolver (`src/lib/receiptPrice.ts`) accepts only `Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'>`.
  - The codebase does not invent, synthesize, or label any price as an agreed historical PO snapshot.

### 2.4 Zero != Missing Distinction
- **Numerical Zero:**
  - `buyingPrice: 0` or `cost: 0` is treated as a valid 0.00 THB price.
  - Generates `lineAmount = 0.00` and increments `pricedLines`.
  - Displayed in UI as `฿0.00`.
- **Missing (`null`):**
  - Generates `unitPrice: null` and `lineAmount = null`.
  - Increments `missingLines`.
  - Displays as em-dash (`—`) with warning notice.

### 2.5 Actual Received (Not Ordered) Quantity
- **Verification:**
  - `resolveLinePricing` passes `entry?.qty ?? null` to `lineAmount(price, qty)`.
  - `summariseReceiptPrices` maps `entries[l.productId]?.qty ?? null`.
  - Line amount reflects only goods physically received on this delivery, not the total ordered quantity (`orderedQty`) or remaining due quantity.

### 2.6 KG / EA / Pack / Carton Preserved Rate UOM Consistency
- **Preserved Rate:** `factor = line.baseQty / line.orderedQty` established when the order was placed.
- **Master Data Change Immunity:**
  - Changing, adding, or deleting `product.unitConversions` after order placement has zero effect on the receipt line unit price or filed stock quantity.
  - Price per alternate unit: `unitPrice = basePrice * factor`.

### 2.7 Unknown Legacy Alternate Rate -> Missing
- **Legacy Order Handling:**
  - When `line.entryUnit` is specified and differs from `line.unit` (`!sameUnit(cleanEntryUnit, line.unit)`), but `baseQty` or `orderedQty` is missing or `<= 0`:
  - Resolver returns `source: 'missing'`, `unitPrice: null`, `basePrice: null`.
  - The resolver never guesses or dynamically resolves rates for legacy alternate units.

### 2.8 No Monetary Ledger / Payload Writes
- **Zero Financial Writes on Receiving:**
  - `Receive.tsx:325-343` calls `receivePurchaseOrder(params)`.
  - The payload `lines` contains:
    ```typescript
    {
      productId: string
      receivedQty: number
      checked: boolean
      note?: string
    }
    ```
  - Neither unit prices, line amounts, nor receipt totals are submitted in the payload.
  - `src/services/purchaseOrders.ts` writes inventory movements (`MovementLine`: `productId`, `productName`, `unit`, `entryUnit`, `entryQty`, `qty`, `note`) and receipt metadata (`PoReceipt`: `docNo`, `date`, `invoiceNo`, `byId`, `byName`, `lines`).
  - No monetary transactions, ledger entries, or price snapshots are persisted.

---

## 3. Cost Visibility Permissions & Security Audit

### 3.1 Permission Matrix

| Asset / Action | Staff (`role: 'staff'`) | Manager (`role: 'manager'`) | Admin (`role: 'admin'`) | Unauthenticated / Revoked | Enforcement Layer |
|---|---|---|---|---|---|
| **Read `/receive` Route** | ALLOWED | ALLOWED | ALLOWED | BLOCKED | React Router + `src/components/nav/navItems.ts:37` (`adminOnly` is falsy) |
| **Read `products` (including `cost`, `costHistory`)** | ALLOWED | ALLOWED | ALLOWED | BLOCKED | `firestore.rules:1668` (`allow read: if active() && brandData(collection)`) |
| **Read `supplierItems` (including `buyingPrice`)** | ALLOWED | ALLOWED | ALLOWED | BLOCKED | `firestore.rules:1668` (`allow read: if active() && brandData(collection)`) |
| **View Price Estimates on Receive Screen** | ALLOWED | ALLOWED | ALLOWED | BLOCKED | In-memory evaluation via `resolveLinePricing` in `src/pages/receive/PoLines.tsx` |
| **Write/Update `products.cost`** | BLOCKED | BLOCKED | ALLOWED | BLOCKED | `firestore.rules:101,1684` (`adminWritable`; staff can only edit `unitConversions`) |
| **Write/Update `supplierItems.buyingPrice`** | BLOCKED | BLOCKED | ALLOWED | BLOCKED | `firestore.rules:101` (`adminWritable`) |
| **File Stock Movements on Receipt** | ALLOWED | ALLOWED | ALLOWED | BLOCKED | `firestore.rules:81` (`staffWritable` for `stockMovements` and `purchaseOrders`) |
| **Persist Monetary Amounts on Receipt** | IMPOSSIBLE | IMPOSSIBLE | IMPOSSIBLE | IMPOSSIBLE | `src/services/purchaseOrders.ts` has no price payload schema or DB writes |

### 3.2 Audit Findings & Policy Distinction
1. **Observed Firestore Read Policy (Enforced):**
   Firestore security rules operate strictly at the document level (`allow read: if active() && brandData(collection);`), not at the field level. Because `products` and `supplierItems` must be read by staff for routine stock operations, inventory keying, and supplier identification, any active user in the brand technically reads document payloads containing `cost` and `buyingPrice`. No field-level masking or visibility filter exists in Firestore security rules.
2. **Inferred Owner Intent vs No Invented Field Visibility Gate:**
   The UI presentation on `/receive` provides price estimates to receiving staff so they can cross-check physical delivery amounts against paper supplier invoices at the loading dock. We distinguish this observed operational policy from any hypothetical or inferred Owner intent: the system does NOT invent, assume, or enforce any field visibility gate or column-level redaction on `/receive`. If product cost confidentiality from receiving staff is ever desired as a business requirement in the future, it would require architectural document splitting (e.g., separate private cost documents) rather than client-side omission.
3. **Write Integrity:**
   Staff cannot tamper with or overwrite master cost data or supplier buying prices (`adminWritable` enforced by Firestore rules).

---

## 4. Brand-Fencing and Scoping Isolation

### 4.1 Supplier Fetch Brand Scoping
- In `src/services/suppliers.ts`, `listSupplierItems()` queries `backend.getAll(COL.supplierItems)`.
- `backend` resolves the collection name via `resolveCollection(name, brand)` (e.g. `lelapin__supplierItems`, `rnd__supplierItems`).
- In `src/pages/Receive.tsx:162-182`:
  - `brandEpoch()` guards against asynchronous race conditions during brand switching.
  - `onBrandChange(() => setSupplierItems([]))` immediately purges supplier items on brand switch.

### 4.2 Product Identity Fencing
- `resolveReceiptPrice` fences product identity:
  ```typescript
  const matchingProduct =
    product && typeof line.productId === 'string' && line.productId !== '' && product.id === line.productId
      ? product
      : undefined
  ```
- Cross-product cost contamination is structurally prevented.

---

## 5. Explicit Intentional Rounding Boundary

### Specification & Analysis
- **Scenario:** 2.72 KG/block cheese received at 0.333 block with buying price 1,000 THB/KG.
- **Line Estimate (Entered Units):**
  - Rate per block = `1,000 * 2.72 = 2,720.00 THB/block`.
  - Estimate = `0.333 * 2,720 = 905.76 THB`.
- **Stock Filing (Base Units with 3dp Rounding):**
  - Filed quantity = `toBase(0.333, 2.72) = roundQty(0.90576) = 0.906 KG`.
  - Stock valuation = `0.906 * 1,000 = 906.00 THB`.
- **Delta:** `|905.76 - 906.00| = 0.24 THB`.
- **Intentional Design Decision:**
  The receipt screen estimate intentionally prices entered units directly (`qty * unitPrice`) to match supplier invoice lines. It is an operational preview, NOT a book valuation of 3dp-rounded stock. Downstream inventory accounting handles inventory valuation. No code changes should be made to unify these two distinct concepts.

---

## 6. Visual Evidence Provenance

The visual evidence was regenerated and verified at commit `992f6de`:
1. **Desktop Viewport (1440x900):**
   - Path: `docs/evidence/receive-price/receive-price-1440.png`
   - Size: 213,820 bytes
   - Content: Shows PO receipt line table with FLOUR (unit price ฿120.00 / KG, `ราคาผู้ขาย`, line amount ฿240.00), CHEESE (unentered, no line amount), and SAUCE (`ยังไม่ระบุราคา`, no line amount). Summary panel shows ฿240.00 and footnote `ยังไม่ระบุราคา 1 รายการ`.
2. **Mobile Viewport (390x844):**
   - Path: `docs/evidence/receive-price/receive-price-390.png`
   - Size: 147,876 bytes
   - Content: Shows compact card layout, mobile summary sheet toggle, and identical totals.

---

## 7. Verification Evidence & Test Execution

### 7.1 Environment Versions
- Node.js: `v24.18.0`
- npm: `11.16.0`
- Vitest: `v5.0.0`
- TypeScript: `v6.0.3` (tsc -b)
- Oxlint: `v1.74.0`

### 7.2 Focused Test Execution
```bash
npx vitest run tests/receipt-price.test.ts tests/receive-prices.test.ts tests/receipt-price-consistency.test.ts tests/receipt-price-r72-verification.test.ts
```
**Output:**
```
Test Files  4 passed (4)
     Tests  95 passed (95)
  Duration  1.43s
```
- `tests/receipt-price.test.ts`: 40 tests passed
- `tests/receive-prices.test.ts`: 15 tests passed
- `tests/receipt-price-consistency.test.ts`: 14 tests passed
- `tests/receipt-price-r72-verification.test.ts`: 26 tests passed

### 7.3 Typecheck, Lint, and i18n Verification
1. **TypeScript Build:**
   ```bash
   npx tsc -b
   ```
   *Result:* Exit 0, 0 errors.
2. **Linter:**
   ```bash
   npm run lint
   ```
   *Result:* Exit 0, 0 errors.
3. **i18n Translation Check:**
   ```bash
   npm run i18n:check
   ```
   *Result:* Exit 0, "✓ every Thai UI string is translated".

---

## 8. Remaining Gates & Conclusion

- **Local Worktree & Commit Status:** Clean worktree on `r72/agent03-price-r2`.
- **Source Files Untouched:** No production code (`src/`) modified. All verification conducted via non-destructive bounded test suite and documentation.
- **Release Readiness:** All R72 acceptance criteria satisfied.
