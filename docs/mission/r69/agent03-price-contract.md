# R69 AGENT03: Receipt Price Resolver Contract

**Status: REVIEW_PENDING**

Pure module and test suite for resolving purchase order receipt line prices, satang line amounts, and receipt totals.

- **Module:** `src/lib/receiptPrice.ts`
- **Tests:** `tests/receipt-price.test.ts`
- **Isolation:** Pure module. No imports from `services/`, `backend/`, or `React`. No side-effects or database writes.

---

## 1. Contract Specification

```typescript
export type PriceSource = 'supplierPrice' | 'costAsOf' | 'costLatest' | 'missing'

export interface ReceiptPrice {
  source: PriceSource
  /** Per ONE displayed unit = line.entryUnit ?? line.unit */
  unitPrice: number | null
  unit: string
  /** Per product own unit */
  basePrice: number | null
  /** Present for costAsOf only */
  effectiveAt?: number
}

export function resolveReceiptPrice(p: {
  line: Pick<PurchaseOrderLine, 'productId' | 'unit' | 'entryUnit' | 'orderedQty' | 'baseQty'>
  supplierId: string
  product?: Pick<Product, 'id' | 'cost' | 'costHistory'>
  supplierItems: readonly Pick<SupplierItem, 'supplierId' | 'productId' | 'buyingPrice' | 'active'>[]
  asOf: number
}): ReceiptPrice

/**
 * Calculates line amount for entered quantity rounded to 2 decimal places (satang).
 * Returns null when qty is null (not entered), invalid, or price is missing.
 */
export function lineAmount(price: ReceiptPrice, qty: number | null): number | null

/**
 * Calculates receipt total and line status counts.
 * Total is the sum of rounded line amounts of priced + entered rows only.
 */
export function receiptTotal(rows: readonly { price: ReceiptPrice; qty: number | null }[]): {
  total: number
  pricedLines: number
  missingLines: number
  unenteredLines: number
}
```

---

## 2. Precedence (Owner Rules)

1. **`supplierPrice`**:
   - Matches active `SupplierItem` where `item.supplierId === supplierId && item.productId === line.productId && item.active === true` with a finite `buyingPrice >= 0`.
   - `basePrice = item.buyingPrice`.
   - `effectiveAt` is omitted.
2. **`costAsOf`**:
   - Matches the latest `CostEntry` from `product.costHistory` where `entry.effectiveAt <= asOf` (inclusive boundary) with finite `cost >= 0`.
   - `basePrice = best.cost`.
   - `effectiveAt = best.effectiveAt`.
3. **`costLatest`**:
   - When no `costHistory` entry qualifies under `asOf`:
     - If `costHistory` has valid entries (all after `asOf`), the newest entry's cost is used.
     - Else falls back to `product.cost` if finite and `>= 0`.
   - `basePrice = latestCost`.
   - `effectiveAt` is omitted.
4. **`missing`**:
   - If no price can be resolved: `unitPrice = null`, `basePrice = null`.
   - Never returns 0 for missing (0 is a real price, distinct from missing).

---

## 3. What the Data Cannot Support

1. **No PO Agreed-Price Snapshot Field:**
   - `PurchaseOrderLine` in this codebase does NOT store an agreed purchase price snapshot at PO placement time.
   - Do NOT invent, assume, or fabricate an agreed price field on PO lines. Prices must never be labeled as the "PO's agreed price".
2. **No Dynamic UOM Rate Lookup at Receipt:**
   - Displayed-unit conversion uses the PO line's preserved rate (`baseQty / orderedQty`) ONLY when `entryUnit` is set, `baseQty` is a finite number, and `orderedQty > 0`. Otherwise factor is 1.
   - Dynamic conversion rates (`product.unitConversions`) must NOT be looked up at receipt time, ensuring a later UOM definition change never reprices an already-placed purchase order.
3. **No Taxes, Charges, or Discounts:**
   - The contract handles net product receipt pricing only; discounts, shipping fees, surcharges, and VAT are not represented in line prices.
4. **Brand Scoping:**
   - The caller is responsible for passing data scoped to the active brand. The module is pure and does not query or validate brand boundaries internally.

---

## 4. TDD Checkpoints & Verification

### Commits
- **RED Checkpoint:** `2a1e9a6` (`test(receipt-price): add failing tests for receipt price resolver (RED)`)
- **GREEN Checkpoint:** `70db1b7` (`feat(receipt-price): implement receipt price resolver (GREEN)`)

### Test Coverage (`tests/receipt-price.test.ts` - 28 tests)
- **Each source:** `supplierPrice`, `costAsOf`, `costLatest`, `missing`.
- **Precedence ordering:** `supplierPrice` > `costAsOf` > `costLatest` > `missing`.
- **Zero vs. Missing:** 0 is preserved as a valid price (`0.00 THB`), while missing returns `null`.
- **Supplier Filtering:** Inactive supplier items, differing `supplierId`, and differing `productId` are ignored.
- **As-of Boundary:** Exact `effectiveAt === asOf` match is included in `costAsOf`.
- **Future History Fallback:** All entries after `asOf` fall back to `costLatest` using newest history entry.
- **UOM Conversion:** Carton(24 EA) properly converts base price 10 EA to 240 Carton via `baseQty / orderedQty`.
- **Decimals & Precision:** Fractional KG quantities and prices maintain full internal precision.
- **Rounding:** Line amount rounds to 2 dp satang via `Math.round((x + Number.EPSILON) * 100) / 100`.
- **Floating Point Noise:** `0.1 + 0.2` in `receiptTotal` sums cleanly to `0.3`.
- **Partial & Multi-Round Receipts:** Each delivery is priced according to its entered quantity.

### Verification Results
- `npx vitest run tests/receipt-price.test.ts`: **28 passed (28)**
- `npx vitest run`: **142 test files passed, 1742 tests passed**
- `npx tsc -b`: **Clean (0 errors)**
- `npx oxlint src/lib/receiptPrice.ts tests/receipt-price.test.ts`: **Clean (0 warnings/errors)**

---

## 5. `receiptTotal` Semantics

- **`total`**: Sum of rounded line amounts for rows that are both priced (`unitPrice !== null`) and entered (`qty !== null`).
- **`pricedLines`**: Rows with entered quantity and resolved price (including `qty: 0` which yields amount `0.00`).
- **`missingLines`**: Rows with entered quantity where price could not be resolved (`unitPrice === null`).
- **`unenteredLines`**: Rows where quantity is `null` (not entered on this receipt).
