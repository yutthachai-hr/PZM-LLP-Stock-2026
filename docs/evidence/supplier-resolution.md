# Receiving: smart supplier resolution (7 Oct 2026)

Not merged, not deployed. Branch `claude/phase-a-ledger-continue-uzbbb5`.

## Audit: what the schema already had

| # | Question | Answer in the real code |
|---|---|---|
| 1 | Product → Supplier | `Product.supplierId`, the usual supplier. Kept on the product on purpose, so "who sells this" costs no read. |
| 2 | Several suppliers per product | Yes: `Product.alternateSupplierIds[]`. |
| 3 | Preferred / default | `supplierId` *is* the usual one. The automatic order never picks an alternate on its own. |
| 4 | Supplier-specific SKU | **None.** There is only `Product.sku`. `supplierItems` (one document per product) holds price and minimum order; reading it costs a read per product, so receiving does not use it. |
| 5 | Purchase / receipt history | Receipt movements carry `supplierId` / `supplierName` (`ReceiptDoc`). The recent window is **already in memory** (DataContext). |
| 6 | PO supplier | `PurchaseOrder.supplierId`. Receiving against an order already locked the field. |
| 7 | Receiving state | `ReceiptDraft` (`src/pages/receive/receipt.ts`), saved on the device across leaving the screen. |
| 8 | Supplier change vs. selected products | Nothing happened before; lines were kept unchecked. |
| 9 | OCR supplier | `ocrApply` matched the bill's supplier name to one on file by folded name, only when the field was empty. |
| 10 | Supplier/product validation | **None.** |

**No new relationship was created.** Everything uses `supplierId`, `alternateSupplierIds`,
receipts already in memory, and the OCR result.

## What changed

| File | Change |
|---|---|
| `src/lib/supplierResolution.ts` (new, pure) | Evidence-ranked resolution: PO > the product's own supplier > a listed alternate > the bill (OCR) > history. Results are `LOCKED`, `AUTO`, `SUGGEST`, `AMBIGUOUS`, `MISMATCH` or `NO_MATCH`, each with its reason. **No percentages.** Also: `fitOf` (compatible / alternate / history / incompatible / unknown), `conflictsWith`, `supplierRank`, `supplierIssues`. |
| `src/pages/Receive.tsx` | Fills an **empty** supplier when the products settle it, and marks it `auto`. Never replaces a person's choice or the bill's. A later product that disagrees shows a conflict instead of switching. Records "suggested A, chose B". Ranks search by the chosen supplier. |
| `src/pages/receive/receipt.ts` | `supplierPick: '' \| 'auto' \| 'ocr' \| 'manual'`. Old drafts with a supplier restore as `manual`. |
| `src/pages/receive/SupplierHint.tsx` (new) | One line under the field: "✓ เลือกให้อัตโนมัติจากสินค้าที่เลือก", "จาก PO-000123", "แนะนำ: X · จากประวัติการรับ [ใช้ผู้ขายนี้]", or candidate buttons when ambiguous. Also an OCR mismatch banner, and a conflict banner with **เอาออก** (remove) and **แยกไปใบรับถัดไป** (move to the next receipt, using the existing queue). |
| `src/pages/receive/DocumentCard.tsx` | A `supplierHint` slot under the field, for both the locked and manual cases. |
| `src/components/LineBuilder.tsx` | Optional `rankFirst`. The chosen supplier's products, then its alternates, then products received from it before. **Nothing is hidden.** |
| `src/lib/supplierFeedback.ts` (new) | Override events, **on this device only** (see "Owner decision" below). |
| `src/i18n/en.ts` | 17 English strings. |

## Rules the code keeps

- **Brackets in a product name are never evidence.** MOZZARELLA (SHREDDED) with no mapping
  gives `NO_MATCH` (tested).
- **A weaker signal never overrides a stronger one.** History of 50 receipts from PANFOOD does
  not displace a product mapped to FOOD WAY. It changes the result to `SUGGEST` with PANFOOD
  shown, because the mapping may be stale (tested).
- **Several suppliers with no usual one gives `AMBIGUOUS`.** The app never chooses (tested).
- **Only active suppliers on file are ever returned.** An id from the bill that is not on file
  gives `NO_MATCH` (tested).
- **A PO's supplier is `LOCKED`,** whatever the products or the bill say (tested).
- **When the bill and the product mapping disagree, the result is `MISMATCH`,** and a person
  decides (tested).
- **Resolution writes nothing.** It creates no supplier and changes no product, preferred
  supplier or PO (tested: inputs unchanged).

## Tests

`tests/supplier-resolution.test.ts` has 22 tests. They cover:
- a single-supplier product;
- the usual supplier with an alternate;
- several suppliers;
- a single alternate;
- no supplier, including brackets in the name;
- an inactive supplier;
- history: clear, split, dominant, and voided receipts;
- history never outranking the mapping;
- a PO receipt locked;
- several products from the same supplier;
- an unmapped product mixed in;
- conflicting products;
- OCR agreeing, OCR alone, and OCR conflicting;
- invented ids;
- fit classes;
- the FRENCH FRIES / PANFOOD conflict message data;
- a supplier changed after lines are added;
- supplier-first search ranking;
- data-quality issues, with archived products ignored;
- one override versus repeated overrides;
- no mutation of the inputs.

Full suite: **124 files, 1,511 tests, all passing.**

## Checked in the running app (demo mode, 7 Oct)

1. **Receive without a PO:** added SAUSAGE MIX DOLCE (LADER), quantity 5.
   - The Supplier field became **LADER**, with "เลือกให้อัตโนมัติจากสินค้าที่เลือก".
   - No manual pick was needed.
   - The demo catalogue's version of the screenshot's product is mapped to LADER.
2. **Conflict:** added MUSHROOMS (NATUR FIRST).
   - The banner read "MUSHROOMS (NATUR FIRST) ผูกกับ NATUR FIRST แต่ใบรับนี้เป็นของ LADER".
   - The supplier stayed LADER.
3. **แยกไปใบรับถัดไป:** the mushroom line moved to the next-receipt queue, the conflict
   cleared, and LADER remained.
4. **Console:** no errors.
5. **Not exercised in the browser:** the PO label "จาก PO-…". The demo had no open order. It is
   covered by the `LOCKED` unit test, and the field was already locked before this change.

## Read budget

**Zero added Firestore reads.** Everything comes from data the screen already holds:
products and locations (DataContext), the supplier list (`useSuppliers`, already used by this
page), and the recent movements (DataContext). `supplierItems` is deliberately not read.

## Owner decision needed

**Shared override feedback.** Repeated corrections should feed the Data Quality Center for
everyone. That needs a small append-only collection, which is a rules change, so it is your
call under rule 7. Until then, overrides are kept on the device that made them, and
`supplierIssues()` turns 3 or more of the same correction into a "mapping may need review"
item.

## Exit gate

| Requirement | Status |
|---|---|
| The screenshot scenario needs no manual supplier pick | **Met** (seen in the running app, with LADER as the demo catalogue's mapping) |
| PO receiving never asks for the supplier again | **Met** (locked as before; now labelled "จาก PO-…") |
| Ambiguous multi-supplier products are not auto-selected | **Met** (tested) |
| Conflicting products are detected | **Met** (tested and seen) |
| Manual override works where allowed | **Met.** The person's choice is never replaced; the override is recorded. |
| Mappings stay grounded in real ids | **Met** (tested) |
| Tests pass | **Met** |
| No read-budget regression | **Met** (0 added reads) |
