# R66 Wave 7 — Independent Cross-Model Review of A2

- **Commit**: `682b1aa44355a5633c0c5da555eed2612b04c1d1` (short `682b1aa`)
- **Parent**: `d785ae858cb1db41907d30d36837b28fc7bfb02a` (PR #52 head)
- **Reviewer**: `9router/gemini-3.8-flash-high` (Antigravity harness)
- **Reviewer Role**: Independent cross-model reviewer. Did not author or assist in authoring commit `682b1aa` (written by MAIN/Claude).

---

## 1. Files Read

- `functions/_lib/supplierPo.ts`
- `functions/api/supplier-po/requested.ts`
- `functions/api/supplier-po/link.ts`
- `src/lib/supplierConfirmation.ts`
- `src/pages/purchase/SendWizard.tsx`
- `src/pages/purchase/SupplierConfirmationPanel.tsx`
- `src/pages/purchase/sendProgress.ts`
- `src/services/supplierConfirmation.ts`
- `src/lib/deliveryRisk.ts`
- `src/lib/deliveryMetrics.ts`
- `src/types.ts`
- `tests/supplier-request-on-send.test.ts`
- `tests/supplier-confirmation.test.ts`
- `tests/functions/supplier-po.test.ts`
- `tests/functions/supplier-po.emulator.test.ts`
- `tests/functions/supplier-link-lifecycle.test.ts`
- `tests/preview-isolation.test.ts`
- `tests/share-settle.test.ts`
- `tests/send-progress.test.ts`
- `e2e/line-send.demo.ts`

---

## 2. Attacks and Outcomes

### Attack 1: Paths marking requested without delivered send
Tested cancellation, failure, "ยังไม่ได้ส่ง", LINE login redirect, reload, multi-page order flow where page 0 never delivered, and panel copy link.

- **Cancel**: Opening wizard calls `POST /api/supplier-po/link` which executes `mintLink` (`functions/_lib/supplierPo.ts:132`, `src/lib/supplierConfirmation.ts:253`). `mintLink` only writes `supplierLink: { version, rev, issuedAt, issuedBy, expiresAt, unsent: true, ... }` and `updatedAt`. Closing or cancelling wizard triggers `onClose` (`src/pages/purchase/SendWizard.tsx:572`); neither `requestLink` nor `markSupplierRequested` is invoked. Status, timeline, and history remain untouched.
- **Failure**: If share fails or is cancelled, `settleShare` returns `{ kind: 'failed' }` or `{ kind: 'cancelled' }` (`src/pages/purchase/SendWizard.tsx:355-358`). `requestLink` is guarded by `if (settled.kind === 'nextPage' || settled.kind === 'sent' || settled.kind === 'sentUnsaved')` (`SendWizard.tsx:344`). Failure or cancel skips `requestLink`.
- **"ยังไม่ได้ส่ง — ลองอีกครั้ง"**: In web-share mode where provider returns `ask`, UI displays confirmation modal. Clicking "ยังไม่ได้ส่ง — ลองอีกครั้ง" executes `setAskOutcome(false)` (`SendWizard.tsx:539`), bypassing `confirmPage` and `requestLink`.
- **LINE Login Redirect**: If provider signals login redirect via `needsLogin?.()` or `leftForLogin?.()`, execution returns early (`SendWizard.tsx:300, 321-326`). Neither share settlement nor `requestLink` is called.
- **Browser Reload**: Reload unmounts wizard; no background request is fired. Unsent flag remains in store.
- **Multi-page order**: Link is prepared only on page 0 (`SendWizard.tsx:261`). Page index cannot advance to page 1 without either `settled.kind === 'nextPage'` (delivered) or user tapping "ส่งแล้ว" in `confirmPage` (`SendWizard.tsx:344, 377`). On page 1, `prepared.linkVersion` is `undefined`, so `requestLink` returns immediately (`SendWizard.tsx:368`).
- **Panel "คัดลอกลิงก์"**: `copyLink` in `SupplierConfirmationPanel.tsx:70` only calls `supplierLink(order)` (`POST /api/supplier-po/link`), minting link with `unsent: true`. It does not call `markSupplierRequested`. Badge remains null.

**Outcome**: Pass. No path marks requested without confirmed delivery or user confirmation.

---

### Attack 2: Real send not recorded and server self-heal
Tested whether a delivered send can be dropped and verified server-side self-heal.

- **Send marked via client**: Successful delivery (`sent`, `nextPage`, `sentUnsaved`) or user tapping "ส่งแล้ว" calls `requestLink` -> `markSupplierRequested` (`POST /api/supplier-po/requested`).
- **Network / client drop after delivery**: If client disconnects or tab closes immediately after sharing:
  - When supplier opens URL (`GET /api/supplier/<token>` -> `viewLink`), server executes `askedByHolder` (`functions/_lib/supplierPo.ts:249`).
  - `askedByHolder` detects `o.supplierLink?.unsent === true` and computes `markRequested` with the link's `issuedBy` actor.
  - Server merges `asked` patch with `firstView` (`functions/_lib/supplierPo.ts:252`) and applies write atomically via `patchIf`.
- **Direct answer without view**: If supplier submits answer directly via `POST /api/supplier/<token>`, `answerLink` executes `askedByHolder` inside `writeOrder` (`functions/_lib/supplierPo.ts:294`) and applies `{ ...asked, ...r.patch }`.
- **Supplier never opens link**: Order remains with `unsent: true` and status undefined, preventing false claims that the supplier was asked.

**Outcome**: Pass. Client records send on delivery; server self-heal catches any missed client call upon supplier interaction.

---

### Attack 3: Stale / cross marking, authorization, and preview isolation
Tested amendment concurrency, brand isolation, version mismatch, closed orders, auth enforcement, and preview protection.

- **Wizard open across amendment**: If order revision increments from `rev: 0` to `rev: 1` while wizard holds link version 1 (rev 0), client call to `/api/supplier-po/requested` with version 1 fails inside `markRequested`: `link.rev !== rev` returns `{ ok: false, error: 'stale' }` (`src/lib/supplierConfirmation.ts:282`), returning HTTP 409 stale (`functions/_lib/supplierPo.ts:160`).
- **Brand switch**: Client guards `requestLink` with `brandEpoch() !== openedInEpoch` (`SendWizard.tsx:368`). If brand changes mid-flight, request is aborted. In `services/supplierConfirmation.ts:57`, cache patch is gated on `getBrand() === brand`.
- **Same poId in two brands**: Server uses `brandCollection(brand, 'purchaseOrders')` (`functions/_lib/supplierPo.ts:158`). `markLinkRequested` on `pizza` cannot mutate `lelapin`. Verified in `tests/functions/supplier-po.test.ts:768`.
- **Wrong link version**: `link.version !== ctx.version` returns `{ ok: false, error: 'stale' }`, returning HTTP 409.
- **Closed / non-open order**: `orderTakesAnswers(o)` (`o.status === 'ordered'`) is checked in `markRequested` (`src/lib/supplierConfirmation.ts:279`) and `services/supplierConfirmation.ts:46`. Non-open order returns `{ ok: false, error: 'notOpen' }` (HTTP 409).
- **Server auth**: `markLinkRequested` invokes `caller(deps, authorization)` (`functions/_lib/supplierPo.ts:153`). Returns HTTP 401 for null, nonexistent, inactive, or revoked users. Verified in `tests/functions/supplier-po.test.ts:741`.
- **Preview guard**: `functions/api/supplier-po/requested.ts` sits under `functions/api/supplier-po/`. Covered by `previewGuard` middleware. Confirmed by `tests/preview-isolation.test.ts:102, 116`.

**Outcome**: Pass. All boundary checks, auth gates, brand isolation, and preview isolation enforce correct behavior.

---

### Attack 4: State-machine equivalence (old `issueLink` vs `mintLink` + `markRequested`)
Compared writes between `issueLink` at `d785ae8` and `mintLink` + `markRequested` (or new `issueLink`) at `682b1aa`.

- **First link**:
  - `mintLink` sets `supplierLink: { version: 1, rev: 0, issuedAt, issuedBy, expiresAt, unsent: true }`.
  - `markRequested` removes `unsent` and `baseRev`, sets `requestedDeliveryDate`, `supplierConfirmationStatus = 'waiting'`, pushes `requested` to history, pushes `linkIssued` to activity.
  - Patch fields match old `issueLink` identically.
- **Quantity-only amendment**:
  - `mintLink` carries `baseRev: 0`.
  - `markRequested` sees `asked = 0`, checks `r.rev > 0 && r.changes.some(c => c.kind === 'expectedAt')` -> false.
  - If approved date stands (`expectedAt !== requestedOf(o)` per PO-00003), pushes system `requested` for `expectedAt`.
  - Pushes system `reset` to history, `reset` to activity, `linkIssued` to activity. Sets `supplierConfirmationStatus = 'waiting'`.
  - Exactly identical to old `issueLink`.
- **Date amendment**:
  - `markRequested` sees `dateAmended === true`, sets `requestedDeliveryDate = o.expectedAt`, `confirmedDeliveryDate = null`, pushes purchasing `requested`, then system `reset`, activity `reset` and `linkIssued`.
  - Exactly identical to old `issueLink`.
- **Amended twice before sending**:
  - If amended rev 0 -> rev 1 -> rev 2 without sending, `baseRev` chains forward (`link?.unsent ? link.baseRev : link?.rev`), preserving `baseRev: 0`.
  - When rev 2 is marked, `asked = 0` accurately evaluates amendments and resets against the last sent revision.
- **Revoke (`issueLink` with `reissue: true`)**:
  - `issueLink` runs `mintLink` then `markRequested` on the applied patch.
  - If `asked === rev`, pushes `linkRevoked` and `linkIssued` to activity without resetting history or status.
  - Exactly matches R30 reissue semantics.
- **`pendingDeliveryDate` supersede**:
  - If `o.pendingDeliveryDate` exists, pushes `superseded` to history and sets `pendingDeliveryDate = null` in patch. Identical to old `issueLink`.

**Outcome**: Pass. Written fields, history entries, and activity logs are identical to pre-A2 state machine once sent.

---

### Attack 5: `viewLink` / `answerLink` consistency, CAS, replay, and notifications
Tested optimistic CAS state verification, replay safety, and notification deduplication.

- **`viewLink` first view with unsent link**:
  - `askedByHolder` generates `asked` patch.
  - `openLink` runs on `afterAsk = applyPatch(order, asked)`.
  - Merged patch `{ ...asked, ...firstView }` commits in single `patchIf`.
  - Returned `expectedState` is `supplierStateOf(order)` post-patch, aligning browser view with Firestore.
  - Only `supplierOpenedDraft` bell notification is dispatched.
- **`answerLink` on unsent link**:
  - Evaluates `b.expectedState !== supplierStateOf(o)` before asking. If CAS passes, `askedByHolder` executes and merges `{ ...asked, ...r.patch }`.
  - If answer is unchanged (`r.replayed && r.unchanged`), `{ patch: asked }` is still returned so unsent status is cleared and ask recorded, while notification dispatch is skipped (`if (!reply.replayed)`).
- **Request replay**:
  - `isReplay(o, b.requestId)` check at `functions/_lib/supplierPo.ts:290` returns `{ patch: null, reply: { replayed: true, unchanged: false } }`. No double writes, no duplicate notifications.

**Outcome**: Pass. CAS checks, replay handling, and single notification guarantees hold.

---

### Attack 6: Backward compatibility
Tested legacy links and older cached web clients.

- **Old clients calling only `/link`**:
  - Old clients invoke `POST /api/supplier-po/link`, which mints link with `unsent: true`.
  - They never call `/api/supplier-po/requested`.
  - When supplier accesses link, server-side self-heal (`viewLink` / `answerLink` via `askedByHolder`) marks the ask automatically.
  - Fixes false-ask bug even for older clients without breaking link delivery.
- **Legacy links without `unsent` flag**:
  - `markRequested` checks `if (!link.unsent) return { ok: true, patch: null }` (`src/lib/supplierConfirmation.ts:283`). Legacy links are treated as already asked and never re-marked.
  - `askedByHolder` checks `if (!link?.unsent) return null` (`functions/_lib/supplierPo.ts:170`). Legacy views/answers never duplicate ask entries.

**Outcome**: Pass. Fully backward-compatible with legacy database records and cached client versions.

---

## 3. Verification Commands and Counts

Executed in worktree `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-0bc7fcdc` with detached HEAD `682b1aa`:

1. **Vitest Suite**:
   ```bash
   npx vitest run tests/supplier-request-on-send.test.ts tests/supplier-confirmation.test.ts tests/functions/ tests/preview-isolation.test.ts tests/share-settle.test.ts tests/send-progress.test.ts
   ```
   - **Result**:
     - `tests/supplier-request-on-send.test.ts`: 10 passed
     - `tests/supplier-confirmation.test.ts`: 63 passed
     - `tests/functions/supplier-link-lifecycle.test.ts`: 15 passed
     - `tests/functions/supplier-po.test.ts`: 40 passed
     - `tests/preview-isolation.test.ts`: 39 passed
     - `tests/share-settle.test.ts`: 8 passed
     - `tests/send-progress.test.ts`: 11 passed
     - **Total**: 7 test files passed, 206 tests passed, 0 failed.

2. **TypeScript App Check**:
   ```bash
   npx tsc -p tsconfig.app.json --noEmit
   ```
   - **Result**: 0 errors.

3. **TypeScript Functions Check**:
   ```bash
   npx tsc -p functions/tsconfig.json --noEmit
   ```
   - **Result**: 0 errors.

---

## 4. Findings

### Must Findings
*None.* Commit `682b1aa` correctly and securely solves A2 without breaking invariants or leaking false asks.

### Should Findings
1. **`deliveryMetrics.ts` & `deliveryRisk.ts` Unsent Link Heuristic**:
   - In `src/lib/deliveryMetrics.ts:153-156`:
     ```ts
     function linkSentAt(o: PurchaseOrder): number | null {
       const a = (o.supplierActivity ?? []).find((x) => x.kind === 'linkIssued')
       return a?.at ?? o.supplierLink?.issuedAt ?? null
     }
     ```
   - In `src/lib/deliveryRisk.ts:156`:
     ```ts
     const sent = order.supplierActivity?.find((a) => a.kind === 'linkIssued')?.at ?? order.supplierLink?.issuedAt
     ```
   - **Case**: When a user opens SendWizard and cancels, `o.supplierLink` is minted with `unsent: true` and `issuedAt: ctx.now`. Because `linkIssued` is not in `supplierActivity`, both files fall back to `o.supplierLink?.issuedAt`. After 24 hours without sending, `deliveryRisk.ts` triggers `slowConfirmation` (adding 10 risk points) for an order that was never sent.
   - **Recommendation**: Update fallback condition to check `!o.supplierLink?.unsent`, e.g. `(o.supplierLink && !o.supplierLink.unsent ? o.supplierLink.issuedAt : null)`.

2. **`SupplierConfirmationPanel.tsx` Revoke Button on Unsent Link**:
   - In `src/pages/purchase/SupplierConfirmationPanel.tsx:170`:
     ```tsx
     {order.status === 'ordered' && !serverless && canDecide && order.supplierLink && (
       <Button size="sm" variant="secondary" disabled={busy} onClick={() => void revoke()}>
         {t('ยกเลิกลิงก์เดิมและออกลิงก์ใหม่')}
       </Button>
     )}
     ```
   - **Case**: If SendWizard was opened and cancelled, `order.supplierLink` exists (`unsent: true`), causing the revoke button ("ยกเลิกลิงก์เดิมและออกลิงก์ใหม่") to display even though the link was never sent to the supplier. Clicking revoke works (it issues version 2 and marks requested), but showing "revoke existing link" for an unsent link may be confusing.
   - **Recommendation**: Consider checking `order.supplierLink && !order.supplierLink.unsent` or adjusting button label when `order.supplierLink.unsent` is true.

---

## 5. Verdict

**APPROVE**

---

- **Provider / Model**: `9router/gemini-3.8-flash-high`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-0bc7fcdc`
- **Report Commit SHA**: *(Recorded upon commit below)*
