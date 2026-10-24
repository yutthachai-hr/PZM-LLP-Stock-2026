# R69 AGENT05 — Stock & Security Closure Matrix

Date: Sat Oct 24 2026
Agent: Agent 05 (Review Sub-agent)
Model: 9router/gemini-3.8-flash-high
Worktree: C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-5a9037de
Branch: t3/review-stock-security-closure

---

## 1. Task 1: PR51 Rules Delta vs Live Rules (01bb12c vs 876c6d0)

### 1.1 SHA256 Verification
- Live Rules (Release A live in production, blob `01bb12c:firestore.rules`):
  `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270`
- PR51 Rules (blob `876c6d0:firestore.rules`):
  `f06a4bff8ea0ce502ccb4e60f58b158cfef5c18fea3a077c83a9477dfb143e9a`

### 1.2 Changed Functions & Invariant Verification
Verification via `git diff 01bb12c:firestore.rules 876c6d0:firestore.rules` confirms changes touch ONLY movement voiding / cancellation. All transit location rules, purchase request rules, transfer invariants, and order rules remain 100% identical.

Changed / added functions:
1. `movementCore(d)`:
   - Line 228-229: Added allowed keys `voidReason`, `voidedAt`, `voidedBy`, `voidedByName`.
   - Line 257-261: Added field shape validations:
     - `(!('voidReason' in d) || text(d.voidReason, 500))`
     - `(!('voidedAt' in d) || epochMs(d.voidedAt))`
     - `(!('voidedBy' in d) || text(d.voidedBy, 200))`
     - `(!('voidedByName' in d) || text(d.voidedByName, 200))`
2. `validShape(name, docId, d, fresh)`:
   - Line 916: For `stockMovements`, bypasses full `movementCore(d)` re-validation on cancellation-only updates (`fresh || !cancelOnly() ? movementCore(d) : true`) to prevent rules execution budget exhaustion when evaluating `balanceMovedBack`.
3. `canCreate()` (stockMovements branch):
   - Line 997: Creation constraint hardened to forbid creation with any cancellation metadata:
     `!request.resource.data.keys().hasAny(['voided', 'voidReason', 'voidedAt', 'voidedBy', 'voidedByName'])`.
4. `canUpdate()` (stockMovements router):
   - Line 1023: Dispatches to `movementEdit(name)` passing document path argument `name`.
5. `movementEdit(name)`:
   - Line 1285: Signature updated to accept `name`.
   - Line 1289-1294: Allowed edited keys expanded to include `voidReason`, `voidedAt`, `voidedBy`, `voidedByName`.
   - Replaced loose `(!editedKeys().hasAny(['voided']) || roleIsAdmin())` with strict atomic check:
     `(!editedKeys().hasAny(['voided', 'voidReason', 'voidedAt', 'voidedBy', 'voidedByName']) || voidedHonestly(name))`.
6. `cancelOnly()` (NEW helper function):
   - Line 1316-1319: Verifies that an edit setting `voided` modifies only cancellation/audit fields (`voided`, `voidReason`, `voidedAt`, `voidedBy`, `voidedByName`, `updatedBy`, `updatedByName`, `updatedAt`).
7. `voidedHonestly(name)` (NEW helper function):
   - Line 1321-1345: Enforces strict audit invariants:
     - `roleIsAdmin()` required.
     - Document was not previously voided (`m.get('voided', false) == false && d.voided == true`).
     - Exactly all 5 void fields present (`editedKeys().hasAll(['voided', 'voidReason', 'voidedAt', 'voidedBy', 'voidedByName'])`).
     - `cancelOnly()` holds.
     - Valid `voidReason` string (1-500 chars).
     - `voidedBy == request.auth.uid`.
     - Timestamp `voidedAt` matches server time within 10 minutes (`math.abs(d.voidedAt - request.time.toMillis()) <= 600000`).
     - `voidedByName` matches caller profile name.
     - Atomic balance rollback enforced via `balanceMovedBack(name, m, loc, delta)`.
8. `balanceMovedBack(name, m, loc, delta)` (NEW helper function):
   - Line 1352-1360: Verifies that in the same atomic commit, target `stockLevels` balance moves by `delta` (`math.abs(getAfter(p).data.qty - (before + delta)) < 0.001`).

---

## 2. Task 2: PR54 Remaining App Part (UI & i18n)

