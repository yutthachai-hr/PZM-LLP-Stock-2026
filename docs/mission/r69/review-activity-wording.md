# Review: PR19 Contextual Activity Wording Extraction

- **Target Commit SHA**: `f5f51cea33df22cfa245b8388c1556fa1456a797` (`feat(i18n): contextual activity wording and facts (extracted from #19) [REVIEW_PENDING]`)
- **Base Commit SHA**: `6045b502171b1639d1e55c0f09e9a910e14ad064` (`Merge pull request #53 from yutthachai-hr/hotfix/20261024-sw-navigation-err-failed`)
- **Review Diff Range**: `git diff 6045b50 f5f51ce`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-f7ac64e1`
- **Provider**: OpenCode
- **Model**: `9router/gemini-3.8-flash-high`

---

## Independence Statement

This review was conducted independently by a dedicated review sub-agent session operating in an isolated worktree (`t3-f7ac64e1`) on detached HEAD `f5f51ce`. The reviewer did not author commit `f5f51ce` or originating PR19 changes. No nested subagents, external servers, background daemons, network pushes, or deploys were used.

---

## 1. Scope & Parity with PR19

The change extracts the contextual completed-action activity wording for sidebar and desk cards from historical PR19 (`fix/20261014-line-en-th`, commit `9c1e27e` / `2fc724d` / `05fdd00`):

1. **Extraction Boundaries**:
   - Strictly isolated from PR58 / `extract/20261024-pr19-i18n-audit` (which extracted AST auditing scripts `scripts/i18n-audit.mjs` and `tests/i18n-audit.test.ts`).
   - Does **not** include LINE share artwork (`public/brand/line/*`) or LINE send flows.
   - Touches only 4 application/dictionary files and 2 test files.
2. **Data & Rendering Preservation**:
   - **Navigation & Links**: Preserved (`to: '/movements'`, `to: \`/orders?po=${encodeURIComponent(o.id)}\``, `to: \`/requests/${r.id}\``).
   - **Brand Scoping**: All activity queries receive brand-scoped collections (`movements`, `orders`, `requests`) via React context props; no scope leakage.
   - **List Rendering & Timestamps**: Ordering (`sort((a, b) => b.at - a.at)`), capping (`slice(0, 6)` for desk, `3` for sidebar), and timestamp formatting (`sinceLabel`, `bkkTimeOf`, `formatThaiDateShort`) are preserved intact.
   - **Source Immutability**: Underlying data objects (`PurchaseOrder`, `PurchaseRequest`, `StockMovement`) are not mutated by translation or logging routines (verified by deep equality checks in unit tests).

---

## 2. Semantic Linguistic Review (Thai / English)

The extracted wording solves the semantic collision between navigation nouns / command buttons and completed past activity facts:

| Context | Thai Key | English Translation | Prior Behavior / Semantic Role | Correctness Assessment |
|---|---|---|---|---|
| **Sidebar Live** | `รับสินค้าเข้าแล้ว` | `received stock` | Prior `รับของ` collided with generic receive button | **Correct**: past verb matching `<b>{who}</b> {verb} {docNo}` |
| **Sidebar Live** | `เบิกสินค้าแล้ว` | `issued stock` | Prior `เบิก` was ambiguous command/noun | **Correct**: explicit completed issue verb |
| **Sidebar Live** | `โอนสินค้าแล้ว` | `transferred stock` | Prior `โอน` was brief noun/action | **Correct**: explicit completed transfer verb |
| **Sidebar Live** | `ปรับยอดสต๊อกแล้ว` | `adjusted stock` | Prior `ปรับสต๊อก` was menu/action title | **Correct**: explicit past adjustment |
| **Sidebar Live** | `ตัดใช้สินค้าแล้ว` | `consumed stock` | Prior `ตัดใช้` was imperative action | **Correct**: explicit past consumption |
| **Sidebar Live** | `สั่งซื้อแล้ว` | `placed order` | Prior `สั่งซื้อ` translated as navigation noun `Orders` | **Correct**: `<b>User</b> placed order PO-...` instead of `<b>User</b> Orders PO-...` |
| **Desk Activity** | `บันทึกการรับสินค้าแล้ว` | `Stock received` | Prior `รับสินค้าเข้า` was imperative button copy | **Correct**: completed fact title |
| **Desk Activity** | `บันทึกการเบิกใช้แล้ว` | `Stock issued / used` | Prior `เบิกใช้` was action verb | **Correct**: completed fact title |
| **Desk Activity** | `บันทึกการโอนสินค้าแล้ว` | `Stock transferred` | Prior `โอนสินค้าระหว่างสาขา` was navigation label | **Correct**: completed fact title |
| **Desk Activity** | `บันทึกการปรับสต๊อกแล้ว` | `Stock adjusted` | Prior `ปรับสต๊อก` was navigation title | **Correct**: completed fact title |
| **Desk Activity** | `ออกใบสั่งซื้อแล้ว` | `Purchase order created` | Prior `สร้างใบสั่งซื้อ` was command button label | **Correct**: completed fact title |
| **Activity Log** | `สั่งซื้อเรียบร้อย` | `Order placed` | Disambiguates table action column from sidebar verb | **Correct**: Sentence-case action fact |
| **Activity Log** | `ยกเลิกใบสั่งซื้อแล้ว` | `Cancelled order` | Prior `ยกเลิกใบสั่งซื้อ` was button command | **Correct**: Sentence-case completed status |

### Global Navigation Label Protection

Crucially, global navigation labels and action buttons are **not** overwritten:
- `สั่งซื้อ` in `src/i18n/en.ts` remains `'Orders'` for navigation.
- `สร้างใบสั่งซื้อ` in `src/i18n/en.ts` remains `'Create purchase orders'`.
- `ยกเลิกใบสั่งซื้อ` in `src/i18n/en.ts` remains `'Cancel order'`.
- Verified explicitly in test: `expect(translatorFor('en')('สั่งซื้อ')).toBe('Orders')`.

---

## 3. Test Verification & Code Inspection

### Connected Code Inspection
- Inspected callers of `ACTIVITY_LOOK` in `src/components/dashboard/DeskCards.tsx`.
- Inspected `KIND` in `src/components/nav/SideLive.tsx` and its consumer `feed.map`.
- Inspected `buildActivityLog` in `src/lib/activityLog.ts` for order creation and cancellation entries.
- Inspected `src/i18n/en.ts` entries and ensured zero Thai character leakage in English values.

### Test Architecture
- `tests/sidebar-activity-i18n.test.ts` renders actual component trees to static HTML markup using `renderToStaticMarkup` inside `MemoryRouter` and `I18nProvider`. It tests realistic DOM output (`<b>ยกเลิก</b> placed order <span`, `Stock received`, `Purchase order created`), Thai actor name retention (`ผู้ขายเดิม`), and immutability of data. Tests are non-tautological and verify actual rendered markup rather than isolated regex assertions.
- `tests/activity-log.test.ts` verifies English output, Thai detail retention (`เหตุผลเดิม`), Thai supplier name retention, and source immutability.

### Test Execution Results
1. **Targeted Tests**:
   - Command: `npx vitest run tests/activity-log.test.ts tests/sidebar-activity-i18n.test.ts`
   - Result: 2 passed (2 test files, 9 tests, 686ms).
2. **Full Unit Suite**:
   - Command: `npx vitest run`
   - Result: 142 passed (142 test files, 1717 tests, 12.43s).
3. **i18n Integrity Check**:
   - Command: `npm run -s i18n:check`
   - Result: Pass (exit code 0; 2959 keys verified, 0 missing translations).
4. **TypeScript Verification**:
   - Command: `npx tsc -b && npx tsc -p functions/tsconfig.json && npx tsc -p worker/tsconfig.json && npx tsc -p e2e/tsconfig.json`
   - Result: Pass (0 errors).
5. **Linting**:
   - Command: `npx oxlint`
   - Result: Pass (0 errors; zero warnings in modified files).

---

## 4. Dependencies & Lockfile Notice

- **Junction Setup**: `node_modules` in this isolated worktree is linked via a Windows directory junction to `C:\Users\Yutthachai\PZM-LLP-Stock-2026\node_modules`.
- **No `npm ci`**: In accordance with review rules, no `npm ci` was run into the shared junction.
- **Lock Pinning**: Local dependencies float under current environment setup; dependencies are not verified as lock-pinned.

---

## Findings

### MUST (Blocking)
*None.*

### SHOULD (Non-Blocking Observation)
1. **Legacy Unused Keys in `en.ts`**:
   - **What this is**: In `src/i18n/en.ts:2458-2460`, legacy entries `'เบิก': 'issued'`, `'โอน': 'transferred'`, and `'ตัดใช้': 'used up'` remain.
   - **Problem**: With `SideLive.tsx` switching to `'เบิกสินค้าแล้ว'`, `'โอนสินค้าแล้ว'`, and `'ตัดใช้สินค้าแล้ว'`, these 3 keys are no longer referenced in code. Running `npm run -s i18n:check` warns of 6 unused keys (up from 3 baseline warnings).
   - **Fix**: Remove the 3 legacy entries from `src/i18n/en.ts` during future dictionary housekeeping.
   - **Impact if skipped**: Harmless. `i18n:check` logs warnings but exits with status code 0; dictionary size overhead is negligible (~50 bytes).

---

## Verdict

**APPROVE**

Commit `f5f51cea33df22cfa245b8388c1556fa1456a797` cleanly extracts the activity wording from PR19 without adding LINE artwork, breaking global navigation translations, or mutating runtime data. All 1717 tests, TypeScript checks, and i18n validation gates pass.
