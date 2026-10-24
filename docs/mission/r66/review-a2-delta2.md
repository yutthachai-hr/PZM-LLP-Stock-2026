# R66 A2 Test-Only Delta Re-Review Report

## Commit & Scope
- **Commit under review**: `297124fe0d5c904bed125cdee387d1d9d58a4884`
- **Base commit**: `3b513ca061407b0f7b3c61f51e7c1c8999045d28`
- **Diff stat**: 1 file changed, 6 insertions(+), 2 deletions(-) (`e2e/supplier-date-approved.spec.ts`)

## Files Read
1. `e2e/supplier-date-approved.spec.ts`
2. `functions/_lib/supplierPo.ts` (`markLinkRequested`, `mintLink`, `askedByHolder`)
3. `src/pages/purchase/SendWizard.tsx` (`requestLink`, `confirmPage`)
4. `src/services/supplierConfirmation.ts` (`markSupplierRequested`)

---

## Checks & Verification

### 1. Faithfulness to Real App Flow
- In the real app, `POST /api/supplier-po/link` (`mintLink`) prepares an unsent link token (`supplierLink.unsent = true`) while leaving order status as `'changed'`.
- Upon successful transmission of the share sheet in the Send Wizard (`src/pages/purchase/SendWizard.tsx:344, 367-372`), `requestLink` calls `markSupplierRequested(order, linkVersion)`.
- This triggers `POST /api/supplier-po/requested` handled by `markLinkRequested` in `functions/_lib/supplierPo.ts:152-165`, which transitions `supplierConfirmationStatus` from `'changed'` to `'waiting'` and clears `unsent`.
- The revised helper in `e2e/supplier-date-approved.spec.ts:55-61`:
  - Calls `mintLink(deps, 'Bearer staff1', { brand, poId: 'po3' })`.
  - Asserts `expect(order().supplierConfirmationStatus).toBe('changed')` verifying that minting alone asks nothing.
  - Calls `markLinkRequested(deps, 'Bearer staff1', { brand, poId: 'po3', version: order().supplierLink!.version })` and asserts HTTP 200.
  - Returns the prepared token.
- This faithfully models the production Send Wizard lifecycle.

### 2. Preservation of Original P0 Test Objective
- Original P0 requirement (PO-00003): After a quantity-only revision, the previously approved delivery date stands and the supplier's acknowledgement preserves it.
- In `e2e/supplier-date-approved.spec.ts:106`:
  `expect(s.order()).toMatchObject({ supplierConfirmationStatus: 'waiting', requestedDeliveryDate: day(4), confirmedDeliveryDate: day(4) })` verifies that after `reviseQty()` (which prepares link and marks requested), the status is `'waiting'` and the confirmed date remains `day(4)`.
- Lines 108-116 verify loading `/supplier/po/${revised}`, clicking the accept button, and asserting status updates to `'confirmed'` while preserving `confirmedDeliveryDate: day(4)` and `expectedAt: day(4)`.
- The test proves the exact P0 invariant under the A2 send lifecycle.

### 3. Assertion Weakening / Removal Check
- No assertions weakened or removed.
- Line 58 adds a new strict assertion: `expect(order().supplierConfirmationStatus).toBe('changed')`.
- Line 59 asserts the 200 status code of `markLinkRequested`.

### 4. TypeScript Typecheck
- Ran `npx tsc -p e2e/tsconfig.json --noEmit`.
- Clean pass (0 type errors).

---

## Findings
- **Must**: None
- **Should**: None

---

## Verdict
**APPROVE**

---
- **Provider/model**: 9router/gemini-3.8-flash-high
- **Worktree**: C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-cfb7ef7f
- **Report commit SHA**: 1a5c9e9 (amended)
