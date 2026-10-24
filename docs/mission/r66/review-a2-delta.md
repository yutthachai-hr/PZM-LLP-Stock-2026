# R66 A2 Delta Re-Review Report

## Commit & Scope
- **Commit under review**: `3b513ca061407b0f7b3c61f51e7c1c8999045d28` (fix on top of `682b1aa`)
- **Base commit**: `682b1aa`
- **Diff stat**: 5 files changed, 84 insertions(+), 2 deletions(-)

## Files Read
1. `src/lib/deliveryMetrics.ts`
2. `src/lib/deliveryRisk.ts`
3. `tests/delivery-metrics.test.ts`
4. `tests/delivery-risk.test.ts`
5. `e2e/line-send.demo.ts`
6. `src/types.ts` (readers & types verification)
7. `src/lib/supplierConfirmation.ts` (mint / mark lifecycle verification)
8. `src/services/supplierConfirmation.ts` (service layer check)
9. `src/pages/purchase/SendWizard.tsx` (UI send caller check)
10. `src/pages/purchase/SupplierConfirmationPanel.tsx` (UI panel check)
11. `functions/_lib/supplierPo.ts` (server fallback check)

---

## Checks & Verification

### 1. Fix Correctness and Completeness
- `src/lib/deliveryMetrics.ts:155-156`:
  `linkSentAt(o)` now ignores `supplierLink.issuedAt` when `o.supplierLink?.unsent` is true:
  `return a?.at ?? (o.supplierLink?.unsent ? null : o.supplierLink?.issuedAt) ?? null`.
- `src/lib/deliveryRisk.ts:156`:
  `sent` now ignores `supplierLink.issuedAt` when `order.supplierLink?.unsent` is true:
  `const sent = order.supplierActivity?.find((a) => a.kind === 'linkIssued')?.at ?? (order.supplierLink?.unsent ? undefined : order.supplierLink?.issuedAt)`.
- Full repo scan: grepped `src/` for all usages of `issuedAt` and `supplierLink`. No other reader in `src/` treats `supplierLink.issuedAt` as sent time.

### 2. Legacy Links Compatibility
- For legacy links where `supplierLink.unsent` is `undefined`:
  - `(o.supplierLink?.unsent ? null : o.supplierLink?.issuedAt)` evaluates to `o.supplierLink?.issuedAt`.
  - `(order.supplierLink?.unsent ? undefined : order.supplierLink?.issuedAt)` evaluates to `order.supplierLink?.issuedAt`.
  - Behavior is identical to pre-A2 code.

### 3. Failure of New Unit Tests Without Fix
- Temporarily reverted the fixes in `src/lib/deliveryMetrics.ts:156` and `src/lib/deliveryRisk.ts:156` to verify test sensitivity:
  - `tests/delivery-metrics.test.ts:234`: failed with `AssertionError: expected 90 to be null` (received 90 minutes).
  - `tests/delivery-risk.test.ts:122`: failed with `AssertionError: expected [ 'slowConfirmation', 'noHistory' ] to not include 'slowConfirmation'`.
- Code reverted back cleanly to `3b513ca`.

### 4. E2E Test Review (`e2e/line-send.demo.ts:554-601`)
- `test('A2: LINE reports the sheet sent: the supplier is asked once, for that link')`: confirms opening the picker does not mark the link asked, and `finish(page, 'sent')` marks `po1@7` once.
- `test('A2: a cancelled or failed LINE share asks nobody')`: confirms cancelling or rejecting the picker does not write marks (`marks(page)` remains empty).
- `test('A2: a two-page order asks once its first page (with the link) went, even if page 2 is then cancelled')`: verifies page 1 delivery marks `big@7`, and cancelling page 2 does not erase the mark or mark the order fully sent.
- `test('A2: a brand switch while the picker is open asks no supplier in either brand')`: confirms brand switch during open picker halts mark submission across brand isolation.
- All 4 tests are sound, assert the correct contract, and mock LIFF picker/services without browser flakes.

### 5. Automated Checks
- `npx vitest run tests/delivery-risk.test.ts tests/delivery-metrics.test.ts tests/risk-notifications.test.ts tests/supplier-performance.test.ts`:
  - 4 test files passed, 83 tests passed (0 failed).
- `npx tsc -p tsconfig.app.json --noEmit`:
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
- **Worktree**: C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-46c61d2e
- **Report commit SHA**: 6edd32c (amended)