### 2.1 Changes Analyzed (`git diff 312f8a7 01bb12c -- src`)
- Files changed: `src/i18n/en.ts` (+7 lines), `src/pages/settings/LogisticsSection.tsx` (+56, -20 lines).
- Functional changes:
  - Exports `statusOf(brand: BrandId): Promise<Status>`.
  - Refines status state from boolean to 6 discrete states: `'loading' | 'on' | 'off' | 'wrongType' | 'denied' | 'unknown'`.
  - Catches read errors via `classifyProfileError(e)`.
  - If document exists but is not `type === 'transit'`, displays amber badge: "ข้อมูลคลังระหว่างขนส่งไม่ถูกต้อง" (`wrongType`).
  - If read fails due to authz, displays red badge: "ไม่มีสิทธิ์อ่านสถานะ" (`denied`).
  - If offline/network failure, displays red badge: "ตรวจสอบสถานะไม่ได้" + "ลองอีกครั้ง" button (`unknown`).
  - Verifies post-write status: `(await check(brand)) === 'on'` before showing success toast; provides explicit permission error toast on failure.

### 2.2 Status in Production: Needed, Harmless, or Obsolete?
- **Harmless and Defensively Beneficial (NOT obsolete)**:
  - Release A rules are live and transit locations were created by Admin.
  - For existing working locations, UI shows green badge "เปิดใช้แล้ว" (identical to previous behavior).
  - It is **not obsolete** because it acts as continuous health monitoring:
    1. Detects schema corruption/tampering (`wrongType`).
    2. Handles transient read failures or non-admin visits cleanly without misleading "off" buttons.
    3. Provides unit-tested diagnostic coverage (`tests/logistics-status.test.ts`).

### 2.3 Integration & Vitest Execution
- Merge test (`git checkout -b x 01bb12c && git merge --no-edit origin/main`):
  - Merge strategy: `ort`.
  - Merge status: **CLEAN (0 conflicts)**.
- Vitest run:
  - Command: `npx vitest run tests/logistics-status.test.ts`
  - Result: **1 file passed (1), 5 tests passed (5)** (covering `on`, `off`, `wrongType`, `denied`, `unknown`).

---

## 3. Task 3: PR33 Protections Breakdown (e4db9a6)

Read-only inspection of PR33 (`e4db9a645ab126e457a73d725f3d65bc91037aa5`):

### 3.1 Count Baseline Locked at Entry
- `src/pages/Adjust.tsx:67-75`: `interface AdjRow` records `seen?: { system: number; level: number }` capturing the baseline figures at the exact moment the line was keyed.
- `src/pages/Adjust.tsx:78-81`: `deltaOf(r, system)` computes delta against `r.seen?.system ?? system`, guaranteeing later arrivals (e.g. concurrent receipts) are not accidentally counted away.
- `src/pages/Adjust.tsx:88-94`: `isMoved` detects if live system or live level has diverged from `r.seen`.
- `src/pages/Adjust.tsx:96-105`: `mergeAdjustImportRow` preserves existing keyed row's `seen` baseline across re-imports.
- `src/pages/Adjust.tsx:686-691`: Input `onChange` locks baseline on first numeric input (`const seen = value === null ? undefined : r.mode === 'count' && r.seen ? r.seen : seenNow(r.productId)`).
- `src/pages/Adjust.tsx:340-345`: Form submit passes `expectedLevel: r.seen!.level` for count lines.
- `src/lib/monthlyCount.ts:137-148`: `countExpectedLevels` pins expected levels across all count lines at confirmation time.

### 3.2 Conflict Refusal
- `src/services/stock.ts:798-822`: `planAdjust` inside atomic transaction compares live level with expected level:
  ```ts
  if (isCount && x.expectedLevel === undefined) throw new MissingExpectedLevelError(...)
  if (x.expectedLevel !== undefined && roundQty(cur) !== roundQty(x.expectedLevel)) {
    conflicts.push({ productId, productName, locationId, unit, expected, actual })
  }
  if (conflicts.length > 0) throw new StockLevelConflictError(conflicts)
  ```
- `src/services/stock.ts:957-969`: `fileCount` single-item helper checks `roundQty(cur) !== roundQty(params.expectedLevel)` and throws `StockLevelConflictError`.
- `src/pages/Adjust.tsx:323-325`: Client pre-submit check halts if any row moved:
  ```ts
  if (unconfirmed.length > 0) return toast.error(t('ยอดในระบบเปลี่ยนหลังจากนับ {count} รายการ...'))
  ```
- `src/pages/Adjust.tsx:249-267`: Renders amber warning and "ใช้ยอดใหม่" button for moved rows, forcing explicit user acknowledgment.
- `src/pages/Adjust.tsx:399-402`: Catches `StockLevelConflictError` and surfaces user-friendly error toast.
- `src/pages/counts/MonthlyCountSheet.tsx:314-318`: Catches `StockLevelConflictError` on monthly sheet post and surfaces error toast without corrupting sheet state.

### 3.3 Monthly Retry Idempotency
- `src/services/monthlyCounts.ts:169-170`: Guard `if (sheet.status === 'posted') throw new AppError('ใบนับนี้ปรับสต๊อกไปแล้ว')` prevents double-posting.
- `src/services/monthlyCounts.ts:172-173`: Filters chunk to exclude products already recorded in sheet:
  ```ts
  const done = new Set(sheet.postedIds ?? [])
  const todo = part.filter((a) => !done.has(a.productId))
  ```
- `src/services/monthlyCounts.ts:206-215`: Updates transactionally records partial progress:
  - `status: last ? 'posted' : 'posting'`
  - `postedIds: [...done, ...todo.map((a) => a.productId)]`
  - `adjDocNos: [...(sheet.adjDocNos ?? []), ...(filed ? [filed] : [])]`
- `src/lib/monthlyCount.ts:121-128`: `postingPlan(rows, postedIds)` partitions only unposted rows into chunks of 20 (`POST_CHUNK`).

---

## 4. Task 4: Safe Release Order & Rollback Matrix

### 4.1 Release Order Justification
To ensure zero risk of overwriting or breaking live Firestore Rules:
1. **First: PR33 (Head `e4db9a645ab126e457a73d725f3d65bc91037aa5`) — Pure App**
   - *Why first:* Completely independent of Firestore rules (0 rules diff). Operates entirely within standard transaction reads and live schema. CI 10/10 clean and cross-model approved.
2. **Second: PR54 UI (Head `01bb12cdf56334406d256bbf5462f9a5aeae26f0` app slice) — Pure App**
   - *Why second:* Rules part of PR54 is ALREADY LIVE in production (`ae39c231...`). Only app changes remain. Clean merge with main. 5/5 unit tests pass.
3. **Third: PR51 (Head `876c6d0315df3c63002ca5243903be0f26029b14`) — Rules-First Deployment**
   - *Why Rules-first:* Live rules do not permit `voidReason`, `voidedAt`, `voidedBy`, `voidedByName` in `stockMovements` updates. If app were deployed first, any void attempt would be blocked by live rules.
   - *Step 3a:* Deploy Firestore Rules (`f06a4bff...`).
   - *Step 3b:* Deploy App bundle.

### 4.2 Closure Matrix Table

| Release Step | Package / PR | Exact Head SHA | Components Touched | Required Gates | Owner Sign-off | Rollback Procedure |
|---|---|---|---|---|---|---|
| **Step 1** | **PR #33** | `e4db9a645ab126e457a73d725f3d65bc91037aa5` | App only (`Adjust.tsx`, `stock.ts`, `monthlyCounts.ts`) | CI 10/10 PASS; Vitest unit 9/9 PASS; Cross-model APPROVE (`4475ba2`) | Standard PR merge sign-off | App revert: `git revert -m 1 <merge_sha>`. Live rules untouched. |
| **Step 2** | **PR #54 UI** | `01bb12cdf56334406d256bbf5462f9a5aeae26f0` | App only (`LogisticsSection.tsx`, `en.ts`) | `tests/logistics-status.test.ts` 5/5 PASS; clean merge on main | Standard PR merge sign-off | App revert: `git revert -m 1 <merge_sha>`. Live rules untouched. |
| **Step 3a** | **PR #51 Rules** | `876c6d0315df3c63002ca5243903be0f26029b14` (`firestore.rules` blob SHA256: `f06a4bff8ea0ce502ccb4e60f58b158cfef5c18fea3a077c83a9477dfb143e9a`) | Firestore Rules only | Rules suite 305/305 PASS; Diff verified restricted to void rules | **EXPLICIT OWNER APPROVAL** required for Production Rules deployment | Rules redeploy: redeploy live `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270` rules file. |
| **Step 3b** | **PR #51 App** | `876c6d0315df3c63002ca5243903be0f26029b14` | App (`VoidReasonModal`, `stock.ts`, UI) | Unit suite 1725 PASS; build clean | Standard deployment approval | App revert: `git revert -m 1 <merge_sha>`. |

---

## 5. Verification & Metadata
- **Provider / Model:** 9router / gemini-3.8-flash-high
- **Worktree Path:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-5a9037de`
- **Branch:** `t3/review-stock-security-closure`
- **Commit SHA:** `c84c8d656ec2407aad502039421357fe15135505`

